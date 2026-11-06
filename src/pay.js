// 4000 Connect for payments (F4 Pay): each organization connects the payment system it already uses.
// Credentials are encrypted with AES-256-GCM before they touch the database and are never sent back to the browser.
// Rules: test mode first, live mode only with an explicit confirmation and a dedicated encryption key,
// no patient health information in any payment system, every change written to the audit log.
import crypto from 'node:crypto';
import express from 'express';
import { q } from './db.js';
import { requireUser, requireRole, audit } from './auth.js';
import { scrubPHI } from './phi.js';

export const PAY_SCHEMA = `
CREATE TABLE IF NOT EXISTS payment_connections (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test','live')),
  credentials_enc TEXT,
  key_hint TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'untested' CHECK (status IN ('untested','connected','failed','disconnected')),
  last_tested_at TIMESTAMPTZ,
  last_test_message TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_connections_org ON payment_connections(org_id);
`;

// ---------- Encryption ----------
const RAW_KEY = process.env.F4_SECRETS_KEY || '';
const DEDICATED_KEY = RAW_KEY.length >= 32;
const KEY = crypto.createHash('sha256')
  .update(DEDICATED_KEY ? RAW_KEY : `f4pay:${process.env.SESSION_SECRET || 'temporary'}`)
  .digest();
if (!DEDICATED_KEY) console.warn('F4_SECRETS_KEY not set: payment connections are limited to test mode.');

export function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}
export function decrypt(token) {
  const [v, iv, tag, data] = String(token || '').split('.');
  if (v !== 'v1') throw new Error('Unknown credential format.');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
}
const hint = (s) => (s && s.length > 8 ? `…${s.slice(-4)}` : '…');

// ---------- Providers ----------
const T = 10000; // test request timeout in milliseconds
async function getJson(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(T) });
  const text = (await r.text()).replace(/^﻿/, '');
  let body = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

export const PROVIDERS = [
  {
    id: 'stripe', name: 'Stripe', serves: 'Online and in-person cards, wallets, subscriptions',
    fields: [{ key: 'secretKey', label: 'Secret or restricted key', secret: true, hint: 'Starts with sk_test_ or rk_test_ in test mode' }],
    docs: 'Stripe Dashboard → Developers → API keys. A restricted key with read access is enough for the test.',
    validate(c, mode) {
      const k = c.secretKey || '';
      if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(k)) return 'That does not look like a Stripe secret or restricted key.';
      if (mode === 'test' && !k.includes('_test_')) return 'Test mode needs a test key (sk_test_ or rk_test_).';
      if (mode === 'live' && !k.includes('_live_')) return 'Live mode needs a live key.';
      return null;
    },
    key: (c) => c.secretKey,
    async test(c) {
      const r = await getJson('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${c.secretKey}` } });
      return r.ok ? { ok: true, message: `Stripe answered. Balance currencies: ${(r.body.available || []).map((a) => a.currency.toUpperCase()).join(', ') || 'none yet'}.` }
        : { ok: false, message: r.body?.error?.message || `Stripe refused the key (HTTP ${r.status}).` };
    },
  },
  {
    id: 'square', name: 'Square', serves: 'Front-desk card readers, invoices, online payments',
    fields: [{ key: 'accessToken', label: 'Access token', secret: true, hint: 'Sandbox token from the Square Developer Dashboard' }],
    docs: 'Square Developer Dashboard → your application → Credentials. Use the Sandbox token in test mode.',
    validate: (c) => ((c.accessToken || '').length < 20 ? 'That access token looks too short.' : null),
    key: (c) => c.accessToken,
    async test(c, mode) {
      const host = mode === 'live' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
      const r = await getJson(`${host}/v2/locations`, { headers: { Authorization: `Bearer ${c.accessToken}`, 'Square-Version': '2024-10-17' } });
      return r.ok ? { ok: true, message: `Square answered. Locations found: ${(r.body.locations || []).length}.` }
        : { ok: false, message: r.body?.errors?.[0]?.detail || `Square refused the token (HTTP ${r.status}).` };
    },
  },
  {
    id: 'paypal', name: 'PayPal and Braintree', serves: 'PayPal wallet, Venmo, pay-later, cards',
    fields: [
      { key: 'clientId', label: 'Client ID', secret: false, hint: 'From a REST API app in the PayPal Developer Dashboard' },
      { key: 'clientSecret', label: 'Client secret', secret: true },
    ],
    docs: 'PayPal Developer Dashboard → Apps & Credentials. Use the Sandbox app in test mode.',
    validate: (c) => (!c.clientId || !c.clientSecret ? 'Enter both the client ID and the client secret.' : null),
    key: (c) => c.clientSecret,
    async test(c, mode) {
      const host = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
      const r = await getJson(`${host}/v1/oauth2/token`, {
        method: 'POST', body: 'grant_type=client_credentials',
        headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return r.ok && r.body.access_token ? { ok: true, message: 'PayPal answered and issued a short-lived access token.' }
        : { ok: false, message: r.body?.error_description || `PayPal refused the credentials (HTTP ${r.status}).` };
    },
  },
  {
    id: 'authorizenet', name: 'Authorize.net', serves: 'Card processing used by many medical practices',
    fields: [
      { key: 'loginId', label: 'API login ID', secret: false },
      { key: 'transactionKey', label: 'Transaction key', secret: true },
    ],
    docs: 'Merchant Interface → Account → Settings → API Credentials & Keys. Use a sandbox account in test mode.',
    validate: (c) => (!c.loginId || !c.transactionKey ? 'Enter both the API login ID and the transaction key.' : null),
    key: (c) => c.transactionKey,
    async test(c, mode) {
      const host = mode === 'live' ? 'https://api.authorize.net' : 'https://apitest.authorize.net';
      const r = await getJson(`${host}/xml/v1/request.api`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authenticateTestRequest: { merchantAuthentication: { name: c.loginId, transactionKey: c.transactionKey } } }),
      });
      const m = r.body?.messages;
      return m?.resultCode === 'Ok' ? { ok: true, message: 'Authorize.net accepted the credentials.' }
        : { ok: false, message: m?.message?.[0]?.text || `Authorize.net refused the credentials (HTTP ${r.status}).` };
    },
  },
  {
    id: 'adyen', name: 'Adyen', serves: 'Enterprise and health-system payments across countries',
    fields: [{ key: 'apiKey', label: 'Management API key', secret: true, hint: 'From the Adyen Customer Area test account' }],
    docs: 'Adyen Customer Area → Developers → API credentials. Use a test account in test mode.',
    validate: (c) => ((c.apiKey || '').length < 20 ? 'That API key looks too short.' : null),
    key: (c) => c.apiKey,
    async test(c, mode) {
      if (mode === 'live') return { ok: false, message: 'Adyen live testing needs your live endpoint prefix; our team sets this up with you.' };
      const r = await getJson('https://management-test.adyen.com/v3/me', { headers: { 'X-API-Key': c.apiKey } });
      return r.ok ? { ok: true, message: `Adyen answered for ${r.body.username || 'your API user'}.` }
        : { ok: false, message: r.body?.detail || r.body?.title || `Adyen refused the key (HTTP ${r.status}).` };
    },
  },
  // Systems we connect with a guided setup instead of a self-serve key test.
  ...[
    ['instamed', 'InstaMed (J.P. Morgan)', 'Patient statements, payer payments, healthcare payment plans'],
    ['flywire', 'Flywire', 'Tuition and patient payments, international payers'],
    ['clover', 'Clover (Fiserv)', 'In-person point-of-sale at clinics and offices'],
    ['checkoutcom', 'Checkout.com', 'Online payments with interchange-plus pricing'],
    ['other', 'Other payment system', 'Any processor or billing company you already use'],
  ].map(([id, name, serves]) => ({
    id, name, serves, guided: true,
    fields: [{ key: 'contact', label: 'Account or merchant ID (no keys)', secret: false, hint: 'Our team completes the secure connection with you' }],
    docs: 'Guided setup: we schedule a call and connect it through the provider\'s approved partner process.',
    validate: (c) => (!c.contact ? 'Enter your account or merchant ID so we can start the guided setup.' : null),
    key: (c) => c.contact,
    async test() { return { ok: false, message: 'Guided setup requested. A team member will finish the secure connection with you.' }; },
  })),
];
const byId = (id) => PROVIDERS.find((p) => p.id === id);
const publicProvider = (p) => ({ id: p.id, name: p.name, serves: p.serves, guided: !!p.guided, docs: p.docs,
  fields: p.fields.map(({ key, label, secret, hint: h }) => ({ key, label, secret, hint: h || '' })) });

function publicRow(r) {
  const p = byId(r.provider);
  return { id: r.id, provider: r.provider, providerName: p?.name || r.provider, label: r.label, mode: r.mode, keyHint: r.key_hint,
    isPrimary: r.is_primary, status: r.status, lastTestedAt: r.last_tested_at, lastTestMessage: r.last_test_message, createdAt: r.created_at };
}

// ---------- Routes ----------
export const payRouter = express.Router();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong. Please try again.' });
});
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

payRouter.get('/providers', requireUser, (_req, res) => res.json({
  providers: PROVIDERS.map(publicProvider), liveAllowed: DEDICATED_KEY,
  rules: ['Never enter patient names, diagnoses or record numbers in any payment system.',
    'Start in test mode. Live mode needs an administrator, a confirmation and a dedicated encryption key.',
    'Keys are encrypted before storage and are never shown again after you save them.'],
}));

payRouter.get('/connections', requireRole('admin', 'compliance_officer'), wrap(async (req, res) => {
  const { rows } = await q(`SELECT * FROM payment_connections WHERE org_id=$1 AND status <> 'disconnected' ORDER BY is_primary DESC, created_at`, [req.user.org_id]);
  res.json(rows.map(publicRow));
}));

async function runTest(row, creds) {
  const p = byId(row.provider);
  let result;
  try { result = await p.test(creds, row.mode); }
  catch (e) { result = { ok: false, message: e.name === 'TimeoutError' ? 'The provider did not answer in time. Try again shortly.' : `Could not reach ${p.name}: ${e.message}` }; }
  const status = result.ok ? 'connected' : (p.guided ? 'untested' : 'failed');
  const { rows } = await q(`UPDATE payment_connections SET status=$2, last_tested_at=now(), last_test_message=$3, updated_at=now() WHERE id=$1 RETURNING *`,
    [row.id, status, result.message]);
  return { ...result, connection: publicRow(rows[0]) };
}

payRouter.post('/connections', requireRole('admin'), wrap(async (req, res) => {
  const { provider, mode = 'test', label, credentials = {}, confirmLive } = req.body || {};
  const p = byId(provider);
  if (!p) throw bad('Choose a payment system from the list.');
  if (!['test', 'live'].includes(mode)) throw bad('Mode must be test or live.');
  if (mode === 'live') {
    if (!DEDICATED_KEY) throw bad('Live mode is turned off until the F4_SECRETS_KEY encryption key is set by your administrator.', 403);
    if (confirmLive !== true) throw bad('Confirm that you are connecting a live account that moves real money.');
  }
  const name = String(label || p.name).trim().slice(0, 80);
  if (scrubPHI(name).redactions > 0) throw bad('The label looks like it contains patient information. Use a location or department name instead.');
  const clean = {};
  for (const f of p.fields) clean[f.key] = String(credentials[f.key] ?? '').trim();
  const err = p.validate(clean, mode);
  if (err) throw bad(err);
  const { rows: existing } = await q(`SELECT count(*)::int AS n FROM payment_connections WHERE org_id=$1 AND status <> 'disconnected'`, [req.user.org_id]);
  if (existing[0].n >= 20) throw bad('An organization can have up to 20 active payment connections.');
  const { rows } = await q(
    `INSERT INTO payment_connections (org_id, provider, label, mode, credentials_enc, key_hint, is_primary, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.org_id, p.id, name, mode, encrypt(clean), hint(p.key(clean)), existing[0].n === 0, req.user.id]);
  await audit(req, 'pay.connection.created', 'payment_connection', rows[0].id, { provider: p.id, mode, label: name });
  const tested = await runTest(rows[0], clean);
  await audit(req, 'pay.connection.tested', 'payment_connection', rows[0].id, { ok: tested.ok });
  res.status(201).json(tested);
}));

async function ownRow(req) {
  const { rows } = await q(`SELECT * FROM payment_connections WHERE id=$1 AND org_id=$2 AND status <> 'disconnected'`, [req.params.id, req.user.org_id]);
  if (!rows[0]) throw bad('Connection not found.', 404);
  return rows[0];
}

payRouter.post('/connections/:id/test', requireRole('admin'), wrap(async (req, res) => {
  const row = await ownRow(req);
  let creds;
  try { creds = decrypt(row.credentials_enc); }
  catch { throw bad('Saved credentials can no longer be read (the encryption key changed). Reconnect this payment system.', 409); }
  const tested = await runTest(row, creds);
  await audit(req, 'pay.connection.tested', 'payment_connection', row.id, { ok: tested.ok });
  res.json(tested);
}));

payRouter.post('/connections/:id/primary', requireRole('admin'), wrap(async (req, res) => {
  const row = await ownRow(req);
  await q('UPDATE payment_connections SET is_primary = (id = $1), updated_at=now() WHERE org_id=$2', [row.id, req.user.org_id]);
  await audit(req, 'pay.connection.primary', 'payment_connection', row.id, { provider: row.provider });
  res.json({ ok: true });
}));

// Disconnect wipes the stored credentials and keeps a record of the connection for the audit trail.
payRouter.delete('/connections/:id', requireRole('admin'), wrap(async (req, res) => {
  const row = await ownRow(req);
  await q(`UPDATE payment_connections SET status='disconnected', credentials_enc=NULL, is_primary=FALSE, updated_at=now() WHERE id=$1`, [row.id]);
  if (row.is_primary) {
    await q(`UPDATE payment_connections SET is_primary=TRUE WHERE id = (SELECT id FROM payment_connections WHERE org_id=$1 AND status <> 'disconnected' ORDER BY created_at LIMIT 1)`, [req.user.org_id]);
  }
  await audit(req, 'pay.connection.disconnected', 'payment_connection', row.id, { provider: row.provider });
  res.json({ ok: true });
}));
