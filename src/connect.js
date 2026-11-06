// 4000 Connect managed setup: clients ask FUTURE4000 to connect a system behind the scenes (a paid service).
// Requests are recorded per organization and audit-logged; the FUTURE4000 team completes them.
import express from 'express';
import { q } from './db.js';
import { requireRole, audit } from './auth.js';
import { scrubPHI } from './phi.js';
import { INTEGRATIONS } from './integrations.js';
import { PROVIDERS } from './pay.js';

export const CONNECT_SCHEMA = `
CREATE TABLE IF NOT EXISTS connection_requests (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  system_id TEXT NOT NULL,
  system_name TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_progress','done','declined')),
  requested_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connection_requests_org ON connection_requests(org_id, created_at DESC);
`;

const systems = () => [
  ...INTEGRATIONS.map((i) => ({ id: i.id, name: `${i.connects} (${i.brand})` })),
  ...PROVIDERS.map((p) => ({ id: `pay-${p.id}`, name: `${p.name} (Payment Time)` })),
];

export const connectRouter = express.Router();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong. Please try again.' });
});
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

connectRouter.get('/requests', requireRole('admin', 'compliance_officer'), wrap(async (req, res) => {
  const { rows } = await q('SELECT id, system_id, system_name, notes, status, created_at FROM connection_requests WHERE org_id=$1 ORDER BY created_at DESC', [req.user.org_id]);
  res.json(rows);
}));

connectRouter.post('/requests', requireRole('admin'), wrap(async (req, res) => {
  const sys = systems().find((s) => s.id === req.body?.systemId);
  if (!sys) throw bad('Choose a system to connect.');
  const notes = String(req.body?.notes || '').trim().slice(0, 500);
  if (notes && scrubPHI(notes).redactions > 0) throw bad('Notes look like they contain patient information. Remove it and try again.');
  const open = await q(`SELECT id FROM connection_requests WHERE org_id=$1 AND system_id=$2 AND status IN ('requested','in_progress')`, [req.user.org_id, sys.id]);
  if (open.rowCount) throw bad('A managed setup request for this system is already open.', 409);
  const { rows } = await q(`INSERT INTO connection_requests (org_id, system_id, system_name, notes, requested_by) VALUES ($1,$2,$3,$4,$5)
    RETURNING id, system_id, system_name, notes, status, created_at`, [req.user.org_id, sys.id, sys.name, notes || null, req.user.id]);
  await audit(req, 'connect.managed_setup.requested', 'connection_request', rows[0].id, { system: sys.id });
  res.status(201).json(rows[0]);
}));
