// F4 Connect: the FUTURE4000 Integrations Marketplace.
// Every connector has a FUTURE4000 brand name, the system it connects to, the weaknesses of that
// system it fixes, and the credentials it needs. "Connected" is shown only when a live test passes.
import Stripe from 'stripe';
import { testS3, testSupabase, testVertex } from './cloud.js';
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
  { id: 'google-cloud', brand: 'F4 Intelligence on Google', connects: 'Google Cloud Vertex AI', category: 'Cloud & AI', hipaa: true, priority: 2,
    fixes: ['Single AI provider is a single point of failure'],
    upgrade: 'Automatic failover to Claude on Vertex AI if Bedrock is unavailable.',
    env: ['GOOGLE_CLOUD_PROJECT'], setup: '1 Copy your project ID. 2 Turn on billing and the Vertex AI API. 3 Model Garden: enable the Claude models (needs the Consumer Procurement Entitlement Manager role). Set GOOGLE_CLOUD_REGION to global. 4 Service account with the Vertex AI User role. 5 On Cloud Run nothing else is needed; elsewhere add its JSON key as GOOGLE_APPLICATION_CREDENTIALS_JSON in your secret store. 6 Accept the Google Cloud BAA before any patient data.',
    test: testVertex },
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

  // ---------------- Google apps ----------------
  { id: 'google-play', brand: 'Payment Time for Apps', connects: 'Google Play', category: 'Google', hipaa: false, priority: 1,
    fixes: ['App subscriptions sold through Play billing carry Google service fees', 'Publishing, testing tracks and reviews are confusing', 'Subscription status lives apart from the rest of the business'],
    upgrade: 'Publish and track your Android app from one place. Use Play only for app subscriptions; patient bills always go through Payment Time at card rates.',
    env: ['GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', 'GOOGLE_PLAY_PACKAGE_NAME'],
    setup: 'Play Console (one-time developer registration) → Users and permissions → invite a Google Cloud service account with the least access needed. Keep the key in Secret Manager, never in email or chat.' },
  { id: 'google-pay', brand: 'Payment Time Wallet Button', connects: 'Google Pay', category: 'Google', hipaa: false, priority: 2,
    fixes: ['Typing card numbers on a phone is slow', 'Checkout abandonment on mobile'],
    upgrade: 'One-tap Google Pay on Payment Time checkout pages, turned on inside the processor you already connected.',
    env: [], setup: 'Turn on Google Pay in your connected processor (Stripe, Square or PayPal/Braintree). Card rates of your processor apply.' },
  { id: 'google-wallet', brand: 'F4 Wallet Passes', connects: 'Google Wallet', category: 'Google', hipaa: false, priority: 3,
    fixes: ['Paper membership, campus and appointment cards get lost'],
    upgrade: 'Digital passes for campus IDs, event check-in and appointment cards. Health insurance details only with patient consent and a privacy review.',
    env: ['GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON'], setup: 'Apply for a Google Wallet issuer account in the Google Pay & Wallet Console, then add a service account.' },
  { id: 'firebase', brand: 'F4 Mobile', connects: 'Firebase', category: 'Google', hipaa: false, priority: 2,
    fixes: ['Mobile sign-in and notifications built from scratch', 'Notifications can leak patient details on lock screens'],
    upgrade: 'App sign-in and push notifications with a rule that notifications never contain patient details ("You have a new message").',
    env: ['FIREBASE_PROJECT_ID'], setup: 'Check which Firebase services Google lists as covered by its business associate agreement before any patient data is involved.' },
  { id: 'google-maps', brand: 'F4 Locations', connects: 'Google Maps Platform', category: 'Google', hipaa: false, priority: 3,
    fixes: ['Patients cannot find the right clinic entrance or location'],
    upgrade: 'Clinic and campus locator with directions, hours and accessibility notes. No patient data is ever sent to Maps.',
    env: ['GOOGLE_MAPS_API_KEY'], setup: 'Create an API key in Google Cloud and restrict it to your website domain and the Maps APIs you use.' },
  { id: 'google-analytics', brand: 'F4 Insights', connects: 'Google Analytics', category: 'Google', hipaa: false, priority: 3,
    fixes: ['Tracking code on patient pages can disclose health information'],
    upgrade: 'Analytics allowed on public marketing pages only; blocked automatically on sign-in, portal and payment pages.',
    env: ['GA_MEASUREMENT_ID'], setup: 'Follow HHS guidance on online tracking technologies: never place tracking on pages where patients sign in or enter health details.' },
  { id: 'google-business', brand: 'F4 Reputation', connects: 'Google Business Profile', category: 'Google', hipaa: false, priority: 3,
    fixes: ['Replying to reviews can accidentally confirm someone is a patient'],
    upgrade: 'Review replies drafted by AI with a privacy check that never confirms a reviewer is a patient; hours and locations kept current.',
    env: ['GOOGLE_BUSINESS_ACCOUNT_ID'], setup: 'Connect with the Google account that manages your Business Profile; replies need human approval.' },
  { id: 'health-connect', brand: 'F4 Patient Devices', connects: 'Health Connect (Android)', category: 'Google', hipaa: true, priority: 3,
    fixes: ['Patient device data (steps, heart rate, sleep) is scattered across apps'],
    upgrade: 'With the patient\'s permission, the mobile app reads only the data types a care plan needs, with every read logged.',
    env: [], setup: 'Built into the mobile app: Android asks the patient for permission per data type. Requires your app\'s privacy policy and Play Console health declarations.' },

  // ---------------- Business ----------------
  { id: 'stripe', brand: 'Payment Time', connects: 'Stripe', category: 'Business', hipaa: false, priority: 1,
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
  { id: 'adobe', brand: 'F4 Documents and Design', connects: 'Adobe (Acrobat, PDF Services, Acrobat Sign, Express)', category: 'Media', hipaa: true, priority: 2,
    fixes: ['Policies and manuals rebuilt by hand as PDFs', 'Signatures collected on paper', 'Training graphics made one at a time'],
    upgrade: 'Approved policies become accessible PDFs automatically, staff sign-offs go out through Acrobat Sign, and LearnTrack graphics start from Express templates.',
    env: ['ADOBE_CLIENT_ID', 'ADOBE_CLIENT_SECRET'], setup: 'Create a project in the Adobe Developer Console and add PDF Services or Acrobat Sign. Ask Adobe about its HIPAA-eligible offerings before signing documents that contain patient information.' },
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
