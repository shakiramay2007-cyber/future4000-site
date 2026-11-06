// Logins, sessions, roles, and audit logging.
import crypto from 'node:crypto';
import { q } from './db.js';

const SECRET = process.env.SESSION_SECRET || (() => {
  const s = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET not set: using a temporary secret (everyone is logged out on restart).');
  return s;
})();
const COOKIE = 'f4_session';
const SESSION_HOURS = 12;

export const ROLES = ['admin', 'compliance_officer', 'clinician_reviewer', 'staff'];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 12) return 'Password must be at least 12 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must include letters and numbers.';
  return null;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  return payload.exp > Date.now() ? payload : null;
}

function readCookie(req, name) {
  const match = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function setSession(res, user) {
  const token = sign({ uid: user.id, org: user.org_id, role: user.role, exp: Date.now() + SESSION_HOURS * 3600e3 });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// Loads the user (if logged in) on every request.
export async function loadUser(req, _res, next) {
  req.user = null;
  const s = unsign(readCookie(req, COOKIE));
  if (s) {
    try {
      const { rows } = await q('SELECT id, org_id, email, full_name, credentials, role, active FROM users WHERE id = $1', [s.uid]);
      if (rows[0]?.active) req.user = rows[0];
    } catch { /* database not configured */ }
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: `This action requires the ${roles.join(' or ').replace(/_/g, ' ')} role.` });
  next();
};

export async function audit(req, action, entity = null, entityId = null, detail = {}) {
  try {
    await q(
      'INSERT INTO audit_log (org_id, user_id, action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [req.user?.org_id ?? detail.org_id ?? null, req.user?.id ?? null, action, entity, entityId == null ? null : String(entityId), detail, req.ip]
    );
  } catch (e) {
    console.error('Audit log write failed:', e.message);
  }
}

// Simple in-memory rate limiter for login attempts.
const attempts = new Map();
export function loginRateLimit(req, res, next) {
  const key = `${req.ip}:${String(req.body?.email || '').toLowerCase()}`;
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, first: now };
  if (now - entry.first > 15 * 60e3) { entry.count = 0; entry.first = now; }
  entry.count += 1;
  attempts.set(key, entry);
  if (entry.count > 10) return res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  next();
}
