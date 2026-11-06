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
  if (isEditor()) { loadTeam(); loadAudit(); loadActivity(); }
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
      const r = await api(`/api/templates/${card.dataset.id}/apply`, { method: 'POST', body: { ai: b.dataset.ai === '1' } });
      show($('#template-msg'), r.created.length ? `Created ${r.created.length} draft policies: ${r.created.map((c) => c.title).join(', ')}. Open the Policies tab to review them.` : 'All policies in this pack are already in your library.', 'ok');
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
  }));
}
$('#agent-run').addEventListener('click', async () => {
  const btn = $('#agent-run'), out = $('#agent-output'), phi = $('#agent-phi');
  btn.disabled = true; btn.textContent = 'Working...'; out.classList.add('hidden'); phi.classList.add('hidden'); $('#agent-model').textContent = '';
  try {
    const r = await api(`/api/org/agents/${currentAgent.id}/run`, { method: 'POST', body: { input: $('#agent-input').value } });
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

boot();
