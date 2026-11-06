const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (cents) => `$${(cents / 100).toLocaleString()}`;
const when = (d) => (d ? new Date(d).toLocaleString() : 'never');
const label = (s) => String(s || '').replace(/_/g, ' ');
async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
function show(el, text, kind = '') { el.className = `notice ${kind}`; el.textContent = text; }

let ME = null, ORG = null, STATUS = {};
const isAdmin = () => ME?.role === 'admin';
const isEditor = () => ['admin', 'compliance_officer'].includes(ME?.role);
const isReviewer = () => ['admin', 'clinician_reviewer'].includes(ME?.role);

// ---------- Boot ----------
async function boot() {
  STATUS = await api('/api/status').catch(() => ({}));
  const pills = [['AI', STATUS.ai], ['Database', STATUS.database], ['Storage', STATUS.storage], ['Stripe', STATUS.stripe]];
  $('#status').innerHTML = pills.map(([n, on]) => `<span class="pill ${on ? 'on' : ''}">${n} ${on ? (typeof on === 'string' ? esc(on) : 'on') : 'off'}</span>`).join('');
  try {
    const me = await api('/api/me');
    ME = me.user; ORG = me.organization;
    startApp();
  } catch {
    $('#auth').classList.remove('hidden');
    if (!STATUS.database) show($('#auth-msg'), 'The database is not connected yet. Connect the database to enable sign-in.', 'bad');
  }
}

// ---------- Auth ----------
let signup = false;
$('#auth-toggle').addEventListener('click', (e) => {
  e.preventDefault(); signup = !signup;
  $$('.signup-only').forEach((el) => el.classList.toggle('hidden', !signup));
  $('#auth-title').textContent = $('#auth-submit').textContent = signup ? 'Create account' : 'Sign in';
  $('#auth-toggle').textContent = signup ? 'Already have an account? Sign in' : 'New organization? Create an account';
});
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    await api(signup ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body: data });
    location.reload();
  } catch (err) { show($('#auth-msg'), err.message, 'bad'); }
});

function startApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#who').innerHTML = `${esc(ME.full_name)} · ${esc(label(ME.role))} · ${esc(ORG.name)} <a href="#" id="logout">Sign out</a>`;
  $('#logout').addEventListener('click', async (e) => { e.preventDefault(); await api('/api/auth/logout', { method: 'POST' }); location.reload(); });
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', !isEditor()));
  $$('.admin-strict').forEach((el) => el.classList.toggle('hidden', !isAdmin()));
  $$('.editor-only').forEach((el) => el.classList.toggle('hidden', !isEditor()));
  if (!isAdmin()) $('[data-view="billing"]').classList.add('hidden');
  loadDashboard(); loadPolicies().then(loadLearn); loadTemplates(); loadAgents(); loadIntegrations();
  if (isEditor()) { loadTeam(); loadAudit(); loadActivity(); loadGovernance(); }
  if (isAdmin()) loadBilling();
  if (new URLSearchParams(location.search).get('billing') === 'done') {
    $('[data-view="billing"]').click();
    show($('#billing-msg'), 'Thank you. Your subscription is being activated; it appears here within a minute.', 'ok');
  }
}

$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === t.dataset.view));
  if (t.dataset.view === 'audit') loadAudit();
}));

// ---------- Dashboard & setup ----------
let REGS = [];
async function loadDashboard() {
  if (!ORG.setup_complete) {
    if (!isAdmin()) { $('#dashboard').innerHTML = '<p class="lead">Your administrator has not finished organization setup yet.</p>'; return; }
    const opt = await api('/api/setup/options');
    $('#org-type').innerHTML = opt.orgTypes.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
    $('#org-state').innerHTML = opt.states.map((s) => `<option${s === 'GA' ? ' selected' : ''}>${s}</option>`).join('');
    $('#org-services').innerHTML = opt.services.map((s) => `<label class="check"><input type="checkbox" value="${s}"> ${esc(label(s))}</label>`).join('');
    $('#setup').classList.remove('hidden');
    return;
  }
  const c = await api('/api/compliance');
  REGS = c.regulations;
  $('#compliance').classList.remove('hidden');
  $('#score-num').textContent = c.score;
  $('#donut-num').textContent = `${c.score}%`;
  const circ = 2 * Math.PI * 48; $('#donut-fg').style.strokeDasharray = `${(c.score / 100) * circ} ${circ}`;
  $('#welcome-sub').textContent = `${ORG.name} · ${label(ORG.org_type)} · ${ORG.state}${ORG.accreditor ? ` · ${ORG.accreditor}` : ''}`;
  $('#level-bars').innerHTML = ['federal', 'state', 'accreditation'].map((lv) => {
    const rs = c.regulations.filter((r) => r.level === lv); if (!rs.length) return '';
    const pct = Math.round((rs.filter((r) => r.approved_policies).length / rs.length) * 100);
    return `<div class="bar-row"><span>${esc(label(lv))}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>`;
  }).join('');
  $('#stat-regs').textContent = c.total;
  $('#reg-list').innerHTML = c.regulations.map((r) => `
    <div class="reg ${r.approved_policies ? 'ok' : ''}">
      <div><span class="tag lvl-${r.level}">${esc(r.level)}</span> <b>${esc(r.title)}</b> <span class="muted small">${esc(r.authority)}</span></div>
      <p class="small">${esc(r.summary)}</p>
      <p class="small muted">Policies needed: ${r.required_policies.map(esc).join(', ')}</p>
      <span class="small ${r.approved_policies ? 'good' : 'warn'}">${r.approved_policies ? `${r.approved_policies} approved polic${r.approved_policies > 1 ? 'ies' : 'y'}` : 'No approved policy yet'}</span>
    </div>`).join('');
  loadScan();
  $('#new-policy-regs').innerHTML = REGS.map((r) => `<label class="check"><input type="checkbox" value="${r.id}"> ${esc(r.code)}</label>`).join('');
}
$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  data.services = $$('#org-services input:checked').map((i) => i.value);
  const r = await api('/api/setup', { method: 'POST', body: data });
  alertless(`${r.regulationsMatched} requirements mapped.`);
  location.reload();
});
function alertless(msg) { console.log(msg); }

async function loadScan() {
  const { latest, updates } = await api('/api/scan/latest');
  const s = latest?.summary;
  $('#scan-time').textContent = latest ? `last run ${when(latest.ran_at)} · runs daily at 8:30 AM ET` : 'not run yet · runs daily at 8:30 AM ET';
  $('#scan-summary').innerHTML = s ? [
    ['New federal updates', s.new_regulatory_updates.length],
    ['Policies due for review (30 days)', s.policies_due_for_review.length],
    ['Reviews waiting 7+ days', s.reviews_waiting_over_7_days.length],
    ['Policies missing staff sign-offs', s.policies_missing_signoffs.length]
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><small>${k}</small></div>`).join('') : '';
  $('#scan-updates').innerHTML = updates.length ? updates.map((u) => `
    <div class="fr"><span class="tag ${u.doc_type === 'Rule' ? 'lvl-federal' : ''}">${esc(u.doc_type || '')}</span>
      <div><a href="${esc(u.html_url)}" target="_blank" rel="noopener" title="${esc(u.title)}">${esc(u.title)}</a>
      <small>${esc((u.agencies || []).slice(-1).join(''))} · ${esc(String(u.publication_date || '').slice(0, 10))}${u.effective_on ? ` · effective ${esc(String(u.effective_on).slice(0, 10))}` : ''}</small></div></div>`).join('')
    : '<p class="muted small">No updates yet. Run the scan to pull the latest Federal Register rules.</p>';
}
$('#scan-run').addEventListener('click', async (e) => {
  e.target.disabled = true; e.target.textContent = 'Scanning...';
  try { await api('/api/scan/run', { method: 'POST' }); await loadScan(); } catch (err) { console.error(err); }
  e.target.disabled = false; e.target.textContent = 'Run scan now';
});

// ---------- Policies ----------
let POLICIES = [];
async function loadPolicies() {
  POLICIES = await api('/api/policies');
  $('#stat-policies').textContent = POLICIES.length;
  $('#stat-review').textContent = POLICIES.filter((p) => p.status === 'in_review').length;
  const counts = { draft: 0, in_review: 0, approved: 0, retired: 0 };
  POLICIES.forEach((p) => counts[p.status]++);
  const max = Math.max(1, ...Object.values(counts));
  $('#pipeline').innerHTML = Object.entries(counts).map(([k, v]) => `<div class="bar-row"><span>${esc(label(k))}</span><div class="bar st-bar-${k}"><i style="width:${(v / max) * 100}%"></i></div><b>${v}</b></div>`).join('');
  $('#policy-list').innerHTML = POLICIES.length ? POLICIES.map((p) => `
    <button class="policy-item" data-id="${p.id}">
      <b>${esc(p.title)}</b>
      <span class="small muted">${esc(p.policy_number || '')} · v${p.current_version} · ${esc(p.domain || 'General')}</span>
      <span class="tag st-${p.status}">${esc(label(p.status))}</span>
      ${p.status === 'approved' ? `<span class="small muted">${p.acknowledgments}/${p.staff_count} staff signed</span>` : ''}
    </button>`).join('') : '<p class="muted">No policies yet.</p>';
  $$('#policy-list .policy-item').forEach((b) => b.addEventListener('click', () => openPolicy(b.dataset.id)));
}

$('#new-policy-btn').addEventListener('click', () => $('#new-policy').classList.toggle('hidden'));
$('#new-policy').addEventListener('submit', async (e) => {
  e.preventDefault();
  const generate = e.submitter?.dataset.generate === '1';
  const data = Object.fromEntries(new FormData(e.target));
  data.generate = generate;
  data.regulation_ids = $$('#new-policy-regs input:checked').map((i) => +i.value);
  const msg = $('#new-policy-msg');
  show(msg, generate ? 'F4 Intelligence is drafting the policy. This can take up to a minute...' : 'Saving...');
  $$('#new-policy button').forEach((b) => (b.disabled = true));
  try {
    const r = await api('/api/policies', { method: 'POST', body: data });
    show(msg, `Saved as draft version ${r.version}.${r.phi?.redactions ? ` ${r.phi.redactions} identifier(s) were masked.` : ''}`, 'ok');
    e.target.reset();
    await loadPolicies();
    openPolicy(r.id);
  } catch (err) { show(msg, err.message, 'bad'); }
  $$('#new-policy button').forEach((b) => (b.disabled = false));
});

async function openPolicy(id) {
  const p = await api(`/api/policies/${id}`);
  const v = p.versions[0];
  const el = $('#policy-detail');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="row-between"><h2>${esc(p.title)}</h2><span class="tag st-${p.status}">${esc(label(p.status))}</span></div>
    <p class="small muted">${esc(p.policy_number)} · Version ${p.current_version} · ${v?.source === 'ai' ? `AI draft (${esc(v.ai_model)})` : 'Written manually'}${p.next_review_date ? ` · Next review ${esc(p.next_review_date.slice(0, 10))}` : ''}</p>
    ${p.regulations.length ? `<p class="small">Supports: ${p.regulations.map((r) => `<span class="tag">${esc(r.code)}</span>`).join(' ')}</p>` : ''}
    <div class="btn-row">
      ${isEditor() && p.status === 'draft' ? '<button class="primary" data-act="submit">Send for clinician review</button>' : ''}
      ${isReviewer() && p.status === 'in_review' ? '<button class="primary" data-act="approve">Approve</button><button class="secondary" data-act="changes">Request changes</button>' : ''}
      ${p.status === 'approved' && !p.acknowledged ? '<button class="primary" data-act="ack">I have read and understand this policy</button>' : ''}
      ${p.status === 'approved' && p.acknowledged ? '<span class="good small">You signed this version.</span>' : ''}
      ${isEditor() ? '<button class="secondary" data-act="edit">Edit (new version)</button>' : ''}
    </div>
    <textarea id="review-comments" class="hidden" rows="3" placeholder="Reviewer comments"></textarea>
    <div id="policy-msg" class="notice hidden"></div>
    <pre class="output" id="policy-body">${esc(v?.body || '')}</pre>
    ${p.reviews.length ? `<h3>Review history</h3>${p.reviews.map((r) => `<p class="small"><b>${esc(label(r.decision))}</b> v${r.version} by ${esc(r.reviewer)}${r.credentials ? `, ${esc(r.credentials)}` : ''} on ${when(r.created_at)}${r.comments ? `: ${esc(r.comments)}` : ''}</p>`).join('')}` : ''}
    <h3>Versions</h3>${p.versions.map((x) => `<p class="small">v${x.version} · ${esc(x.source)} · ${esc(x.author || '')} · ${when(x.created_at)}</p>`).join('')}`;
  const msg = $('#policy-msg', el);
  $$('[data-act]', el).forEach((b) => b.addEventListener('click', async () => {
    try {
      const act = b.dataset.act;
      if (act === 'submit') await api(`/api/policies/${id}/submit`, { method: 'POST' });
      if (act === 'approve' || act === 'changes') {
        const box = $('#review-comments', el);
        if (act === 'changes' && box.classList.contains('hidden')) { box.classList.remove('hidden'); box.focus(); return show(msg, 'Add comments, then click Request changes again.'); }
        const r = await api(`/api/policies/${id}/review`, { method: 'POST', body: { decision: act === 'approve' ? 'approved' : 'changes_requested', comments: box.value } });
        if (r.archivedTo) show(msg, `Approved and archived to ${r.archivedTo}`, 'ok');
      }
      if (act === 'ack') await api(`/api/policies/${id}/acknowledge`, { method: 'POST' });
      if (act === 'edit') {
        const body = $('#policy-body', el);
        if (body.isContentEditable) {
          await api(`/api/policies/${id}/versions`, { method: 'POST', body: { body: body.innerText } });
        } else {
          body.contentEditable = 'true'; body.focus(); b.textContent = 'Save new version'; return;
        }
      }
      await loadPolicies(); openPolicy(id);
    } catch (err) { show(msg, err.message, 'bad'); }
  }));
}

// ---------- Compliance Blueprint import (preview first, then apply) ----------
$('#bp-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  let blueprint;
  try { blueprint = JSON.parse(await f.text()); } catch { return show($('#template-msg'), 'That file is not valid JSON.', 'bad'); }
  try {
    const { plan } = await api('/api/blueprint/import', { method: 'POST', body: { blueprint, dry_run: true } });
    const el = $('#bp-preview'); el.classList.remove('hidden');
    el.innerHTML = `<h3>Review before importing</h3><p class="small">${esc(plan.profile)}</p>
      <p class="small"><b>${plan.policies_to_create.length}</b> policies will be created as drafts${plan.policies_skipped.length ? `; ${plan.policies_skipped.length} skipped (already exist)` : ''}.</p>
      <p class="small"><b>${plan.ai_systems_to_add.length}</b> AI systems and <b>${plan.governance_answers}</b> governance answers.</p>
      <div class="btn-row"><button class="primary" id="bp-apply">Import now</button><button class="secondary" id="bp-cancel">Cancel</button></div>`;
    $('#bp-cancel').onclick = () => { el.classList.add('hidden'); e.target.value = ''; };
    $('#bp-apply').onclick = async () => {
      try { const r = await api('/api/blueprint/import', { method: 'POST', body: { blueprint } });
        show($('#template-msg'), `Imported: ${r.plan.policies_to_create.length} draft policies created.`, 'ok'); el.classList.add('hidden'); e.target.value = ''; loadPolicies(); loadTemplates(); }
      catch (err) { show($('#template-msg'), err.message, 'bad'); }
    };
  } catch (err) { show($('#template-msg'), err.message, 'bad'); }
});

// ---------- Templates ----------
async function loadTemplates() {
  const packs = await api('/api/templates');
  $('#template-grid').innerHTML = packs.map((p) => `
    <div class="card" data-id="${p.id}">
      <h3>${esc(p.name)}</h3><p class="small"><b>For:</b> ${esc(p.for)}</p>
      <div class="tags">${p.regs.map((r) => `<span class="tag">${esc(r)}</span>`).join('')}</div>
      <p>${p.policies.length} policies: ${p.policies.map(esc).join(', ')}</p>
      <p class="small ${p.alreadyCreated === p.policies.length ? 'good' : 'muted'}">${p.alreadyCreated} of ${p.policies.length} already in your library</p>
      ${isEditor() ? `<div class="btn-row"><button data-ai="0">Add as templates</button><button data-ai="1">Add and draft with AI</button></div>` : ''}
    </div>`).join('');
  $$('#template-grid .card button').forEach((b) => b.addEventListener('click', async () => {
    const card = b.closest('.card');
    $$('button', card).forEach((x) => (x.disabled = true));
    show($('#template-msg'), b.dataset.ai === '1' ? 'Drafting each policy with F4 Intelligence. Larger packs can take several minutes...' : 'Creating draft policies...');
    try {
      const { job } = await api(`/api/templates/${card.dataset.id}/apply`, { method: 'POST', body: { ai: b.dataset.ai === '1' } });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const j = await api(`/api/jobs/${job}`);
        if (j.status === 'running' || j.status === 'queued') { show($('#template-msg'), `Working: ${j.done_steps} of ${j.total_steps || '?'} policies done. You can leave this page; the job keeps running and resumes after any restart.`); continue; }
        if (j.status === 'succeeded') show($('#template-msg'), j.result.created.length ? `Created ${j.result.created.length} draft policies: ${j.result.created.map((c) => c.title).join(', ')}. Open the Policies tab to review them.` : 'All policies in this pack are already in your library.', 'ok');
        else show($('#template-msg'), `Job ${j.status}: ${j.error || ''}`, 'bad');
        break;
      }
      loadTemplates(); loadPolicies();
    } catch (e) { show($('#template-msg'), e.message, 'bad'); }
    $$('button', card).forEach((x) => (x.disabled = false));
  }));
}

// ---------- LearnTrack ----------
async function loadLearn() {
  const courses = await api('/api/learn/courses');
  const tot = courses.reduce((a, c) => a + c.staff, 0), done = courses.reduce((a, c) => a + c.completions, 0);
  $('#stat-training').textContent = tot ? `${Math.round((done / tot) * 100)}%` : '0%';
  const approved = POLICIES.filter((p) => p.status === 'approved');
  $('#course-policy').innerHTML = approved.length ? approved.map((p) => `<option value="${p.id}">${esc(p.title)} (v${p.current_version})</option>`).join('') : '<option value="">Approve a policy first</option>';
  $('#course-list').innerHTML = courses.length ? courses.map((c) => `
    <button class="policy-item" data-id="${c.id}"><b>${esc(c.title)}</b>
      <span class="small muted">${c.question_count ? `${c.question_count}-question quiz` : 'Read and attest'} · due ${esc(String(c.due_date).slice(0, 10))}</span>
      <span class="tag ${c.certificate_id ? 'st-approved' : 'st-in_review'}">${c.certificate_id ? `Completed ${c.cert_score}%` : c.best_score != null ? `Best ${c.best_score}%, retake` : 'Not started'}</span>
      ${isEditor() ? `<span class="small muted">${c.completions}/${c.staff} staff completed</span>` : ''}</button>`).join('') : '<p class="muted">No courses yet.</p>';
  $$('#course-list .policy-item').forEach((b) => b.addEventListener('click', () => openCourse(b.dataset.id)));
  if (isEditor()) {
    const rep = await api('/api/learn/report');
    $('#learn-report').innerHTML = rep.map((r) => `<tr><td>${esc(r.full_name)}</td><td>${esc(label(r.role))}</td><td>${esc(r.title)}</td>
      <td>${r.certificate ? `<span class="good">Completed ${r.score}%</span>` : (new Date(r.due_date) < new Date() ? '<span class="bad-text">Overdue</span>' : '<span class="warn">Pending</span>')}</td><td>${esc(String(r.due_date).slice(0, 10))}</td></tr>`).join('');
  }
}
$('#course-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!$('#course-policy').value) return;
  show($('#learn-msg'), 'Building the course with F4 Intelligence...');
  try {
    const r = await api('/api/learn/courses', { method: 'POST', body: { policy_id: +$('#course-policy').value } });
    show($('#learn-msg'), r.source === 'ai' ? `Course created with a ${r.questions}-question quiz.` : 'AI is not connected, so a read-and-attest course was created. Connect AI to add quizzes.', 'ok');
    loadLearn(); openCourse(r.id);
  } catch (err) { show($('#learn-msg'), err.message, 'bad'); }
});
async function openCourse(id) {
  const c = await api(`/api/learn/courses/${id}`);
  const el = $('#course-detail'); el.classList.remove('hidden');
  el.innerHTML = `<h2>${esc(c.title)}</h2>
    <h3>Learning objectives</h3><ul>${c.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
    <h3>Key points</h3><ul>${c.key_points.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
    ${c.scenario ? `<h3>Clinical scenario</h3><p>${esc(c.scenario.situation)}</p>` : ''}
    <details><summary>Read the full policy</summary><pre class="output">${esc(c.reading || '')}</pre></details>
    <form id="quiz">${c.questions.length ? c.questions.map((q, i) => `
      <fieldset class="q"><legend>${i + 1}. ${esc(q.question)}</legend>${q.options.map((o, j) => `
        <label class="check opt"><input type="radio" name="q${i}" value="${j}" required> ${esc(o)}</label>`).join('')}<div class="fb small"></div></fieldset>`).join('')
      : '<label class="check"><input type="checkbox" id="attest" required> I have read and understand this policy.</label>'}
      <button class="primary">Submit</button><div id="quiz-msg" class="notice hidden"></div></form>`;
  $('#quiz', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const answers = c.questions.map((_, i) => +new FormData(e.target).get(`q${i}`));
    try {
      const r = await api(`/api/learn/courses/${id}/attempt`, { method: 'POST', body: c.questions.length ? { answers } : { attest: true } });
      $$('.q', el).forEach((fs, i) => { const f = r.feedback[i]; if (!f) return;
        $('.fb', fs).innerHTML = `<span class="${f.correct ? 'good' : 'bad-text'}">${f.correct ? 'Correct.' : `Incorrect. Answer: ${esc(c.questions[i].options[f.answer])}.`}</span> ${esc(f.rationale || '')}`; });
      show($('#quiz-msg', el), r.passed ? `Passed with ${r.score}%. ` : `Score ${r.score}%. You need ${r.pass_score}% to pass. Review and try again.`, r.passed ? 'ok' : 'bad');
      if (r.certificate) $('#quiz-msg', el).insertAdjacentHTML('beforeend', `<a href="/api/learn/certificates/${r.certificate}" target="_blank">Open your certificate</a>`);
      loadLearn(); loadPolicies();
    } catch (err) { show($('#quiz-msg', el), err.message, 'bad'); }
  });
}

// ---------- Agents ----------
let currentAgent = null;
async function loadAgents() {
  const agents = await api('/api/agents');
  $('#agent-list').innerHTML = agents.map((a) => `<button class="agent-item" data-id="${a.id}"><b>${esc(a.name)}</b><span>${esc(a.subsystem)}</span></button>`).join('');
  $$('.agent-item').forEach((btn) => btn.addEventListener('click', () => {
    currentAgent = agents.find((a) => a.id === btn.dataset.id);
    $$('.agent-item').forEach((b) => b.classList.toggle('active', b === btn));
    $('#agent-title').textContent = currentAgent.name;
    $('#agent-summary').textContent = currentAgent.summary;
    $('#agent-run').disabled = false;
    $('#agent-file-wrap').classList.toggle('hidden', !currentAgent.acceptsDocument);
    $('#agent-file').multiple = (currentAgent.maxDocuments || 1) > 1; $('#agent-file').value = '';
    $('#agent-file-label').textContent = (currentAgent.maxDocuments || 1) > 1 ? `Documents (choose ${currentAgent.maxDocuments})` : 'Document';
  }));
}
$('#agent-run').addEventListener('click', async () => {
  const btn = $('#agent-run'), out = $('#agent-output'), phi = $('#agent-phi');
  btn.disabled = true; btn.textContent = 'Working...'; out.classList.add('hidden'); phi.classList.add('hidden'); $('#agent-model').textContent = '';
  try {
    const body = { input: $('#agent-input').value };
    const files = currentAgent.acceptsDocument ? [...$('#agent-file').files] : [];
    if (files.length > (currentAgent.maxDocuments || 1)) throw new Error(`Choose up to ${currentAgent.maxDocuments || 1} file(s).`);
    const read = (f) => new Promise((ok, no) => { const rd = new FileReader(); rd.onload = () => ok({ name: f.name, type: f.type, data: String(rd.result).split(',')[1] }); rd.onerror = no; rd.readAsDataURL(f); });
    if (files.length) body.documents = await Promise.all(files.map(read));
    const r = await api(`/api/org/agents/${currentAgent.id}/run`, { method: 'POST', body });
    if (r.phi?.redactions) show(phi, `Protected: ${r.phi.redactions} identifier(s) masked (${r.phi.types.join(', ')}).`);
    out.textContent = r.output; out.classList.remove('hidden');
    $('#agent-model').textContent = `Answered by ${r.model}${r.failovers?.length ? ` after ${r.failovers.length} automatic failover(s)` : ''}. Clinician review required before official use.`;
  } catch (e) { show(phi, e.message, 'bad'); }
  btn.disabled = false; btn.textContent = 'Run agent';
});

// ---------- Integrations ----------
let INTS = [];
async function loadIntegrations() {
  INTS = await api('/api/integrations');
  const cats = ['All', ...new Set(INTS.map((i) => i.category))];
  $('#int-filters').innerHTML = cats.map((c, i) => `<button class="chip ${i ? '' : 'active'}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  $$('#int-filters .chip').forEach((c) => c.addEventListener('click', () => {
    $$('#int-filters .chip').forEach((x) => x.classList.toggle('active', x === c));
    renderInts(c.dataset.cat);
  }));
  renderInts('All');
}
function renderInts(cat) {
  const list = INTS.filter((i) => cat === 'All' || i.category === cat).sort((a, b) => a.priority - b.priority);
  $('#integration-grid').innerHTML = list.map((i) => `
    <div class="card" data-id="${i.id}">
      <h3>${esc(i.brand)}</h3><p class="small"><b>Connects to:</b> ${esc(i.connects)}</p>
      <div class="tags"><span class="tag">${esc(i.category)}</span>${i.hipaa ? '<span class="tag hipaa">HIPAA-capable</span>' : '<span class="tag">No PHI</span>'}
        <span class="tag ${i.credentialsSet ? 'connected' : 'needs'}">${i.credentialsSet ? 'Credentials set' : 'Needs credentials'}</span></div>
      <p><b>Fixes:</b> ${i.fixes.map(esc).join('; ')}</p>
      <p><b>F4 upgrade:</b> ${esc(i.upgrade)}</p>
      ${i.setup ? `<p class="small"><b>Setup:</b> ${esc(i.setup)}</p>` : ''}
      <button>Test connection</button><div class="result small"></div>
    </div>`).join('');
  $$('#integration-grid .card button').forEach((b) => b.addEventListener('click', async () => {
    const card = b.closest('.card'), res = $('.result', card);
    res.textContent = 'Testing...';
    try {
      const r = await api(`/api/integrations/${card.dataset.id}/test`, { method: 'POST' });
      res.innerHTML = `<span class="${r.ok ? 'good' : 'warn'}">${r.status === 'connected' ? 'Connected: ' : ''}${esc(r.message)}</span>`;
    } catch (e) { res.textContent = e.message; }
  }));
}

// ---------- Team ----------
async function loadTeam() {
  const users = await api('/api/users');
  $('#team-body').innerHTML = users.map((u) => `<tr><td>${esc(u.full_name)}${u.credentials ? `, ${esc(u.credentials)}` : ''}</td><td>${esc(u.email)}</td><td>${esc(label(u.role))}</td><td>${when(u.last_login_at)}</td></tr>`).join('');
}
$('#add-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset(); show($('#team-msg'), 'Team member added. Share their temporary password privately.', 'ok'); loadTeam();
  } catch (err) { show($('#team-msg'), err.message, 'bad'); }
});

// ---------- Activity feed ----------
async function loadActivity() {
  const rows = await api('/api/audit?limit=8');
  $('#activity').innerHTML = rows.map((r) => `<div class="act"><i></i><div><b>${esc(label(r.action.replace('.', ' ')))}</b><small>${esc(r.user_name || 'system')} · ${when(r.created_at)}</small></div></div>`).join('') || '<p class="muted small">No activity yet.</p>';
}
$('#side-search').addEventListener('input', (e) => {
  const t = e.target.value.toLowerCase();
  if (t) $('[data-view="policies"]').click();
  $$('#policy-list .policy-item').forEach((b) => b.classList.toggle('hidden', t && !b.textContent.toLowerCase().includes(t)));
});

// ---------- Audit ----------
async function loadAudit() {
  if (!isEditor()) return;
  const rows = await api('/api/audit?limit=200');
  $('#audit-body').innerHTML = rows.map((r) => `<tr><td>${when(r.created_at)}</td><td>${esc(r.user_name || 'system')}</td><td>${esc(r.action)}</td><td>${esc(r.entity || '')} ${esc(r.entity_id || '')}</td><td class="small">${esc(JSON.stringify(r.detail))}</td></tr>`).join('');
}

// ---------- Billing ----------
let stripeJs = null;
async function loadBilling() {
  $('#current-plan').textContent = ORG.plan === 'none' ? 'none' : `${ORG.plan} (${ORG.plan_status})`;
  const plans = await api('/api/plans');
  $('#plan-grid').innerHTML = Object.entries(plans).map(([id, p]) => `
    <div class="card"><h3>${esc(p.name)}</h3><div class="price">${money(p.amount)} <small>/ month</small></div>
      <p>${esc(p.description)}</p><button data-plan="${id}">Choose ${esc(p.name)}</button></div>`).join('');
  $$('[data-plan]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const { publishableKey } = await api('/api/stripe/config');
      stripeJs = stripeJs || Stripe(publishableKey);
      const { clientSecret } = await api('/api/billing/subscribe', { method: 'POST', body: { plan: b.dataset.plan } });
      $('#checkout').classList.remove('hidden'); $('#checkout').innerHTML = '';
      const checkout = await stripeJs.initEmbeddedCheckout({ clientSecret });
      checkout.mount('#checkout');
    } catch (e) { show($('#billing-msg'), e.message, 'bad'); }
  }));
}
$('#portal-btn').addEventListener('click', async () => {
  try { location.href = (await api('/api/billing/portal', { method: 'POST' })).url; } catch (e) { show($('#billing-msg'), e.message, 'bad'); }
});

// ---------- AI Governance ----------
let GOV = null;
async function loadGovernance() {
  if (!isEditor()) return;
  GOV = await api('/api/governance/overview');
  $('#gov-ready').textContent = `${GOV.readiness}%`;
  $('#gov-systems').textContent = GOV.systems.filter((x) => x.status !== 'retired').length;
  $('#gov-open').textContent = GOV.incidents.filter((x) => x.status === 'open').length;
  $('#gov-overrides').textContent = GOV.overrides.length;
  $('#gov-decisions').textContent = GOV.decisions.length;
  $('#gov-pause-box').innerHTML = GOV.paused
    ? `<span class="tag st-retired">AI PAUSED</span> <button class="primary" id="gov-resume">Resume AI</button>`
    : `<button class="danger" id="gov-pause">Pause all AI now</button>`;
  if (GOV.paused) show($('#gov-msg'), GOV.paused_reason, 'bad'); else $('#gov-msg').classList.add('hidden');
  $('#gov-pause')?.addEventListener('click', async () => {
    const reason = prompt('Reason for pausing all AI (recorded in the audit log):');
    if (!reason) return;
    try { await api('/api/governance/pause', { method: 'POST', body: { pause: true, reason } }); loadGovernance(); } catch (e) { show($('#gov-msg'), e.message, 'bad'); }
  });
  $('#gov-resume')?.addEventListener('click', async () => { await api('/api/governance/pause', { method: 'POST', body: { pause: false } }); loadGovernance(); });
  const src = { approved: 'Approved', embedded_vendor: 'Vendor update', shadow: 'Shadow AI' };
  $('#gov-sys-body').innerHTML = GOV.systems.map((x) => `<tr><td><b>${esc(x.name)}</b><br><span class="small muted">${esc(x.vendor || '')}</span></td>
    <td>${esc(src[x.source])}</td><td><span class="tag risk-${x.risk_level}">${esc(x.risk_level)}</span></td>
    <td class="small">Exec: ${esc(x.executive_owner || 'not named')}<br>System: ${esc(x.system_owner || 'not named')}<br>Domain: ${esc(x.domain_owner || 'not named')}</td>
    <td class="small">${esc(x.human_approval_boundary || 'not defined')}</td><td><span class="tag st-${x.status === 'active' ? 'approved' : 'retired'}">${esc(x.status)}</span></td>
    <td class="small">${esc(String(x.next_review || '').slice(0, 10))}</td></tr>`).join('');
  $('#gov-sys-select').innerHTML = '<option value="">Which system?</option>' + GOV.systems.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  $('#gov-incidents').innerHTML = GOV.incidents.map((i) => `<div class="act"><i class="sev-${i.severity}"></i><div><b>${esc(label(i.kind))} · ${esc(i.severity)} · ${esc(i.status)}</b>
    <small>${esc(i.description)}</small><small>${esc(i.system_name || '')} · ${esc(i.reporter || '')} · ${when(i.created_at)}</small>
    ${i.status === 'open' ? `<a href="#" data-close="${i.id}" class="small">Close</a>` : ''}</div></div>`).join('') || '<p class="muted small">No reports yet.</p>';
  $$('[data-close]').forEach((a) => a.addEventListener('click', async (e) => { e.preventDefault(); await api(`/api/governance/incidents/${a.dataset.close}/close`, { method: 'POST', body: {} }); loadGovernance(); }));
  $('#gov-decisions-list').innerHTML = GOV.decisions.slice(0, 15).map((d) => `<div class="act"><i></i><div><b>${esc(label(d.action.replace(/\./g, ' ')))}</b>
    <small>${esc(d.user_name || 'system')} · ${when(d.created_at)}${d.detail?.model ? ` · ${esc(d.detail.model)}` : ''}</small></div></div>`).join('') || '<p class="muted small">No AI decisions yet.</p>';
  let area = '';
  $('#gov-questions').innerHTML = GOV.questions.map((g) => {
    const head = g.area !== area ? `<h3 class="gov-area">${esc((area = g.area))}</h3>` : '';
    const ok = String(GOV.answers[g.key] || '').trim().length >= 10;
    return `${head}<div class="gq"><label><span class="gq-n ${ok ? 'ok' : ''}">${g.n}</span> ${esc(g.question)}</label>
      <textarea rows="2" data-key="${g.key}" placeholder="Your organization's answer">${esc(GOV.answers[g.key] || '')}</textarea></div>`;
  }).join('');
}
$('#gov-add-btn').addEventListener('click', () => $('#gov-add').classList.toggle('hidden'));
$('#gov-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('/api/governance/systems', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); e.target.classList.add('hidden'); loadGovernance(); }
  catch (err) { show($('#gov-msg'), err.message, 'bad'); }
});
$('#gov-report').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('/api/governance/incidents', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); loadGovernance(); }
  catch (err) { show($('#gov-msg'), err.message, 'bad'); }
});
$('#gov-save').addEventListener('click', async () => {
  const answers = Object.fromEntries($$('#gov-questions textarea').map((t) => [t.dataset.key, t.value]));
  try { await api('/api/governance/answers', { method: 'PUT', body: { answers } }); show($('#gov-msg'), 'Answers saved.', 'ok'); loadGovernance(); }
  catch (err) { show($('#gov-msg'), err.message, 'bad'); }
});

// ---------- F4 Studio: library, matrix, pipeline ----------
const STUDIO_LIBRARY = [
  ['Clean-up pass', 'Remove filler words, false starts, repeated takes and silences over 0.6 seconds. Never cut mid-sentence and never change pitch. Show me your cut list with timestamps before editing.'],
  ['Teaching pace', 'Keep natural pauses between teaching points. Where the speaker moves to a new point, leave a 1-second beat. Remove only silences longer than 1.2 seconds.'],
  ['Presenter lock (vertical)', 'Reframe this 16:9 video to 9:16. Keep the presenter centered. When they move, pan smoothly; no sudden jumps. Keep any on-screen text fully inside the frame.'],
  ['Slides over speaker', 'Make a 9:16 layout: top half shows the slides cropped to a square; bottom half shows the presenter in a centered circle on a solid brand-color background.'],
  ['Triple stack', 'Make a 9:16 layout: top 40% slides, middle 35% presenter tracking crop, bottom 25% solid dark panel reserved for captions.'],
  ['Picture-in-picture', 'Keep the screen recording full-frame. Put the presenter in a circle in the bottom-right corner at 15% of the frame, in the same spot across every cut.'],
  ['Letterbox with blur', 'Place the original 16:9 video in the center of a 9:16 canvas. Fill the top and bottom with a blurred, enlarged copy of the same video.'],
  ['3 best moments', 'Find the 3 strongest teaching moments. Make each a standalone clip under 60 seconds that starts at the beginning of a sentence and ends on a complete thought.'],
  ['Hook clip', 'Find the single clearest opening statement, 30 to 45 seconds long. Start 5 frames before the first word and add a short audio fade at the end.'],
  ['Chapters', 'Split this into chapters, one per learning objective, each with a 1-second title slate.'],
  ['Word-by-word captions', 'Add 1 to 3 words of caption at a time, synced to speech, bold white sans-serif with a black outline, centered in the lower third.'],
  ['Keyword highlights', 'In captions, show regulations, acronyms, credentials and numbers in bold accent color.'],
  ['Title and progress bar', 'Add a fixed title bar across the top 10% and a thin progress bar under it that fills left to right over the clip.'],
  ['Music ducking', 'Lower background music by 18 dB while someone is speaking and bring it back up gently in pauses.'],
  ['Clean audio', 'Normalize voice peaks to -3 dB, reduce room noise, and add 2-frame audio crossfades at every cut to remove clicks.'],
  ['Privacy sweep', 'Find every frame showing a patient face, name, wristband, chart, screen with patient data or room number. Blur or cut each one and list the timestamps.']
];
const MATRIX = {
  Layout: ['Keep 16:9 widescreen', 'Vertical 9:16 presenter lock', 'Vertical 9:16 slides over speaker', 'Vertical 9:16 triple stack', 'Picture-in-picture corner', 'Letterbox with blurred fill'],
  Pacing: ['Teaching pace (silences over 1.2 s)', 'Natural (silences over 0.6 s)', 'Fast (silences over 0.25 s)', 'Extract 3 best clips under 60 s', 'Single 45-second hook clip'],
  Captions: ['Word-by-word bold captions', 'Two-line captions on brand band', 'Keyword highlights in accent color', 'Title bar plus progress bar', 'No burned-in captions, SRT only'],
  Audio: ['Leave audio as recorded', 'Music ducking under speech', 'Normalize voice and reduce noise', 'Align multiple microphones']
};
$('#studio-library').innerHTML = STUDIO_LIBRARY.map(([t, p], i) => `<button class="lib" data-i="${i}"><b>${esc(t)}</b><span>${esc(p)}</span></button>`).join('');
$$('#studio-library .lib').forEach((b) => b.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(STUDIO_LIBRARY[b.dataset.i][1]); b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 1200); } catch { /* blocked */ }
}));
$('#studio-matrix').innerHTML = Object.entries(MATRIX).map(([col, opts]) => `<div><h3>${col}</h3>${opts.map((o, i) =>
  `<label class="check"><input type="checkbox" data-col="${col}" value="${esc(o)}" ${i < 2 ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div>`).join('');
function matrixChoices() { return Object.keys(MATRIX).map((c) => $$(`#studio-matrix input[data-col="${c}"]:checked`).map((x) => x.value)); }
function matrixCount() { const n = matrixChoices().reduce((a, c) => a * c.length, 1); $('#matrix-count').textContent = `${Math.min(n, 1000)} prompt${n === 1 ? '' : 's'}${n > 1000 ? ' (capped at 1,000)' : ''}`; }
$('#studio-matrix').addEventListener('change', matrixCount); matrixCount();
function download(name, data) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
const PRIVACY = 'Never show patient faces, names, wristbands, charts, screens with patient data or room numbers; blur or cut them and list timestamps. Show your plan before editing; keep every change undoable.';
$('#matrix-go').addEventListener('click', () => {
  const [L, P, C, A] = matrixChoices();
  if ([L, P, C, A].some((x) => !x.length)) return alertless('Pick at least one option in each column.');
  const out = [];
  for (const l of L) for (const p of P) for (const c of C) for (const a of A) {
    if (out.length >= 1000) break;
    out.push({ id: `F4-${String(out.length + 1).padStart(4, '0')}`, layout: l, pacing: p, captions: c, audio: a, prompt: `Layout: ${l}. Pacing: ${p}. Captions: ${c}. Audio: ${a}. ${PRIVACY}` });
  }
  download(`f4-studio-prompts-${out.length}.json`, out);
});
$('#studio-pipeline').addEventListener('click', () => download('f4-vertical-pipeline.json', {
  pipeline: 'F4 Studio vertical reformat', aspect: '9:16', stages: [
    { stage: 1, name: 'Canvas', prompt: STUDIO_LIBRARY[3][1] + ' Track the presenter smoothly.' },
    { stage: 2, name: 'Trim and extract', prompt: 'Remove silences over 0.25 seconds, filler words and repeated takes; hard video cuts with 2-frame audio crossfades. Then extract the 3 best clips under 60 seconds, each starting at a sentence and ending on a complete thought.' },
    { stage: 3, name: 'Captions and graphics', prompt: STUDIO_LIBRARY[10][1] + ' ' + STUDIO_LIBRARY[11][1] + ' Add a thin progress bar along the bottom.' },
    { stage: 4, name: 'Privacy check', prompt: STUDIO_LIBRARY[15][1] }
  ] }));

// ---------- F4 Studio prompt builder ----------
function buildStudioPrompt() {
  const f = Object.fromEntries(new FormData($('#studio-form')));
  const on = (k) => $(`#studio-form [name=${k}]`).checked;
  const kinds = { training: 'a staff training module for a healthcare organization', policy: 'a policy update announcement for hospital staff', onboarding: 'a new-hire onboarding video', leadership: 'a leadership and board briefing', marketing: 'a short marketing clip for FUTURE4000, a healthcare compliance platform', podcast: 'a recorded podcast or webinar' };
  const tasks = {
    clean: 'Clean up the recording: remove filler words (um, uh, like), false starts, repeated takes and dead air. Keep the speaker\'s pacing natural and never change pitch.',
    highlights: 'Find the 3 strongest moments (clear teaching points, strong statements, practical tips) and turn each into its own standalone clip with a clean start and end.',
    reframe: 'Reframe the video and keep the active speaker centered and in focus at all times, including when they move.',
    split: 'Build a stacked layout: top 40% shows the presentation slides scaled to fit; middle 35% is a centered crop that tracks the active speaker; bottom 25% is a solid brand-color panel reserved for captions.',
    chapters: 'Split the video into clearly titled chapters, one per learning objective, with a 1-second title slate before each chapter.'
  };
  const pace = { calm: 'Keep natural pauses; only remove silences longer than 1.2 seconds, because learners need time to absorb clinical content.', natural: 'Remove silences longer than 0.6 seconds.', fast: 'Remove silences longer than 0.25 seconds and use hard cuts.', max: 'Remove every silence longer than 0.15 seconds and use hard cuts for maximum pace.' };
  const audio = { duck: 'Lower background music by 18 dB under speech and raise it gently in pauses.', normalize: 'Normalize voice peaks to -3 dB, reduce room noise, and crossfade audio 2 frames at every cut.', multi: 'Align all microphone tracks to remove echo and gate microphones that are not active.' };
  const caps = { word: `Burn in word-by-word captions: large bold sans-serif, white text with the current word highlighted in ${f.c2}, placed in the lower third, readable on a phone.`, line: `Burn in captions as full lines, maximum two rows, white text on a ${f.c1} band at 80% opacity.`, none: 'Do not burn captions into the video.' };
  const lines = [
    `You are editing ${kinds[f.kind]}${f.topic ? ` about "${f.topic}"` : ''}.`,
    '',
    `1. MAIN TASK: ${tasks[f.task]}`,
    `2. FORMAT: Final output is ${f.aspect}.${f.aspect !== '16:9' && f.task !== 'split' ? ' Reframe so the speaker and any on-screen text stay fully inside the frame.' : ''}`,
    `3. PACING: ${pace[f.pace]}`,
    `4. CAPTIONS: ${caps[f.captions]}${on('srt') ? ' Also export a matching .srt caption file.' : ''}`,
    f.length ? `5. LENGTH: Keep the final cut under ${f.length >= 60 ? `${f.length / 60} minute${f.length > 60 ? 's' : ''}` : `${f.length} seconds`}. Cut the least important material first, never the safety steps.` : '5. LENGTH: Keep whatever length the content needs; do not cut required steps.',
    f.audio ? `AUDIO: ${audio[f.audio]}` : null,
    `6. BRAND: Use ${f.c1} as the primary color and ${f.c2} as the accent for titles, bars and highlights.`,
    on('title') ? `7. TITLE CARD: Add a 2-second animated title card at the start${f.topic ? ` reading "${f.topic}"` : ''}.` : null,
    on('lower') ? '8. LOWER-THIRD: When each speaker first appears, show their name and credentials (I will confirm names before export).' : null,
    on('broll') ? '9. B-ROLL: Add B-roll that matches what is being said in the middle section. Use only generic stock footage.' : null,
    on('quiz') ? '10. END CARD: Finish with a 4-second end card: "Complete your LearnTrack quiz to earn your certificate."' : null,
    '',
    'PRIVACY RULES (always apply):',
    '- Never show patient faces, names, wristbands, charts, screens with patient data, or room numbers. If any appear, cut or blur them and list the timestamps for me.',
    '- Do not invent clinical facts or change what the speaker says.',
    '',
    'Before editing, show me your plan with timestamps. Make changes only after I approve, and keep every change undoable.'
  ].filter((l) => l !== null);
  $('#studio-out').textContent = lines.join('\n');
}
$('#studio-form').addEventListener('input', buildStudioPrompt);
$('#studio-form').addEventListener('change', buildStudioPrompt);
$('#studio-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#studio-out').textContent); $('#studio-copy').textContent = 'Copied'; setTimeout(() => ($('#studio-copy').textContent = 'Copy prompt'), 1500); } catch { /* clipboard blocked */ }
});
buildStudioPrompt();

boot();
