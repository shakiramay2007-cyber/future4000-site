// F4 Daily Scan: runs every morning at 8:30 AM Eastern (Render Cron Job) and on demand.
// 1. Pulls new rules and notices from the Federal Register for healthcare agencies.
// 2. Flags policies past their review date, policies stuck in review, and missing staff sign-offs.
// 3. Tests every connected integration.
// 4. Saves a scan report per organization and posts a summary to Slack if connected.
import { q } from './db.js';
import { INTEGRATIONS, testIntegration } from './integrations.js';

const AGENCIES = [
  'centers-for-medicare-medicaid-services',
  'health-and-human-services-department',
  'occupational-safety-and-health-administration',
  'drug-enforcement-administration',
  'substance-abuse-and-mental-health-services-administration',
  'food-and-drug-administration'
];

export const SCAN_SCHEMA = `
CREATE TABLE IF NOT EXISTS regulatory_updates (
  document_number TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  doc_type       TEXT,
  agencies       TEXT[] NOT NULL DEFAULT '{}',
  abstract       TEXT,
  publication_date DATE,
  effective_on   DATE,
  html_url       TEXT,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scan_reports (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  ran_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary    JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_org_time ON scan_reports(org_id, ran_at DESC);
`;

async function fetchFederalRegister(days = 3) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const params = new URLSearchParams({ per_page: '100', order: 'newest', 'conditions[publication_date][gte]': since });
  AGENCIES.forEach((a) => params.append('conditions[agencies][]', a));
  ['RULE', 'PRORULE', 'NOTICE'].forEach((t) => params.append('conditions[type][]', t));
  ['document_number', 'title', 'type', 'agencies', 'abstract', 'publication_date', 'effective_on', 'html_url'].forEach((f) => params.append('fields[]', f));
  const res = await fetch(`https://www.federalregister.gov/api/v1/documents.json?${params}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Federal Register answered ${res.status}`);
  const j = await res.json();
  let added = 0;
  for (const d of j.results || []) {
    const r = await q(
      `INSERT INTO regulatory_updates (document_number, title, doc_type, agencies, abstract, publication_date, effective_on, html_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (document_number) DO NOTHING`,
      [d.document_number, d.title, d.type, (d.agencies || []).map((a) => a.name || a.raw_name).filter(Boolean), d.abstract, d.publication_date, d.effective_on, d.html_url]
    );
    added += r.rowCount;
  }
  return { checked: (j.results || []).length, added };
}

async function postToSlack(text) {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SCAN_CHANNEL) return false;
  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: process.env.SLACK_SCAN_CHANNEL, text })
  });
  return (await r.json()).ok;
}

export async function runDailyScan() {
  await q(SCAN_SCHEMA);
  const started = Date.now();
  let federal;
  try { federal = await fetchFederalRegister(); } catch (e) { federal = { error: e.message }; }

  // Integration health (only connectors with credentials set).
  const health = [];
  for (const i of INTEGRATIONS.filter((x) => x.env.every((k) => process.env[k]))) {
    const r = await testIntegration(i.id);
    health.push({ id: i.id, brand: i.brand, ok: r.ok, status: r.status, message: r.message });
  }

  const newUpdates = (await q(`SELECT title, doc_type, html_url FROM regulatory_updates WHERE first_seen_at > now() - interval '1 day' ORDER BY publication_date DESC LIMIT 20`)).rows;
  const orgs = (await q('SELECT id, name FROM organizations WHERE setup_complete')).rows;
  const reports = [];
  for (const org of orgs) {
    const overdue = (await q(`SELECT id, title, next_review_date FROM policies WHERE org_id=$1 AND status='approved' AND next_review_date <= current_date + 30 ORDER BY next_review_date`, [org.id])).rows;
    const stuck = (await q(`SELECT id, title FROM policies WHERE org_id=$1 AND status='in_review' AND updated_at < now() - interval '7 days'`, [org.id])).rows;
    const missingAcks = (await q(
      `SELECT p.id, p.title, (SELECT count(*) FROM users u WHERE u.org_id=p.org_id AND u.active)::int
              - (SELECT count(*) FROM acknowledgments a WHERE a.policy_id=p.id AND a.version=p.current_version)::int AS missing
         FROM policies p WHERE p.org_id=$1 AND p.status='approved'`, [org.id])).rows.filter((r) => r.missing > 0);
    const summary = {
      federal_register: federal,
      new_regulatory_updates: newUpdates,
      policies_due_for_review: overdue,
      reviews_waiting_over_7_days: stuck,
      policies_missing_signoffs: missingAcks,
      integrations: health,
      duration_ms: Date.now() - started
    };
    await q('INSERT INTO scan_reports (org_id, summary) VALUES ($1,$2)', [org.id, summary]);
    await q(`INSERT INTO audit_log (org_id, action, entity, detail) VALUES ($1,'scan.daily','scan',$2)`,
      [org.id, { updates: newUpdates.length, due: overdue.length, stuck: stuck.length, missing_signoffs: missingAcks.length, integration_failures: health.filter((h) => !h.ok).length }]);
    reports.push({ org: org.name, ...summary });
  }

  const failures = health.filter((h) => !h.ok);
  await postToSlack([
    `*FUTURE4000 Daily Scan* (${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })})`,
    `New federal rules and notices: ${newUpdates.length}`,
    ...newUpdates.slice(0, 5).map((u) => `• ${u.title} (${u.doc_type}) ${u.html_url}`),
    `Organizations scanned: ${orgs.length}`,
    `Integration problems: ${failures.length ? failures.map((f) => f.brand).join(', ') : 'none'}`
  ].join('\n')).catch(() => {});

  return { organizations: orgs.length, federal, newUpdates: newUpdates.length, integrationsChecked: health.length, integrationFailures: failures.length, reports };
}
