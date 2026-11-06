// FUTURE4000 Integrations Marketplace.
// Each connector lists the credentials it needs. A connector shows "Connected" only
// when its credentials are set AND its live test passes - nothing is faked.
import Stripe from 'stripe';

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

export const INTEGRATIONS = [
  // Healthcare
  {
    id: 'hl7-fhir', name: 'HL7 / FHIR Engine', category: 'Healthcare', hipaa: true, priority: 1,
    upgrade: 'HL7 v2 to FHIR translation, automatic error detection, visual interface mapper.',
    env: ['FHIR_BASE_URL'],
    test: () => fhirMetadata('FHIR_BASE_URL', 'FHIR_ACCESS_TOKEN')
  },
  {
    id: 'epic', name: 'Epic', category: 'Healthcare', hipaa: true, priority: 1,
    upgrade: 'Prebuilt SMART on FHIR connector, AI documentation support, compliance dashboard from Epic data.',
    env: ['EPIC_FHIR_BASE_URL', 'EPIC_CLIENT_ID'],
    setup: 'Register an app at Epic on FHIR (fhir.epic.com) to get a client ID. Use the sandbox base URL for testing.',
    test: () => fhirMetadata('EPIC_FHIR_BASE_URL', 'EPIC_ACCESS_TOKEN')
  },
  {
    id: 'oracle-health', name: 'Oracle Health (Cerner)', category: 'Healthcare', hipaa: true, priority: 2,
    upgrade: 'Migration toolkit with data mapping and audit trail, unified multi-EHR view.',
    env: ['ORACLE_FHIR_BASE_URL', 'ORACLE_CLIENT_ID'],
    setup: 'Register through the Oracle Health (Cerner) code console to get FHIR credentials.',
    test: () => fhirMetadata('ORACLE_FHIR_BASE_URL', 'ORACLE_ACCESS_TOKEN')
  },
  {
    id: 'athenahealth', name: 'athenahealth', category: 'Healthcare', hipaa: true, priority: 2,
    upgrade: 'Custom compliance and quality reports, AI policies tied to practice workflows.',
    env: ['ATHENA_FHIR_BASE_URL', 'ATHENA_CLIENT_ID'],
    setup: 'Apply through the athenahealth Developer Portal for API credentials.',
    test: () => fhirMetadata('ATHENA_FHIR_BASE_URL', 'ATHENA_ACCESS_TOKEN')
  },
  {
    id: 'surescripts', name: 'Surescripts', category: 'Healthcare', hipaa: true, priority: 3,
    upgrade: 'E-prescribing status tracking, prior-authorization automation, EPCS compliance logs.',
    env: ['SURESCRIPTS_PARTNER_ID', 'SURESCRIPTS_API_KEY'],
    setup: 'Requires Surescripts network certification. Contact Surescripts to start the certification process.'
  },
  {
    id: 'evv', name: 'EVV Systems', category: 'Healthcare', hipaa: true, priority: 2,
    upgrade: '50-state EVV rules engine, mismatch detection before billing, caregiver mobile check-in.',
    env: ['EVV_AGGREGATOR_URL', 'EVV_API_KEY'],
    setup: 'Each state uses its own EVV aggregator (for example Sandata, HHAeXchange, Tellus). Request API access from your state\'s vendor.'
  },
  {
    id: 'clearinghouse', name: 'Claims Clearinghouse', category: 'Healthcare', hipaa: true, priority: 2,
    upgrade: 'AI denial explainer, claim scrubbing before submission, denial trend reports.',
    env: ['CLEARINGHOUSE_API_URL', 'CLEARINGHOUSE_API_KEY'],
    setup: 'Sign an API agreement with a clearinghouse such as Availity, Change Healthcare (Optum), or Waystar.'
  },
  // Business
  {
    id: 'stripe', name: 'Stripe', category: 'Business', hipaa: false, priority: 1,
    upgrade: 'Organization-level subscriptions and payments, revenue dashboard. Never stores patient data.',
    env: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'],
    test: async () => {
      const bal = await new Stripe(process.env.STRIPE_SECRET_KEY).balance.retrieve();
      return `Stripe reachable (${bal.livemode ? 'LIVE mode' : 'test mode'})`;
    }
  },
  {
    id: 'quickbooks', name: 'QuickBooks', category: 'Business', hipaa: false, priority: 3,
    upgrade: 'Automatic Stripe revenue sync, healthcare chart of accounts, multi-location reporting.',
    env: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'],
    setup: 'Create an app at developer.intuit.com for OAuth credentials.'
  },
  {
    id: 'microsoft-365', name: 'Microsoft 365', category: 'Business', hipaa: true, priority: 2,
    upgrade: 'Import SharePoint policies with version control, staff sign-off tracking, Teams alerts.',
    env: ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET'],
    setup: 'Register an app in Microsoft Entra ID (Azure AD) with Microsoft Graph permissions.'
  },
  {
    id: 'google-workspace', name: 'Google Workspace', category: 'Business', hipaa: true, priority: 3,
    upgrade: 'Import Drive policies, enforce sharing restrictions, access audit reports.',
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    setup: 'Create OAuth credentials in Google Cloud Console with Drive and Admin SDK scopes.'
  },
  {
    id: 'slack', name: 'Slack', category: 'Business', hipaa: false, priority: 3,
    upgrade: 'PHI blocker on messages, compliance alert channels, approvals inside Slack.',
    env: ['SLACK_BOT_TOKEN'],
    test: async () => {
      const r = await fetch('https://slack.com/api/auth.test', { method: 'POST', headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Slack token rejected');
      return `Slack workspace "${j.team}" connected`;
    }
  },
  {
    id: 'zoom', name: 'Zoom', category: 'Business', hipaa: true, priority: 3,
    upgrade: 'Automatic training attendance credit in LearnTrack, recordings linked to modules.',
    env: ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'],
    setup: 'Create a Server-to-Server OAuth app in the Zoom App Marketplace.'
  },
  {
    id: 'esign', name: 'DocuSign / Jotform Sign', category: 'Business', hipaa: true, priority: 3,
    upgrade: 'Signed policies and attestations filed into the audit trail, re-sign reminders.',
    env: ['ESIGN_PROVIDER', 'ESIGN_API_KEY'],
    setup: 'Set ESIGN_PROVIDER to "docusign" or "jotform" and add that provider\'s API key.'
  }
];

export function listIntegrations() {
  return INTEGRATIONS.map(({ test, ...i }) => ({
    ...i,
    credentialsSet: has(...i.env),
    testable: Boolean(test),
    status: has(...i.env) ? 'credentials-set' : 'needs-credentials'
  }));
}

export async function testIntegration(id) {
  const i = INTEGRATIONS.find((x) => x.id === id);
  if (!i) throw Object.assign(new Error('Unknown integration'), { status: 404 });
  if (!has(...i.env)) {
    return { id, ok: false, status: 'needs-credentials', message: `Add these settings in Render: ${i.env.join(', ')}`, setup: i.setup };
  }
  if (!i.test) {
    return { id, ok: true, status: 'credentials-set', message: 'Credentials saved. Live connection is built after partner approval.', setup: i.setup };
  }
  try {
    return { id, ok: true, status: 'connected', message: await i.test() };
  } catch (e) {
    return { id, ok: false, status: 'error', message: e.message };
  }
}
