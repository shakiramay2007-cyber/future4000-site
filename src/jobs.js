// F4 Jobs: durable background jobs. Each step's result is saved as it finishes; after a crash or restart,
// unfinished jobs resume and completed steps are skipped. Failed steps retry with backoff.
import { q } from './db.js';

export const JOBS_SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  input       JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','canceled')),
  total_steps INTEGER NOT NULL DEFAULT 0,
  steps       JSONB NOT NULL DEFAULT '{}',
  result      JSONB,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_org ON jobs(org_id, created_at DESC);
`;

const HANDLERS = {};
export function registerJob(type, handler) { HANDLERS[type] = handler; }

const running = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function enqueue(type, { orgId, userId, input = {} }) {
  if (!HANDLERS[type]) throw new Error(`Unknown job type ${type}`);
  const { rows } = await q('INSERT INTO jobs (org_id, user_id, type, input) VALUES ($1,$2,$3,$4) RETURNING id', [orgId, userId, type, input]);
  setImmediate(() => run(rows[0].id));
  return rows[0].id;
}

async function run(id) {
  if (running.has(String(id))) return;
  running.add(String(id));
  try {
    const job = (await q(`UPDATE jobs SET status='running', updated_at=now() WHERE id=$1 AND status IN ('queued','running') RETURNING *`, [id])).rows[0];
    if (!job) return;
    const steps = job.steps || {};
    const ctx = {
      job,
      setTotal: async (n) => q('UPDATE jobs SET total_steps=$1, updated_at=now() WHERE id=$2', [n, id]),
      // Runs fn once per step name; a recorded result is returned without re-running.
      step: async (name, fn, { retries = 3 } = {}) => {
        if (name in steps) return steps[name];
        let lastErr;
        for (let attempt = 1; attempt <= retries; attempt++) {
          const cur = (await q('SELECT status FROM jobs WHERE id=$1', [id])).rows[0];
          if (cur?.status === 'canceled') throw Object.assign(new Error('Job canceled'), { canceled: true });
          try {
            const value = (await fn()) ?? null;
            steps[name] = value;
            await q(`UPDATE jobs SET steps = steps || jsonb_build_object($1::text, $2::jsonb), updated_at=now() WHERE id=$3`, [name, JSON.stringify(value), id]);
            return value;
          } catch (e) {
            if (e.noRetry) throw e;
            lastErr = e;
            if (attempt < retries) await sleep(1000 * 2 ** attempt);
          }
        }
        throw lastErr;
      }
    };
    const result = await HANDLERS[job.type](ctx, job.input);
    await q(`UPDATE jobs SET status='succeeded', result=$1, updated_at=now() WHERE id=$2 AND status='running'`, [result ?? {}, id]);
  } catch (e) {
    if (!e.canceled) {
      console.error(`Job ${id} failed:`, e.message);
      await q(`UPDATE jobs SET status='failed', error=$1, updated_at=now() WHERE id=$2 AND status='running'`, [e.message.slice(0, 1000), id]);
    }
  } finally {
    running.delete(String(id));
  }
}

// Called at startup: resume anything that was queued or interrupted mid-run.
export async function resumeJobs() {
  const { rows } = await q(`SELECT id FROM jobs WHERE status IN ('queued','running') ORDER BY id`);
  for (const r of rows) setImmediate(() => run(r.id));
  if (rows.length) console.log(`Resuming ${rows.length} background job(s).`);
}

export async function getJob(id, orgId) {
  return (await q('SELECT id, type, status, total_steps, (SELECT count(*) FROM jsonb_object_keys(steps))::int AS done_steps, result, error, created_at, updated_at FROM jobs WHERE id=$1 AND org_id=$2', [id, orgId])).rows[0];
}

export async function cancelJob(id, orgId) {
  return (await q(`UPDATE jobs SET status='canceled', updated_at=now() WHERE id=$1 AND org_id=$2 AND status IN ('queued','running')`, [id, orgId])).rowCount;
}
