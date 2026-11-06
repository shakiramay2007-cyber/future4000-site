// AI Governance: inventory, ownership, human authority (pause), evidence (decision log, overrides, incidents),
// and a 25-question governance readiness checklist across five areas.
import express from 'express';
import { q } from './db.js';
import { requireUser, requireRole, audit } from './auth.js';

export const GOV_SCHEMA = `
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_paused_reason TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS governance_answers JSONB NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS ai_systems (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL, vendor TEXT, model TEXT, purpose TEXT,
  source TEXT NOT NULL DEFAULT 'approved' CHECK (source IN ('approved','embedded_vendor','shadow')),
  risk_level TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high')),
  executive_owner TEXT, system_owner TEXT, domain_owner TEXT,
  human_approval_boundary TEXT, approved_use TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','retired')),
  next_review DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_incidents (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  system_id BIGINT REFERENCES ai_systems(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('incident','near_miss','override','drift')),
  severity TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high')),
  description TEXT NOT NULL, action_taken TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  reported_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_systems_org ON ai_systems(org_id);
CREATE INDEX IF NOT EXISTS idx_ai_incidents_org ON ai_incidents(org_id, created_at DESC);
`;

// 25 governance questions in five areas (wording is FUTURE4000's own).
export const GOV_QUESTIONS = [
  ['Visibility', 'inventory', 'Is every AI model, vendor AI feature and AI-assisted workflow listed in the inventory?'],
  ['Visibility', 'embedded', 'How do you catch AI added to existing software through updates, without a new purchase?'],
  ['Visibility', 'shadow', 'Where are staff using unapproved AI tools, and why is the approved path not working for them?'],
  ['Visibility', 'touchpoints', 'Which patient, staff or business decisions does AI now inform or complete?'],
  ['Visibility', 'concentration', 'Where does one model, vendor or dataset affect more of the organization than leaders realize?'],
  ['Ownership', 'exec_owner', 'Which executive is accountable when an AI system causes a material problem?'],
  ['Ownership', 'system_owner', 'Does every approved AI system have one named person responsible for it?'],
  ['Ownership', 'decision_owner', 'Who keeps final responsibility for decisions that AI contributes to?'],
  ['Ownership', 'domain_owner', 'Which clinical or professional expert confirms the system fits real work?'],
  ['Ownership', 'vendor', 'What stays the vendor\'s responsibility when the system fails, and what has shifted to you?'],
  ['Human authority', 'boundary', 'Where exactly does automated action stop and human approval begin?'],
  ['Human authority', 'pause', 'Who can pause a live AI system immediately, without waiting for a meeting?'],
  ['Human authority', 'override_safety', 'Are staff protected when they question or override AI output in good faith?'],
  ['Human authority', 'escalation', 'Which signals require human review, leadership attention, or a pause?'],
  ['Human authority', 'reversal', 'How is an AI-assisted action undone, and who has authority to do it?'],
  ['Evidence', 'decision_log', 'Could you reconstruct an AI-assisted decision six months from now?'],
  ['Evidence', 'approved_use', 'Is each system still used only for what leadership approved?'],
  ['Evidence', 'override_record', 'Are overrides reviewed as evidence about the system?'],
  ['Evidence', 'incidents', 'Do you learn from near-misses and weak signals, not only incidents?'],
  ['Evidence', 'traceability', 'Can an outcome be traced back to the system, version, person and approval behind it?'],
  ['Continuous governance', 'performance', 'Is each system still producing the results it was approved for?'],
  ['Continuous governance', 'material_change', 'Which changes (model, vendor, data, permissions, use) send a system back for review?'],
  ['Continuous governance', 'drift', 'What evidence would show a system drifting from its approved behavior?'],
  ['Continuous governance', 'reassessment', 'Has governance kept pace with how the system has changed?'],
  ['Continuous governance', 'retirement', 'Who decides a system should stop operating, and what happens next?']
].map(([area, key, question], i) => ({ n: i + 1, area, key, question }));

export async function aiPaused(orgId) {
  const r = (await q('SELECT ai_paused, ai_paused_reason FROM organizations WHERE id=$1', [orgId])).rows[0];
  return r?.ai_paused ? (r.ai_paused_reason || 'AI is paused by your organization.') : null;
}

export const govRouter = express.Router();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong. The error has been logged.' });
});
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const GOVERNORS = ['admin', 'compliance_officer'];

govRouter.get('/overview', requireUser, wrap(async (req, res) => {
  const org = req.user.org_id;
  const has = (await q('SELECT 1 FROM ai_systems WHERE org_id=$1 LIMIT 1', [org])).rowCount;
  if (!has) {
    await q(`INSERT INTO ai_systems (org_id, name, vendor, model, purpose, risk_level, approved_use, human_approval_boundary, next_review)
             VALUES ($1,'F4 Intelligence (FUTURE4000 AI agents)','Anthropic Claude via AWS Bedrock, with backup providers','Claude Opus / Sonnet / Haiku',
             'Drafting policies, training, summaries and document reviews','medium',
             'Drafts only. No AI output becomes official policy, training, or a decision about a person without approval by a qualified human.',
             'AI drafts; a clinician reviewer approves. Authors cannot approve their own work.', (current_date + 180))`, [org]);
  }
  const o = (await q('SELECT ai_paused, ai_paused_reason, governance_answers FROM organizations WHERE id=$1', [org])).rows[0];
  const systems = (await q('SELECT * FROM ai_systems WHERE org_id=$1 ORDER BY status, name', [org])).rows;
  const incidents = (await q(`SELECT i.*, s.name AS system_name, u.full_name AS reporter FROM ai_incidents i
    LEFT JOIN ai_systems s ON s.id=i.system_id LEFT JOIN users u ON u.id=i.reported_by WHERE i.org_id=$1 ORDER BY i.created_at DESC LIMIT 100`, [org])).rows;
  const decisions = (await q(`SELECT a.created_at, a.action, a.entity_id, a.detail, u.full_name AS user_name FROM audit_log a
    LEFT JOIN users u ON u.id=a.user_id WHERE a.org_id=$1 AND (a.action LIKE 'ai.%' OR a.action IN ('policy.generated','policy.approved','policy.changes_requested','learn.course_created','governance.ai_paused','governance.ai_resumed'))
    ORDER BY a.created_at DESC LIMIT 100`, [org])).rows;
  const overrides = (await q(`SELECT r.created_at, r.comments, p.title, u.full_name AS reviewer FROM policy_reviews r
    JOIN policies p ON p.id=r.policy_id JOIN policy_versions v ON v.policy_id=r.policy_id AND v.version=r.version
    JOIN users u ON u.id=r.reviewer_id WHERE p.org_id=$1 AND v.source='ai' AND r.decision='changes_requested' ORDER BY r.created_at DESC LIMIT 50`, [org])).rows;
  const answers = o.governance_answers || {};
  const answered = GOV_QUESTIONS.filter((g) => String(answers[g.key] || '').trim().length >= 10).length;
  res.json({ paused: o.ai_paused, paused_reason: o.ai_paused_reason, systems, incidents, decisions, overrides,
    questions: GOV_QUESTIONS, answers, readiness: Math.round((answered / GOV_QUESTIONS.length) * 100) });
}));

govRouter.post('/pause', requireRole(...GOVERNORS), wrap(async (req, res) => {
  const pause = req.body?.pause === true;
  const reason = String(req.body?.reason || '').slice(0, 500);
  if (pause && reason.length < 5) throw bad('Give a short reason for pausing AI.');
  await q('UPDATE organizations SET ai_paused=$1, ai_paused_reason=$2 WHERE id=$3', [pause, pause ? `Paused by ${req.user.full_name}: ${reason}` : null, req.user.org_id]);
  await q(`UPDATE ai_systems SET status=$1, updated_at=now() WHERE org_id=$2 AND status <> 'retired' AND name LIKE 'F4 Intelligence%'`, [pause ? 'paused' : 'active', req.user.org_id]);
  await audit(req, pause ? 'governance.ai_paused' : 'governance.ai_resumed', 'organization', req.user.org_id, { reason });
  res.json({ paused: pause });
}));

const SYSTEM_FIELDS = ['name', 'vendor', 'model', 'purpose', 'source', 'risk_level', 'executive_owner', 'system_owner', 'domain_owner', 'human_approval_boundary', 'approved_use', 'status', 'next_review'];
govRouter.post('/systems', requireRole(...GOVERNORS), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name) throw bad('A system name is required.');
  const vals = SYSTEM_FIELDS.map((f) => (b[f] === '' ? null : b[f] ?? null));
  if (!vals[4]) vals[4] = 'approved'; if (!vals[5]) vals[5] = 'medium'; if (!vals[11]) vals[11] = 'active';
  const r = (await q(`INSERT INTO ai_systems (org_id, ${SYSTEM_FIELDS.join(',')}) VALUES ($1, ${SYSTEM_FIELDS.map((_, i) => `$${i + 2}`).join(',')}) RETURNING id`,
    [req.user.org_id, ...vals])).rows[0];
  await audit(req, 'governance.system_added', 'ai_system', r.id, { name: b.name, source: vals[4] });
  res.status(201).json(r);
}));

govRouter.patch('/systems/:id', requireRole(...GOVERNORS), wrap(async (req, res) => {
  const b = req.body || {};
  const fields = SYSTEM_FIELDS.filter((f) => f in b);
  if (!fields.length) throw bad('Nothing to update.');
  const r = await q(`UPDATE ai_systems SET ${fields.map((f, i) => `${f}=$${i + 3}`).join(', ')}, updated_at=now() WHERE id=$1 AND org_id=$2`,
    [req.params.id, req.user.org_id, ...fields.map((f) => (b[f] === '' ? null : b[f]))]);
  if (!r.rowCount) throw bad('System not found.', 404);
  await audit(req, 'governance.system_updated', 'ai_system', req.params.id, { fields });
  res.json({ ok: true });
}));

govRouter.post('/incidents', requireUser, wrap(async (req, res) => {
  const { kind, severity = 'low', description, system_id, action_taken } = req.body || {};
  if (!['incident', 'near_miss', 'override', 'drift'].includes(kind)) throw bad('Choose a report type.');
  if (!description || description.length < 10) throw bad('Describe what happened (at least 10 characters). Do not include patient identifiers.');
  const r = (await q(`INSERT INTO ai_incidents (org_id, system_id, kind, severity, description, action_taken, reported_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.user.org_id, system_id || null, kind, severity, description.slice(0, 4000), action_taken || null, req.user.id])).rows[0];
  await audit(req, 'governance.report_filed', 'ai_incident', r.id, { kind, severity });
  res.status(201).json(r);
}));

govRouter.post('/incidents/:id/close', requireRole(...GOVERNORS), wrap(async (req, res) => {
  const r = await q(`UPDATE ai_incidents SET status='closed', action_taken=COALESCE($3, action_taken) WHERE id=$1 AND org_id=$2`, [req.params.id, req.user.org_id, req.body?.action_taken || null]);
  if (!r.rowCount) throw bad('Report not found.', 404);
  await audit(req, 'governance.report_closed', 'ai_incident', req.params.id);
  res.json({ ok: true });
}));

govRouter.put('/answers', requireRole(...GOVERNORS), wrap(async (req, res) => {
  const incoming = req.body?.answers || {};
  const clean = {};
  for (const g of GOV_QUESTIONS) if (typeof incoming[g.key] === 'string') clean[g.key] = incoming[g.key].slice(0, 2000);
  await q(`UPDATE organizations SET governance_answers = governance_answers || $1::jsonb WHERE id=$2`, [JSON.stringify(clean), req.user.org_id]);
  await audit(req, 'governance.answers_updated', 'organization', req.user.org_id, { keys: Object.keys(clean).length });
  res.json({ ok: true });
}));
