const $ = (s) => document.querySelector(s);
const api = async (url, opts = {}) => {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data });
  return data;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (cents) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}`;

// Tabs
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === t.dataset.view));
}));

// Status
api('/api/status').then((s) => {
  $('#status').innerHTML = `
    <span class="pill ${s.ai ? 'on' : ''}">AI ${s.ai ? 'connected' : 'not connected'}</span>
    <span class="pill ${s.stripe ? 'on' : ''}">Stripe ${s.stripe ? s.stripeMode : 'not connected'}</span>`;
}).catch(() => {});

// Agents
let currentAgent = null;
api('/api/agents').then((agents) => {
  $('#agent-list').innerHTML = agents.map((a) => `
    <button class="agent-item" data-id="${a.id}"><b>${esc(a.name)}</b><span>${esc(a.subsystem)}</span></button>`).join('');
  document.querySelectorAll('.agent-item').forEach((btn) => btn.addEventListener('click', () => {
    currentAgent = agents.find((a) => a.id === btn.dataset.id);
    document.querySelectorAll('.agent-item').forEach((b) => b.classList.toggle('active', b === btn));
    $('#agent-title').textContent = currentAgent.name;
    $('#agent-summary').textContent = currentAgent.summary;
    $('#agent-run').disabled = false;
  }));
});

$('#agent-run').addEventListener('click', async () => {
  if (!currentAgent) return;
  const btn = $('#agent-run'), out = $('#agent-output'), phi = $('#agent-phi');
  btn.disabled = true; btn.textContent = 'Working...';
  out.classList.add('hidden'); phi.classList.add('hidden');
  try {
    const r = await api(`/api/agents/${currentAgent.id}/run`, { method: 'POST', body: JSON.stringify({ input: $('#agent-input').value }) });
    if (r.phi?.redactions) {
      phi.className = 'notice';
      phi.textContent = `Protected: ${r.phi.redactions} identifier(s) masked before sending (${r.phi.types.join(', ')}).`;
    }
    out.textContent = r.output;
    out.classList.remove('hidden');
  } catch (e) {
    phi.className = 'notice bad';
    phi.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Run agent';
  }
});

// Integrations
let integrations = [];
function renderIntegrations(cat = 'all') {
  const list = integrations.filter((i) => cat === 'all' || i.category === cat).sort((a, b) => a.priority - b.priority);
  $('#integration-grid').innerHTML = list.map((i) => `
    <div class="card" data-id="${i.id}">
      <h3>${esc(i.name)}</h3>
      <div class="tags">
        <span class="tag">${esc(i.category)}</span>
        ${i.hipaa ? '<span class="tag hipaa">HIPAA-safe</span>' : '<span class="tag">No PHI</span>'}
        <span class="tag ${i.credentialsSet ? 'connected' : 'needs'}">${i.credentialsSet ? 'Credentials set' : 'Needs credentials'}</span>
      </div>
      <p>${esc(i.upgrade)}</p>
      ${i.setup ? `<p><b>Setup:</b> ${esc(i.setup)}</p>` : ''}
      <button>Test connection</button>
      <div class="result"></div>
    </div>`).join('');
  document.querySelectorAll('#integration-grid .card button').forEach((b) => b.addEventListener('click', async () => {
    const card = b.closest('.card'), res = card.querySelector('.result');
    res.textContent = 'Testing...';
    try {
      const r = await api(`/api/integrations/${card.dataset.id}/test`, { method: 'POST' });
      res.innerHTML = `<span style="color:${r.ok ? 'var(--ok)' : 'var(--warn)'}">${r.status === 'connected' ? 'Connected: ' : ''}${esc(r.message)}</span>`;
    } catch (e) { res.textContent = e.message; }
  }));
}
api('/api/integrations').then((list) => { integrations = list; renderIntegrations(); });
document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
  renderIntegrations(c.dataset.cat);
}));

// Billing with Stripe Payment Element
let selectedPlan = null, stripe = null, elements = null;
api('/api/plans').then((plans) => {
  $('#plan-grid').innerHTML = Object.entries(plans).map(([id, p]) => `
    <div class="card"><h3>${esc(p.name)}</h3>
      <div class="price">${money(p.amount)} <small>/ month</small></div>
      <p>${esc(p.description)}</p>
      <button data-plan="${id}">Choose ${esc(p.name)}</button></div>`).join('');
  document.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => {
    selectedPlan = b.dataset.plan;
    $('#pay-title').textContent = `${plans[selectedPlan].name} plan: ${money(plans[selectedPlan].amount)}`;
    $('#pay-form').classList.remove('hidden');
    $('#payment-element').innerHTML = '';
    $('#pay-submit').classList.add('hidden');
    $('#pay-start').classList.remove('hidden');
    $('#pay-message').classList.add('hidden');
  }));
});

function payMessage(text, kind = '') {
  const m = $('#pay-message'); m.className = `notice ${kind}`; m.textContent = text;
}

$('#pay-start').addEventListener('click', async () => {
  if (!$('#org').value || !$('#email').checkValidity()) return payMessage('Enter the organization name and a valid billing email.', 'bad');
  try {
    const { publishableKey } = await api('/api/stripe/config');
    stripe = stripe || Stripe(publishableKey);
    const { clientSecret } = await api('/api/stripe/payment-intent', {
      method: 'POST', body: JSON.stringify({ plan: selectedPlan, organization: $('#org').value, email: $('#email').value })
    });
    elements = stripe.elements({ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#13a89e' } } });
    elements.create('payment').mount('#payment-element');
    $('#pay-start').classList.add('hidden');
    $('#pay-submit').classList.remove('hidden');
    $('#pay-message').classList.add('hidden');
  } catch (e) { payMessage(e.message, 'bad'); }
});

$('#pay-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!stripe || !elements) return;
  $('#pay-submit').disabled = true;
  const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required', confirmParams: { return_url: window.location.origin + '/?paid=1' } });
  $('#pay-submit').disabled = false;
  if (error) return payMessage(error.message, 'bad');
  if (paymentIntent?.status === 'succeeded') payMessage('Payment received. Thank you!', 'ok');
  else payMessage(`Payment status: ${paymentIntent?.status}`);
});

if (new URLSearchParams(location.search).get('paid')) {
  document.querySelector('[data-view="billing"]').click();
  payMessage('Payment completed. Thank you!', 'ok');
}
