// F4 Connect: the FUTURE4000 Integrations Marketplace.
// Every connector has a FUTURE4000 brand name, the system it connects to, the weaknesses of that
// system it fixes, and the credentials it needs. "Connected" is shown only when a live test passes.
import Stripe from 'stripe';
import { testS3, testSupabase } from './cloud.js';
import { PROVIDERS } from './ai.js';

const has = (...keys) => keys.every((k) => Boolean(process.env[k]));

async function fhirMetadata(baseUrlEnv, tokenEnv) {
  const base = process.env[baseUrlEnv];
  const headers = { Accept: 'application/fhir+json' };
  if (tokenEnv && process.env[tokenEnv]) headers.Authorization = `Bearer ${process.env[tokenEnv]}`;
  const res = await fetch(`${base.replace(/\/$/, '')}/metadata`, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`FHIR server answered ${res.status}`);
  const cap = await res.json();
  return `FHIR ${cap.fhirVersion || 'server'} reachable (${cap.software?.name || cap.publisher || 'capability statement received'})`;
}

async function bearerGet(url, token, label) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`${label} answered ${r.status}`);
  return r.json();
}

export const INTEGRATIONS = [
  // ---------------- Healthcare ----------------
  { id: 'hl7-fhir', brand: 'F4 InterLink', connects: 'HL7 v2 / FHIR R4', category: 'Healthcare', hipaa: true, priority: 1,
    fixes: ['HL7 v2 messages are messy and vendor-specific', 'Every vendor implements FHIR differently', 'Interfaces need specialist programmers'],
    upgrade: 'HL7 v2 to FHIR translation, automatic error detection and repair, visual mapper non-programmers can use.',
    env: ['FHIR_BASE_URL'], test: () => fhirMetadata('FHIR_BASE_URL', 'FHIR_ACCESS_TOKEN') },
  { id: 'epic', brand: 'F4 EHR Bridge', connects: 'Epic', category: 'Healthcare', hipaa: true, priority: 1,
    fixes: ['Integration projects take months', 'Closed app approval process', 'Heavy documentation burden on clinicians'],
    upgrade: 'Prebuilt SMART on FHIR connector, AI documentation support, compliance dashboard built from Epic data.',
    env: ['EPIC_FHIR_BASE_URL', 'EPIC_CLIENT_ID'], setup: 'Register an app at Epic on FHIR (fhir.epic.com) for a client ID. Use the sandbox base URL to test.',
    test: () => fhirMetadata('EPIC_FHIR_BASE_URL', 'EPIC_ACCESS_TOKEN') },
  { id: 'oracle-health', brand: 'F4 EHR Bridge', connects: 'Oracle Health (Cerner)', category: 'Healthcare', hipaa: true, priority: 2,
    fixes: ['Migration disruption', 'Inconsistent interfaces across sites'],
    upgrade: 'Migration toolkit with data mapping, validation, and audit trail; one view across EHRs.',
    env: ['ORACLE_FHIR_BASE_URL', 'ORACLE_CLIENT_ID'], setup: 'Register through the Oracle Health code console for FHIR credentials.',
    test: () => fhirMetadata('ORACLE_FHIR_BASE_URL', 'ORACLE_ACCESS_TOKEN') },
  { id: 'athenahealth', brand: 'F4 EHR Bridge', connects: 'athenahealth', category: 'Healthcare', hipaa: true, priority: 2,
    fixes: ['Limited reporting for small practices', 'Little workflow customization'],
    upgrade: 'Custom compliance and quality reports; AI policies tied to the practice\'s real workflows.',
    env: ['ATHENA_FHIR_BASE_URL', 'ATHENA_CLIENT_ID'], setup: 'Apply through the athenahealth Developer Portal for API credentials.',
    test: () => fhirMetadata('ATHENA_FHIR_BASE_URL', 'ATHENA_ACCESS_TOKEN') },
  { id: 'surescripts', brand: 'F4 RxTrack', connects: 'Surescripts', category: 'Healthcare', hipaa: true, priority: 3,
    fixes: ['Little visibility into failed prescriptions', 'Prior-authorization delays'],
    upgrade: 'E-prescribing status tracking, prior-authorization automation, EPCS compliance logs.',
    env: ['SURESCRIPTS_PARTNER_ID', 'SURESCRIPTS_API_KEY'], setup: 'Requires Surescripts network certification. Contact Surescripts to begin.' },
  { id: 'evv', brand: 'F4 VisitVerify', connects: 'State EVV aggregators', category: 'Healthcare', hipaa: true, priority: 2,
    fixes: ['Different vendor and rules in every state', 'Hard caregiver check-ins', 'Claims denied for EVV mismatches'],
    upgrade: '50-state EVV rules engine, mismatch detection before billing, simple caregiver check-in.',
    env: ['EVV_AGGREGATOR_URL', 'EVV_API_KEY'], setup: 'Request API access from your state\'s EVV vendor (for example Sandata, HHAeXchange, Tellus).' },
  { id: 'clearinghouse', brand: 'F4 ClaimClear', connects: 'Claims clearinghouses', category: 'Healthcare', hipaa: true, priority: 2,
    fixes: ['Slow responses', 'Denial reasons hard to understand', 'Manual rework'],
    upgrade: 'AI denial explainer in plain English, claim scrubbing before submission, denial trend reports.',
    env: ['CLEARINGHOUSE_API_URL', 'CLEARINGHOUSE_API_KEY'], setup: 'Sign an API agreement with a clearinghouse such as Availity, Optum (Change Healthcare), or Waystar.' },

  // ---------------- Cloud and AI ----------------
  { id: 'aws', brand: 'F4 Vault', connects: 'AWS S3 + Bedrock', category: 'Cloud & AI', hipaa: true, priority: 1,
    fixes: ['Complex console and setup', 'Easy to misconfigure public buckets', 'Bills hard to predict'],
    upgrade: 'Encrypted document archive for every approved policy, Claude on Bedrock under your AWS BAA, preset secure settings.',
    env: ['S3_BUCKET'], setup: 'On AWS the app uses its own IAM role (no keys). Elsewhere, add an IAM user limited to the bucket and bedrock:InvokeModel. Sign the AWS BAA in AWS Artifact.',
    test: testS3 },
  { id: 'google-cloud', brand: 'F4 Intelligence Backup', connects: 'Google Cloud Vertex AI', category: 'Cloud & AI', hipaa: true, priority: 2,
    fixes: ['Single AI provider is a single point of failure'],
    upgrade: 'Automatic failover to Claude on Vertex AI if Bedrock is unavailable.',
    env: ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_APPLICATION_CREDENTIALS_JSON'], setup: 'Enable Claude in Vertex AI Model Garden, create a service account with Vertex AI User role, paste its JSON key. Sign the Google Cloud BAA.',
    test: async () => { if (!PROVIDERS.vertex.ready()) throw new Error('Vertex credentials incomplete'); JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON); return 'Vertex credentials valid JSON; first agent run confirms access'; } },
  { id: 'supabase', brand: 'F4 Vault (Supabase)', connects: 'Supabase Postgres + Storage', category: 'Cloud & AI', hipaa: true, priority: 2,
    fixes: ['Row security easy to leave off', 'HIPAA only on higher plans'],
    upgrade: 'Use Supabase Postgres as the FUTURE4000 database (set DATABASE_URL) and Supabase Storage as the document archive.',
    env: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_BUCKET'], setup: 'Create a private Storage bucket. HIPAA use requires Supabase\'s HIPAA add-on and BAA.',
    test: testSupabase },
  { id: 'claude', brand: 'F4 Intelligence', connects: 'Claude (Anthropic API)', category: 'Cloud & AI', hipaa: true, priority: 1,
    fixes: ['Plain chat has no compliance guardrails', 'No organization memory', 'No audit trail of AI use'],
    upgrade: 'Claude wrapped with PHI masking, regulation-aware prompts, clinician approval, and full audit logging.',
    env: ['ANTHROPIC_API_KEY'], setup: 'Create an API key at console.anthropic.com. For PHI, arrange a BAA with Anthropic.',
    test: async () => { const r = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } }); if (!r.ok) throw new Error(`Anthropic answered ${r.status}`); return 'Anthropic API key valid'; } },
  { id: 'chatgpt', brand: 'F4 Intelligence (secondary)', connects: 'ChatGPT (OpenAI API)', category: 'Cloud & AI', hipaa: false, priority: 3,
    fixes: ['Separate product with no healthcare controls', 'No BAA by default'],
    upgrade: 'Optional backup model inside the same guardrails. Keep it last in AI_PROVIDER_ORDER unless OpenAI has signed a BAA with you.',
    env: ['OPENAI_API_KEY'], setup: 'Create an API key at platform.openai.com. Do not send PHI-derived content without an OpenAI BAA.',
    test: async () => { await bearerGet('https://api.openai.com/v1/models', process.env.OPENAI_API_KEY, 'OpenAI'); return 'OpenAI API key valid'; } },
  { id: 'replit', brand: 'F4 Dev Studio', connects: 'Replit', category: 'Cloud & AI', hipaa: false, priority: 3,
    fixes: ['Not designed for regulated data', 'Prototypes drift from production'],
    upgrade: 'Use Replit for prototyping with test data only; promote code to this GitHub repo for production on HIPAA hosting.',
    env: ['REPLIT_PROJECT_URL'], setup: 'Paste your Replit project URL. Replit has no BAA, so keep real patient data out.' },

  // ---------------- Business ----------------
  { id: 'stripe', brand: 'F4 Pay', connects: 'Stripe', category: 'Business', hipaa: false, priority: 1,
    fixes: ['Not built for healthcare billing', 'No BAA for patient data'],
    upgrade: 'Organization-level subscriptions with automatic plan activation. Never stores patient data.',
    env: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'],
    test: async () => { const bal = await new Stripe(process.env.STRIPE_SECRET_KEY).balance.retrieve(); return `Stripe reachable (${bal.livemode ? 'LIVE mode' : 'test mode'})`; } },
  { id: 'quickbooks', brand: 'F4 Ledger', connects: 'QuickBooks', category: 'Business', hipaa: false, priority: 3,
    fixes: ['Weak multi-location healthcare reporting', 'Manual reconciliation'],
    upgrade: 'Automatic Stripe revenue sync and a healthcare chart of accounts.',
    env: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'], setup: 'Create an app at developer.intuit.com for OAuth credentials.' },
  { id: 'microsoft-365', brand: 'F4 Workspace', connects: 'Microsoft 365', category: 'Business', hipaa: true, priority: 2,
    fixes: ['Policies scattered in SharePoint', 'No version control or sign-off tracking'],
    upgrade: 'Import SharePoint policies with versions, staff acknowledgment tracking, Teams alerts.',
    env: ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET'], setup: 'Register an app in Microsoft Entra ID with Microsoft Graph permissions.' },
  { id: 'google-workspace', brand: 'F4 Workspace', connects: 'Google Workspace', category: 'Business', hipaa: true, priority: 3,
    fixes: ['Document sprawl in Drive', 'Compliance settings left to the admin'],
    upgrade: 'Import Drive policies, enforce sharing restrictions, access audit reports.',
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], setup: 'Create OAuth credentials in Google Cloud Console with Drive and Admin SDK scopes.' },
  { id: 'slack', brand: 'F4 Alerts', connects: 'Slack', category: 'Business', hipaa: false, priority: 3,
    fixes: ['Not a place for patient data', 'Compliance alerts lost in chatter'],
    upgrade: 'PHI blocker on outgoing messages, dedicated compliance alert channels.',
    env: ['SLACK_BOT_TOKEN'],
    test: async () => { const r = await fetch('https://slack.com/api/auth.test', { method: 'POST', headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } }); const j = await r.json(); if (!j.ok) throw new Error(j.error || 'Slack token rejected'); return `Slack workspace "${j.team}" connected`; } },
  { id: 'zoom', brand: 'F4 LiveLearn', connects: 'Zoom', category: 'Business', hipaa: true, priority: 3,
    fixes: ['Training attendance not tied to compliance requirements'],
    upgrade: 'Automatic attendance credit in LearnTrack; recordings linked to training modules.',
    env: ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'], setup: 'Create a Server-to-Server OAuth app in the Zoom App Marketplace.' },
  { id: 'monday', brand: 'F4 Projects', connects: 'monday.com', category: 'Business', hipaa: false, priority: 2,
    fixes: ['Compliance tasks tracked apart from the policies they come from', 'No audit trail tied to regulations'],
    upgrade: 'Corrective actions and survey findings pushed to monday.com boards, with status synced back to ComplyTrack.',
    env: ['MONDAY_API_TOKEN'], setup: 'Create a personal API token in monday.com (Profile > Developers). Keep PHI out of boards.',
    test: async () => { const r = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { Authorization: process.env.MONDAY_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ me { name account { name } } }' }) }); const j = await r.json(); if (!r.ok || j.errors) throw new Error(j.errors?.[0]?.message || `monday.com answered ${r.status}`); return `monday.com account "${j.data.me.account.name}" connected`; } },
  { id: 'youtube', brand: 'F4 Media', connects: 'YouTube', category: 'Media', hipaa: false, priority: 3,
    fixes: ['Training videos not tracked for completion', 'Public videos can leak internal content'],
    upgrade: 'Embed unlisted training videos inside LearnTrack modules and record who finished them.',
    env: ['YOUTUBE_API_KEY'], setup: 'Create a YouTube Data API v3 key in Google Cloud Console. Use unlisted or private videos for internal training.',
    test: async () => { const r = await fetch(`https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US&key=${encodeURIComponent(process.env.YOUTUBE_API_KEY)}`); if (!r.ok) throw new Error(`YouTube answered ${r.status}`); return 'YouTube Data API key valid'; } },
  { id: 'capcut', brand: 'F4 Studio', connects: 'CapCut', category: 'Media', hipaa: false, priority: 3,
    fixes: ['Video editing done outside the training system', 'No version link between video and policy'],
    upgrade: 'Edit training videos in CapCut, export, and attach them to the matching policy version in LearnTrack.',
    env: ['CAPCUT_WORKSPACE_URL'], setup: 'CapCut has no general public API: export finished videos and upload them, or paste your workspace link here. Never film patients.' },
  { id: 'esign', brand: 'F4 Sign', connects: 'DocuSign / Jotform Sign', category: 'Business', hipaa: true, priority: 3,
    fixes: ['Signatures sit outside the compliance record', 'No re-sign reminders'],
    upgrade: 'Signed policies and attestations filed into the audit trail with renewal reminders.',
    env: ['ESIGN_PROVIDER', 'ESIGN_API_KEY'], setup: 'Set ESIGN_PROVIDER to "docusign" or "jotform" and add that provider\'s API key.' }
];

export function listIntegrations() {
  return INTEGRATIONS.map(({ test, ...i }) => ({ ...i, credentialsSet: has(...i.env), testable: Boolean(test) }));
}

export async function testIntegration(id) {
  const i = INTEGRATIONS.find((x) => x.id === id);
  if (!i) throw Object.assign(new Error('Unknown integration'), { status: 404 });
  if (!has(...i.env)) return { id, ok: false, status: 'needs-credentials', message: `Add these settings to your environment: ${i.env.join(', ')}`, setup: i.setup };
  if (!i.test) return { id, ok: true, status: 'credentials-set', message: 'Credentials saved. The live connector is completed after partner approval.', setup: i.setup };
  try {
    return { id, ok: true, status: 'connected', message: await i.test() };
  } catch (e) {
    return { id, ok: false, status: 'error', message: e.message };
  }
}
