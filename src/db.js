// Postgres connection and schema. Tables are created automatically on startup.
import pg from 'pg';
import { REGULATION_SEED } from './regulations.js';
import { LEARN_SCHEMA } from './learn.js';
import { GOV_SCHEMA } from './governance.js';

const { Pool } = pg;

// Connects with DATABASE_URL (Supabase or local) or PGHOST/PGUSER/PGPASSWORD/PGDATABASE (AWS RDS via Secrets Manager).
const local = (process.env.DATABASE_URL || process.env.PGHOST || '').includes('localhost');
const ssl = process.env.DATABASE_SSL === 'false' || local ? false : { rejectUnauthorized: false };
export const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl })
  : process.env.PGHOST ? new Pool({ ssl }) : null;

export const dbConfigured = () => Boolean(pool);

export async function q(text, params = []) {
  if (!pool) throw Object.assign(new Error('Database is not connected. Set DATABASE_URL or PGHOST.'), { status: 503 });
  return pool.query(text, params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organizations (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  org_type      TEXT,
  state         CHAR(2),
  services      TEXT[] NOT NULL DEFAULT '{}',
  beds          INTEGER,
  accreditor    TEXT,
  plan          TEXT NOT NULL DEFAULT 'none',
  plan_status   TEXT NOT NULL DEFAULT 'inactive',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  setup_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  credentials   TEXT,
  role          TEXT NOT NULL CHECK (role IN ('admin','compliance_officer','clinician_reviewer','staff')),
  password_hash TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS regulations (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('federal','state','accreditation')),
  authority   TEXT NOT NULL,
  state       CHAR(2),
  applies_to_types    TEXT[] NOT NULL DEFAULT '{}',
  applies_to_services TEXT[] NOT NULL DEFAULT '{}',
  summary     TEXT NOT NULL,
  required_policies TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS org_regulations (
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  regulation_id BIGINT NOT NULL REFERENCES regulations(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','compliant','gap')),
  PRIMARY KEY (org_id, regulation_id)
);

CREATE TABLE IF NOT EXISTS policies (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  domain        TEXT,
  policy_number TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','retired')),
  current_version INTEGER NOT NULL DEFAULT 0,
  owner_id      BIGINT REFERENCES users(id),
  next_review_date DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_versions (
  id            BIGSERIAL PRIMARY KEY,
  policy_id     BIGINT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  body          TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai')),
  ai_model      TEXT,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version)
);

CREATE TABLE IF NOT EXISTS policy_reviews (
  id            BIGSERIAL PRIMARY KEY,
  policy_id     BIGINT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  reviewer_id   BIGINT NOT NULL REFERENCES users(id),
  decision      TEXT NOT NULL CHECK (decision IN ('approved','changes_requested')),
  comments      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_regulations (
  policy_id     BIGINT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  regulation_id BIGINT NOT NULL REFERENCES regulations(id) ON DELETE CASCADE,
  PRIMARY KEY (policy_id, regulation_id)
);

CREATE TABLE IF NOT EXISTS acknowledgments (
  policy_id     BIGINT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, version, user_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  detail      JSONB NOT NULL DEFAULT '{}',
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_policies_org ON policies(org_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_log(org_id, created_at DESC);
`;

export async function migrate() {
  if (!pool) {
    console.warn('DATABASE_URL not set: running without a database (agents and integrations still work).');
    return;
  }
  await q(SCHEMA);
  await q(LEARN_SCHEMA);
  await q(GOV_SCHEMA);
  for (const r of REGULATION_SEED) {
    await q(
      `INSERT INTO regulations (code, title, level, authority, state, applies_to_types, applies_to_services, summary, required_policies)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (code) DO UPDATE SET title=EXCLUDED.title, level=EXCLUDED.level, authority=EXCLUDED.authority, state=EXCLUDED.state,
         applies_to_types=EXCLUDED.applies_to_types, applies_to_services=EXCLUDED.applies_to_services,
         summary=EXCLUDED.summary, required_policies=EXCLUDED.required_policies`,
      [r.code, r.title, r.level, r.authority, r.state || null, r.types || [], r.services || [], r.summary, r.policies || []]
    );
  }
  console.log(`Database ready (${REGULATION_SEED.length} regulations loaded).`);
}
