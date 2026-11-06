// FUTURE4000 application routes: accounts, organization setup, policies, training sign-off, audit log, billing.
import express from 'express';
import Stripe from 'stripe';
import { q, dbConfigured } from './db.js';
import { hashPassword, verifyPassword, validatePassword, setSession, clearSession, requireUser, requireRole, audit, loginRateLimit, ROLES } from './auth.js';
import { ORG_TYPES, SERVICES, STATES } from './regulations.js';
import { runAgent } from './agents.js';
import { archiveDocument, storageProvider } from './cloud.js';
import { scrubPHI } from './phi.js';
import { PLANS } from './plans.js';
import { runDailyScan, SCAN_SCHEMA } from './scan.js';
import { PACKS, skeleton } from './templates.js';
import { aiPaused } from './governance.js';
import { registerJob, enqueue, getJob, cancelJob } from './jobs.js';

export const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong. The error has been logged.' });
});
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const EDITORS = ['admin', 'compliance_officer'];
const REVIEWERS = ['admin', 'clinician_reviewer'];

// ---------- Public waitlist (F4 Cloud early access) ----------
const waitHits = new Map();
router.post('/waitlist', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot: bots fill hidden field
  const now = Date.now(), h = (waitHits.get(req.ip) || []).filter((t) => now - t < 3600e3);
  if (h.length >= 10) throw bad('Too many requests. Please try again later.', 429);
  waitHits.set(req.ip, [...h, now]);
  const name = String(b.name || '').trim().slice(0, 120), org = String(b.organization || '').trim().slice(0, 200);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200), interest = String(b.interest || 'platform').slice(0, 40);
  if (!name || !org || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Please enter your name, organization and a valid email.');
  const useCase = String(b.use_case || '').slice(0, 2000);
  const scan = scrubPHI(useCase);
  if (scan.redactions) throw bad('Please remove patient information from your description.');
  await q(`INSERT INTO waitlist (name, organization, email, interest, use_case, ip) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (email, interest) DO UPDATE SET use_case = EXCLUDED.use_case, name = EXCLUDED.name, organization = EXCLUDED.organization`,
    [name, org, email, interest, useCase, req.ip]);
  res.status(201).json({ ok: true });
}));
router.get('/waitlist', requireRole('admin'), wrap(async (req, res) => {
  res.json((await q('SELECT name, organization, email, interest, use_case, created_at FROM waitlist ORDER BY created_at DESC LIMIT 1000')).rows);
}));

// ---------- Accounts ----------
router.post('/auth/signup', loginRateLimit, wrap(async (req, res) => {
  const { organization, full_name, email, password, credentials } = req.body || {};
  if (!organization || !full_name || !email) throw bad('Organization, full name, and email are required.');
  const pwError = validatePassword(password);
  if (pwError) throw bad(pwError);
  const exists = await q('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
  if (exists.rowCount) throw bad('An account with this email already exists.', 409);
  const org = (await q('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [String(organization).slice(0, 200)])).rows[0];
  const user = (await q(
    `INSERT INTO users (org_id, email, full_name, credentials, role, password_hash) VALUES ($1, lower($2), $3, $4, 'admin', $5)
     RETURNING id, org_id, email, full_name, role`,
    [org.id, email, full_name, credentials || null, hashPassword(password)]
  )).rows[0];
  req.user = user;
  setSession(res, user);
  await audit(req, 'account.created', 'organization', org.id, { organization });
  res.status(201).json({ user });
}));

router.post('/auth/login', loginRateLimit, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = (await q('SELECT * FROM users WHERE lower(email) = lower($1)', [email || ''])).rows[0];
  if (!user || !user.active || !verifyPassword(password || '', user.password_hash)) {
    await audit({ ...req, user: null }, 'auth.login_failed', 'user', null, { email: String(email || '').slice(0, 200), org_id: user?.org_id });
    throw bad('Email or password is incorrect.', 401);
  }
  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  req.user = user;
  setSession(res, user);
  await audit(req, 'auth.login', 'user', user.id);
  res.json({ user: { id: user.id, org_id: user.org_id, email: user.email, full_name: user.full_name, role: user.role } });
}));

router.post('/auth/logout', wrap(async (req, res) => {
  if (req.user) await audit(req, 'auth.logout', 'user', req.user.id);
  clearSession(res);
  res.json({ ok: true });
}));

router.get('/me', requireUser, wrap(async (req, res) => {
  const org = (await q('SELECT * FROM organizations WHERE id = $1', [req.user.org_id])).rows[0];
  res.json({ user: req.user, organization: org });
}));

// ---------- Team ----------
router.get('/users', requireRole('admin', 'compliance_officer'), wrap(async (req, res) => {
  const { rows } = await q('SELECT id, email, full_name, credentials, role, active, last_login_at FROM users WHERE org_id = $1 ORDER BY full_name', [req.user.org_id]);
  res.json(rows);
}));

router.post('/users', requireRole('admin'), wrap(async (req, res) => {
  const { email, full_name, role, credentials, password } = req.body || {};
  if (!ROLES.includes(role)) throw bad(`Role must be one of: ${ROLES.join(', ')}`);
  const pwError = validatePassword(password);
  if (pwError) throw bad(pwError);
  const user = (await q(
    `INSERT INTO users (org_id, email, full_name, credentials, role, password_hash) VALUES ($1, lower($2), $3, $4, $5, $6)
     RETURNING id, email, full_name, role`,
    [req.user.org_id, email, full_name, credentials || null, role, hashPassword(password)]
  ).catch((e) => { throw e.code === '23505' ? bad('That email is already in use.', 409) : e; })).rows[0];
  await audit(req, 'user.created', 'user', user.id, { email: user.email, role });
  res.status(201).json(user);
}));

// ---------- Organization setup ----------
router.get('/setup/options', (_req, res) => res.json({ orgTypes: ORG_TYPES, services: SERVICES, states: STATES }));

router.post('/setup', requireRole('admin'), wrap(async (req, res) => {
  const { org_type, state, services = [], beds, accreditor } = req.body || {};
  if (!ORG_TYPES.some((t) => t.id === org_type)) throw bad('Choose an organization type.');
  if (!STATES.includes(state)) throw bad('Choose a state.');
  const svc = services.filter((s) => SERVICES.includes(s));
  await q(
    `UPDATE organizations SET org_type=$1, state=$2, services=$3, beds=$4, accreditor=$5, setup_complete=TRUE WHERE id=$6`,
    [org_type, state, svc, Number.isFinite(+beds) && beds !== '' ? +beds : null, accreditor || null, req.user.org_id]
  );
  // Match regulations: applies to this type (or any), and either has no service condition or shares a service.
  const { rows } = await q(
    `SELECT id FROM regulations
      WHERE (applies_to_types && $1::text[] OR 'any' = ANY(applies_to_types))
        AND (cardinality(applies_to_services) = 0 OR applies_to_services && $2::text[])
        AND (state IS NULL OR state = $3)`,
    [[org_type], svc, state]
  );
  await q('DELETE FROM org_regulations WHERE org_id = $1 AND status = $2', [req.user.org_id, 'not_started']);
  for (const r of rows) {
    await q('INSERT INTO org_regulations (org_id, regulation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.org_id, r.id]);
  }
  await audit(req, 'organization.setup', 'organization', req.user.org_id, { org_type, state, services: svc, regulations: rows.length });
  res.json({ ok: true, regulationsMatched: rows.length });
}));

router.get('/compliance', requireUser, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT r.id, r.code, r.title, r.level, r.authority, r.summary, r.required_policies, orr.status,
            (SELECT count(*) FROM policy_regulations pr JOIN policies p ON p.id = pr.policy_id
              WHERE pr.regulation_id = r.id AND p.org_id = $1 AND p.status = 'approved')::int AS approved_policies
       FROM org_regulations orr JOIN regulations r ON r.id = orr.regulation_id
      WHERE orr.org_id = $1
      ORDER BY CASE r.level WHEN 'federal' THEN 1 WHEN 'state' THEN 2 ELSE 3 END, r.code`,
    [req.user.org_id]
  );
  const total = rows.length;
  const covered = rows.filter((r) => r.approved_policies > 0).length;
  res.json({ score: total ? Math.round((covered / total) * 100) : 0, covered, total, regulations: rows });
}));

// ---------- Policies ----------
router.get('/policies', requireUser, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT p.*, u.full_name AS owner_name,
            (SELECT count(*) FROM acknowledgments a WHERE a.policy_id = p.id AND a.version = p.current_version)::int AS acknowledgments,
            (SELECT count(*) FROM users WHERE org_id = p.org_id AND active)::int AS staff_count
       FROM policies p LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.org_id = $1 ${req.user.role === 'staff' ? "AND p.status = 'approved'" : ''}
      ORDER BY p.updated_at DESC`,
    [req.user.org_id]
  );
  res.json(rows);
}));

router.get('/policies/:id', requireUser, wrap(async (req, res) => {
  const p = (await q('SELECT * FROM policies WHERE id = $1 AND org_id = $2', [req.params.id, req.user.org_id])).rows[0];
  if (!p || (req.user.role === 'staff' && p.status !== 'approved')) throw bad('Policy not found.', 404);
  const versions = (await q(
    `SELECT v.version, v.body, v.source, v.ai_model, v.created_at, u.full_name AS author
       FROM policy_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.policy_id = $1 ORDER BY v.version DESC`, [p.id])).rows;
  const reviews = (await q(
    `SELECT r.version, r.decision, r.comments, r.created_at, u.full_name AS reviewer, u.credentials
       FROM policy_reviews r JOIN users u ON u.id = r.reviewer_id WHERE r.policy_id = $1 ORDER BY r.created_at DESC`, [p.id])).rows;
  const regulations = (await q(
    'SELECT r.id, r.code, r.title FROM policy_regulations pr JOIN regulations r ON r.id = pr.regulation_id WHERE pr.policy_id = $1', [p.id])).rows;
  const acknowledged = (await q('SELECT 1 FROM acknowledgments WHERE policy_id=$1 AND version=$2 AND user_id=$3', [p.id, p.current_version, req.user.id])).rowCount > 0;
  res.json({ ...p, versions, reviews, regulations, acknowledged });
}));

async function addVersion(policyId, body, source, aiModel, userId) {
  const { rows } = await q(
    `UPDATE policies SET current_version = current_version + 1, status = 'draft', updated_at = now() WHERE id = $1 RETURNING current_version`, [policyId]);
  const version = rows[0].current_version;
  await q('INSERT INTO policy_versions (policy_id, version, body, source, ai_model, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
    [policyId, version, body, source, aiModel, userId]);
  return version;
}

router.post('/policies', requireRole(...EDITORS), wrap(async (req, res) => {
  const { title, domain, body, regulation_ids = [], generate } = req.body || {};
  if (!title) throw bad('A policy title is required.');
  const org = (await q('SELECT * FROM organizations WHERE id = $1', [req.user.org_id])).rows[0];
  let text = body, source = 'manual', model = null, phi = null;
  if (generate) {
    const paused = await aiPaused(req.user.org_id);
    if (paused) throw bad(paused, 423);
    const orgContext = `${org.name}; type ${org.org_type || 'not set'}; state ${org.state || 'not set'}; services ${(org.services || []).join(', ') || 'not set'}; beds ${org.beds || 'n/a'}; accreditor ${org.accreditor || 'not set'}.`;
    const r = await runAgent('policy-writer', `${title}${body ? `\n\nAdditional instructions: ${body}` : ''}`, { orgContext });
    text = r.output; source = 'ai'; model = r.model; phi = r.phi;
  } else {
    if (!body) throw bad('Write the policy text, or choose "Generate with AI".');
    const scrub = scrubPHI(body);
    if (scrub.redactions) throw bad(`Policy text appears to contain patient identifiers (${scrub.findings.join(', ')}). Remove them before saving.`);
  }
  const count = (await q('SELECT count(*)::int AS n FROM policies WHERE org_id = $1', [req.user.org_id])).rows[0].n;
  const policy = (await q(
    `INSERT INTO policies (org_id, title, domain, policy_number, owner_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.org_id, title, domain || null, `${(domain || 'GEN').slice(0, 3).toUpperCase()}-${String(count + 1).padStart(4, '0')}`, req.user.id]
  )).rows[0];
  const version = await addVersion(policy.id, text, source, model, req.user.id);
  for (const rid of regulation_ids) {
    await q('INSERT INTO policy_regulations (policy_id, regulation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [policy.id, rid]);
  }
  await audit(req, generate ? 'policy.generated' : 'policy.created', 'policy', policy.id, { title, version, model });
  res.status(201).json({ id: policy.id, version, phi });
}));

router.post('/policies/:id/versions', requireRole(...EDITORS), wrap(async (req, res) => {
  const p = (await q('SELECT * FROM policies WHERE id = $1 AND org_id = $2', [req.params.id, req.user.org_id])).rows[0];
  if (!p) throw bad('Policy not found.', 404);
  const body = req.body?.body;
  if (!body) throw bad('Policy text is required.');
  const scrub = scrubPHI(body);
  if (scrub.redactions) throw bad(`Policy text appears to contain patient identifiers (${scrub.findings.join(', ')}). Remove them before saving.`);
  const version = await addVersion(p.id, body, 'manual', null, req.user.id);
  await audit(req, 'policy.revised', 'policy', p.id, { version });
  res.json({ version });
}));

router.post('/policies/:id/submit', requireRole(...EDITORS), wrap(async (req, res) => {
  const { rowCount } = await q(`UPDATE policies SET status='in_review', updated_at=now() WHERE id=$1 AND org_id=$2 AND status='draft'`, [req.params.id, req.user.org_id]);
  if (!rowCount) throw bad('Only draft policies can be sent for review.', 409);
  await audit(req, 'policy.submitted_for_review', 'policy', req.params.id);
  res.json({ ok: true });
}));

router.post('/policies/:id/review', requireRole(...REVIEWERS), wrap(async (req, res) => {
  const { decision, comments } = req.body || {};
  if (!['approved', 'changes_requested'].includes(decision)) throw bad('Decision must be approved or changes_requested.');
  const p = (await q('SELECT * FROM policies WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id])).rows[0];
  if (!p) throw bad('Policy not found.', 404);
  if (p.status !== 'in_review') throw bad('This policy is not waiting for review.', 409);
  const authorId = (await q('SELECT created_by FROM policy_versions WHERE policy_id=$1 AND version=$2', [p.id, p.current_version])).rows[0]?.created_by;
  if (authorId === req.user.id) throw bad('You cannot approve a version you wrote. A different reviewer is required.', 403);
  await q('INSERT INTO policy_reviews (policy_id, version, reviewer_id, decision, comments) VALUES ($1,$2,$3,$4,$5)',
    [p.id, p.current_version, req.user.id, decision, comments || null]);
  let archivedTo = null;
  if (decision === 'approved') {
    await q(`UPDATE policies SET status='approved', next_review_date = (now() + interval '1 year')::date, updated_at=now() WHERE id=$1`, [p.id]);
    const body = (await q('SELECT body FROM policy_versions WHERE policy_id=$1 AND version=$2', [p.id, p.current_version])).rows[0].body;
    if (storageProvider()) {
      try {
        archivedTo = await archiveDocument(`org-${p.org_id}/policies/${p.policy_number || p.id}/v${p.current_version}.md`,
          `# ${p.title}\n\nPolicy ${p.policy_number} | Version ${p.current_version} | Approved by ${req.user.full_name}${req.user.credentials ? `, ${req.user.credentials}` : ''} on ${new Date().toISOString().slice(0, 10)}\n\n${body}`);
      } catch (e) { console.error('Archive failed:', e.message); }
    }
  } else {
    await q(`UPDATE policies SET status='draft', updated_at=now() WHERE id=$1`, [p.id]);
  }
  await audit(req, `policy.${decision}`, 'policy', p.id, { version: p.current_version, comments, archivedTo });
  res.json({ ok: true, archivedTo });
}));

router.post('/policies/:id/acknowledge', requireUser, wrap(async (req, res) => {
  const p = (await q(`SELECT * FROM policies WHERE id=$1 AND org_id=$2 AND status='approved'`, [req.params.id, req.user.org_id])).rows[0];
  if (!p) throw bad('Only approved policies can be acknowledged.', 404);
  await q('INSERT INTO acknowledgments (policy_id, version, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [p.id, p.current_version, req.user.id]);
  await audit(req, 'policy.acknowledged', 'policy', p.id, { version: p.current_version });
  res.json({ ok: true });
}));

// ---------- Audit log ----------
router.get('/audit', requireRole('admin', 'compliance_officer'), wrap(async (req, res) => {
  const limit = Math.min(+req.query.limit || 200, 1000);
  const { rows } = await q(
    `SELECT a.created_at, a.action, a.entity, a.entity_id, a.detail, a.ip, u.full_name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.org_id = $1 ORDER BY a.created_at DESC LIMIT $2`, [req.user.org_id, limit]);
  if (req.query.format === 'csv') {
    const csv = ['time,user,action,entity,entity_id,ip,detail',
      ...rows.map((r) => [r.created_at.toISOString(), r.user_name || '', r.action, r.entity || '', r.entity_id || '', r.ip || '', JSON.stringify(r.detail)]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    await audit(req, 'audit.exported', 'audit_log', null, { rows: rows.length });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="future4000-audit-log.csv"');
    return res.send(csv);
  }
  res.json(rows);
}));

// ---------- Agents (logged-in, with organization context) ----------
router.post('/org/agents/:id/run', requireUser, wrap(async (req, res) => {
  const paused = await aiPaused(req.user.org_id);
  if (paused) throw bad(paused, 423);
  const org = (await q('SELECT name, org_type, state, services, accreditor FROM organizations WHERE id=$1', [req.user.org_id])).rows[0];
  let documents;
  const files = req.body?.documents || (req.body?.document ? [req.body.document] : []);
  if (files.length > 3) throw bad('Upload at most 3 files.');
  if (files.length) {
    documents = files.map(({ name = 'document', type = '', data }) => {
      const bytes = Buffer.from(String(data || ''), 'base64');
      if (!bytes.length) throw bad(`${name} is empty.`);
      if (bytes.length > 4.5 * 1024 * 1024) throw bad(`${name} is larger than 4.5 MB.`);
      const format = type === 'application/pdf' || /\.pdf$/i.test(name) ? 'pdf' : 'txt';
      if (format === 'pdf' && bytes.subarray(0, 4).toString() !== '%PDF') throw bad(`${name} is not a valid PDF.`);
      if (format === 'txt' && bytes.subarray(0, 2000).includes(0)) throw bad(`${name}: upload a PDF or a plain-text file.`);
      return { name, format, bytes: new Uint8Array(bytes) };
    });
  }
  const regs = (await q('SELECT r.code, r.title FROM org_regulations o JOIN regulations r ON r.id=o.regulation_id WHERE o.org_id=$1', [req.user.org_id])).rows;
  const r = await runAgent(req.params.id, req.body?.input || (documents ? 'Review the attached document.' : ''), {
    documents,
    orgContext: `${org.name}; type ${org.org_type || 'not set'}; state ${org.state || 'not set'}; services ${(org.services || []).join(', ')}; accreditor ${org.accreditor || 'not set'}. Mapped requirements: ${regs.map((x) => `${x.code} (${x.title})`).join('; ') || 'none yet'}`
  });
  await audit(req, 'ai.agent_run', 'agent', req.params.id, { model: r.model, provider: r.provider, phi_redactions: r.phi.redactions, failovers: r.failovers.length, documents: documents?.map((d) => d.name) });
  res.json(r);
}));

// ---------- F4 Templates (one-click compliance packs) ----------
router.get('/templates', requireUser, wrap(async (req, res) => {
  const regs = (await q('SELECT code, title, required_policies FROM regulations')).rows;
  const existing = new Set((await q('SELECT lower(title) AS t FROM policies WHERE org_id=$1', [req.user.org_id])).rows.map((r) => r.t));
  res.json(PACKS.map((p) => {
    const policies = regs.filter((r) => p.regs.includes(r.code)).flatMap((r) => r.required_policies);
    return { ...p, policies, alreadyCreated: policies.filter((t) => existing.has(t.toLowerCase())).length };
  }));
}));

// Durable job: each policy in the pack is one recorded step, so an interrupted pack resumes where it stopped.
registerJob('template.apply', async (ctx, { packId, useAI, orgId, userId }) => {
  const pack = PACKS.find((p) => p.id === packId);
  const org = (await q('SELECT * FROM organizations WHERE id=$1', [orgId])).rows[0];
  const regs = (await q('SELECT * FROM regulations WHERE code = ANY($1)', [pack.regs])).rows;
  const work = regs.flatMap((reg) => reg.required_policies.map((title) => ({ reg, title })));
  await ctx.setTotal(work.length);
  const created = [];
  for (const { reg, title } of work) {
    const out = await ctx.step(`policy:${title}`, async () => {
      const exists = (await q('SELECT id FROM policies WHERE org_id=$1 AND lower(title)=lower($2)', [orgId, title])).rows[0];
      if (exists) return { skipped: true, title };
      if (useAI && await aiPaused(orgId)) throw Object.assign(new Error('AI was paused while this job was running.'), { noRetry: true });
      let body = skeleton(title, reg, org.name), source = 'manual', model = null;
      if (useAI) {
        const r = await runAgent('policy-writer', `${title} (to meet ${reg.title})`, { orgContext: `${org.name}; type ${org.org_type}; state ${org.state}; services ${(org.services || []).join(', ')}; accreditor ${org.accreditor || 'not set'}` });
        body = r.output; source = 'ai'; model = r.model;
      }
      const count = (await q('SELECT count(*)::int AS n FROM policies WHERE org_id=$1', [orgId])).rows[0].n;
      const p = (await q('INSERT INTO policies (org_id, title, domain, policy_number, owner_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [orgId, title, pack.domain, `${pack.domain.slice(0, 3).toUpperCase()}-${String(count + 1).padStart(4, '0')}`, userId])).rows[0];
      await addVersion(p.id, body, source, model, userId);
      await q('INSERT INTO policy_regulations (policy_id, regulation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.id, reg.id]);
      return { id: p.id, title, source };
    });
    if (!out.skipped) created.push(out);
  }
  await q('INSERT INTO audit_log (org_id, user_id, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5,$6)',
    [orgId, userId, 'template.applied', 'template', packId, { created: created.length, ai: useAI, job: ctx.job.id }]);
  return { created };
});

router.post('/templates/:id/apply', requireRole(...EDITORS), wrap(async (req, res) => {
  const pack = PACKS.find((p) => p.id === req.params.id);
  if (!pack) throw bad('Template not found.', 404);
  const useAI = Boolean(req.body?.ai);
  if (useAI) { const paused = await aiPaused(req.user.org_id); if (paused) throw bad(paused, 423); }
  const jobId = await enqueue('template.apply', { orgId: req.user.org_id, userId: req.user.id, input: { packId: pack.id, useAI, orgId: req.user.org_id, userId: req.user.id } });
  await audit(req, 'job.started', 'job', jobId, { type: 'template.apply', pack: pack.id, ai: useAI });
  res.status(202).json({ job: jobId });
}));

router.get('/jobs/:id', requireUser, wrap(async (req, res) => {
  const j = await getJob(req.params.id, req.user.org_id);
  if (!j) throw bad('Job not found.', 404);
  res.json(j);
}));
router.post('/jobs/:id/cancel', requireRole(...EDITORS), wrap(async (req, res) => {
  if (!await cancelJob(req.params.id, req.user.org_id)) throw bad('Job is not running.', 409);
  await audit(req, 'job.canceled', 'job', req.params.id);
  res.json({ ok: true });
}));

// ---------- F4 Compliance Blueprint: export one facility's setup, import it into another ----------
const BLUEPRINT_VERSION = 1;
router.get('/blueprint', requireRole('admin', 'compliance_officer'), wrap(async (req, res) => {
  const org = (await q('SELECT name, org_type, state, services, beds, accreditor, governance_answers FROM organizations WHERE id=$1', [req.user.org_id])).rows[0];
  const policies = (await q(
    `SELECT p.title, p.domain, v.body, COALESCE(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS regulations
       FROM policies p JOIN policy_versions v ON v.policy_id=p.id AND v.version=p.current_version
       LEFT JOIN policy_regulations pr ON pr.policy_id=p.id LEFT JOIN regulations r ON r.id=pr.regulation_id
      WHERE p.org_id=$1 AND p.status='approved' GROUP BY p.id, v.body ORDER BY p.title`, [req.user.org_id])).rows;
  const aiSystems = (await q(`SELECT name, vendor, model, purpose, source, risk_level, human_approval_boundary, approved_use FROM ai_systems WHERE org_id=$1 AND status <> 'retired'`, [req.user.org_id])).rows;
  const blueprint = {
    kind: 'FUTURE4000ComplianceBlueprint', version: BLUEPRINT_VERSION, exported_at: new Date().toISOString(), source_organization: org.name,
    profile: { org_type: org.org_type, state: org.state, services: org.services, beds: org.beds, accreditor: org.accreditor },
    policies, ai_systems: aiSystems, governance_answers: org.governance_answers || {}
  };
  await audit(req, 'blueprint.exported', 'organization', req.user.org_id, { policies: policies.length });
  res.setHeader('Content-Disposition', `attachment; filename="future4000-blueprint-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(blueprint);
}));

router.post('/blueprint/import', requireRole('admin'), wrap(async (req, res) => {
  const b = req.body?.blueprint;
  const dryRun = req.body?.dry_run === true;
  if (!b || b.kind !== 'FUTURE4000ComplianceBlueprint') throw bad('This is not a FUTURE4000 Compliance Blueprint file.');
  if (b.version > BLUEPRINT_VERSION) throw bad('This blueprint was made by a newer version of FUTURE4000.');
  if (!Array.isArray(b.policies) || b.policies.length > 2000) throw bad('The blueprint policy list is invalid.');
  for (const p of b.policies) {
    if (!p.title || !p.body) throw bad('Every policy needs a title and text.');
    const scan = scrubPHI(p.body);
    if (scan.redactions) throw bad(`Policy "${p.title}" appears to contain patient identifiers (${scan.findings.join(', ')}). Remove them before importing.`);
  }
  const existing = new Set((await q('SELECT lower(title) AS t FROM policies WHERE org_id=$1', [req.user.org_id])).rows.map((r) => r.t));
  const plan = {
    profile: b.profile ? `Set type ${b.profile.org_type}, state ${b.profile.state}, ${b.profile.services?.length || 0} services` : 'No profile change',
    policies_to_create: b.policies.filter((p) => !existing.has(p.title.toLowerCase())).map((p) => p.title),
    policies_skipped: b.policies.filter((p) => existing.has(p.title.toLowerCase())).map((p) => p.title),
    ai_systems_to_add: (b.ai_systems || []).map((x) => x.name),
    governance_answers: Object.keys(b.governance_answers || {}).length
  };
  if (dryRun) return res.json({ dry_run: true, plan });
  if (b.profile && ORG_TYPES.some((t) => t.id === b.profile.org_type) && STATES.includes(b.profile.state)) {
    const svc = (b.profile.services || []).filter((x) => SERVICES.includes(x));
    await q('UPDATE organizations SET org_type=$1, state=$2, services=$3, beds=$4, accreditor=$5, setup_complete=TRUE WHERE id=$6',
      [b.profile.org_type, b.profile.state, svc, b.profile.beds || null, b.profile.accreditor || null, req.user.org_id]);
    const regs = (await q(`SELECT id FROM regulations WHERE (applies_to_types && $1::text[] OR 'any' = ANY(applies_to_types))
      AND (cardinality(applies_to_services)=0 OR applies_to_services && $2::text[]) AND (state IS NULL OR state=$3)`, [[b.profile.org_type], svc, b.profile.state])).rows;
    for (const r of regs) await q('INSERT INTO org_regulations (org_id, regulation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.org_id, r.id]);
  }
  // Imported policies arrive as drafts: each site must have its own clinician approve them.
  for (const p of b.policies.filter((x) => !existing.has(x.title.toLowerCase()))) {
    const count = (await q('SELECT count(*)::int AS n FROM policies WHERE org_id=$1', [req.user.org_id])).rows[0].n;
    const np = (await q('INSERT INTO policies (org_id, title, domain, policy_number, owner_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.user.org_id, p.title.slice(0, 300), p.domain || null, `${(p.domain || 'GEN').slice(0, 3).toUpperCase()}-${String(count + 1).padStart(4, '0')}`, req.user.id])).rows[0];
    await addVersion(np.id, `${p.body}\n\n[Imported from blueprint "${String(b.source_organization || '').slice(0, 120)}". Review for this facility before approval.]`, 'manual', null, req.user.id);
    if (Array.isArray(p.regulations) && p.regulations.length) {
      await q('INSERT INTO policy_regulations (policy_id, regulation_id) SELECT $1, id FROM regulations WHERE code = ANY($2) ON CONFLICT DO NOTHING', [np.id, p.regulations]);
    }
  }
  for (const x of b.ai_systems || []) {
    const dup = (await q('SELECT 1 FROM ai_systems WHERE org_id=$1 AND lower(name)=lower($2)', [req.user.org_id, x.name || ''])).rowCount;
    if (!dup && x.name) await q(`INSERT INTO ai_systems (org_id, name, vendor, model, purpose, source, risk_level, human_approval_boundary, approved_use)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [req.user.org_id, x.name, x.vendor, x.model, x.purpose,
      ['approved', 'embedded_vendor', 'shadow'].includes(x.source) ? x.source : 'approved', ['low', 'medium', 'high'].includes(x.risk_level) ? x.risk_level : 'medium', x.human_approval_boundary, x.approved_use]);
  }
  if (b.governance_answers && typeof b.governance_answers === 'object') {
    await q(`UPDATE organizations SET governance_answers = $1::jsonb || governance_answers WHERE id=$2`, [JSON.stringify(b.governance_answers), req.user.org_id]);
  }
  await audit(req, 'blueprint.imported', 'organization', req.user.org_id, { from: b.source_organization, created: plan.policies_to_create.length });
  res.json({ dry_run: false, plan });
}));

// ---------- Daily scan ----------
router.get('/scan/latest', requireUser, wrap(async (req, res) => {
  await q(SCAN_SCHEMA);
  const r = (await q('SELECT ran_at, summary FROM scan_reports WHERE org_id=$1 ORDER BY ran_at DESC LIMIT 1', [req.user.org_id])).rows[0];
  const updates = (await q(`SELECT title, doc_type, agencies, publication_date, effective_on, html_url FROM regulatory_updates ORDER BY publication_date DESC NULLS LAST LIMIT 15`)).rows;
  res.json({ latest: r || null, updates });
}));
router.post('/scan/run', requireRole('admin', 'compliance_officer'), wrap(async (req, res) => {
  const r = await runDailyScan();
  await audit(req, 'scan.manual', 'scan', null, { newUpdates: r.newUpdates });
  res.json({ ...r, reports: undefined });
}));

// ---------- Subscriptions (embedded Stripe Checkout) ----------
router.post('/billing/subscribe', requireRole('admin'), wrap(async (req, res) => {
  if (!stripe) throw bad('Stripe is not connected yet. Add STRIPE_SECRET_KEY to your environment.', 503);
  const planId = req.body?.plan;
  const plan = PLANS[planId];
  if (!plan) throw bad('Choose a valid plan.');
  const org = (await q('SELECT * FROM organizations WHERE id=$1', [req.user.org_id])).rows[0];
  let customer = org.stripe_customer_id;
  if (!customer) {
    customer = (await stripe.customers.create({ name: org.name, email: req.user.email, metadata: { org_id: String(org.id) } })).id;
    await q('UPDATE organizations SET stripe_customer_id=$1 WHERE id=$2', [customer, org.id]);
  }
  const origin = `${req.protocol}://${req.get('host')}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    ui_mode: 'embedded',
    customer,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: plan.amount, recurring: { interval: 'month' }, product_data: { name: `FUTURE4000 ${plan.name}` } } }],
    metadata: { org_id: String(org.id), plan: planId },
    subscription_data: { metadata: { org_id: String(org.id), plan: planId } },
    return_url: `${origin}/app?billing=done&session_id={CHECKOUT_SESSION_ID}`
  });
  await audit(req, 'billing.checkout_started', 'organization', org.id, { plan: planId });
  res.json({ clientSecret: session.client_secret });
}));

router.post('/billing/portal', requireRole('admin'), wrap(async (req, res) => {
  if (!stripe) throw bad('Stripe is not connected yet.', 503);
  const org = (await q('SELECT stripe_customer_id FROM organizations WHERE id=$1', [req.user.org_id])).rows[0];
  if (!org.stripe_customer_id) throw bad('No billing account yet. Choose a plan first.', 404);
  const session = await stripe.billingPortal.sessions.create({ customer: org.stripe_customer_id, return_url: `${req.protocol}://${req.get('host')}/app` });
  res.json({ url: session.url });
}));

// Called from the Stripe webhook handler in server.js.
export async function handleStripeEvent(event) {
  if (!dbConfigured()) return;
  const seen = await q('INSERT INTO stripe_events (id, type) VALUES ($1,$2) ON CONFLICT DO NOTHING', [event.id, event.type]);
  if (!seen.rowCount) return; // already processed
  const obj = event.data.object;
  const orgId = obj.metadata?.org_id;
  if (event.type === 'checkout.session.completed' && orgId) {
    await q(`UPDATE organizations SET plan=$1, plan_status='active', stripe_subscription_id=$2 WHERE id=$3`, [obj.metadata.plan, obj.subscription, orgId]);
  } else if (event.type.startsWith('customer.subscription.') && orgId) {
    const status = event.type === 'customer.subscription.deleted' ? 'canceled' : obj.status;
    await q('UPDATE organizations SET plan_status=$1 WHERE id=$2', [status, orgId]);
  } else if (event.type === 'invoice.payment_failed' && obj.customer) {
    await q(`UPDATE organizations SET plan_status='past_due' WHERE stripe_customer_id=$1`, [obj.customer]);
  }
  if (orgId) await q('INSERT INTO audit_log (org_id, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)', [orgId, `stripe.${event.type}`, 'stripe', obj.id, {}]);
}
