// Cloud services: AWS S3 and Supabase Storage for documents, Google Vertex AI as a backup route to Claude.
import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { scrubPHI } from './phi.js';

// ---------- Document storage (AWS S3 first, Supabase Storage second) ----------
let s3;
const s3Ready = () => Boolean(process.env.S3_BUCKET);
const supabaseReady = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_BUCKET);

export function storageProvider() {
  if (s3Ready()) return 'aws-s3';
  if (supabaseReady()) return 'supabase';
  return null;
}

// Archives an approved policy version as a file. Returns the stored location, or null when no storage is set.
export async function archiveDocument(key, body, contentType = 'text/markdown') {
  const provider = storageProvider();
  if (provider === 'aws-s3') {
    s3 = s3 || new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType,
      ServerSideEncryption: process.env.S3_KMS_KEY_ID ? 'aws:kms' : 'AES256',
      SSEKMSKeyId: process.env.S3_KMS_KEY_ID || undefined
    }));
    return `s3://${process.env.S3_BUCKET}/${key}`;
  }
  if (provider === 'supabase') {
    const url = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${process.env.SUPABASE_BUCKET}/${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
      body
    });
    if (!res.ok) throw new Error(`Supabase Storage error ${res.status}: ${await res.text()}`);
    return `supabase://${process.env.SUPABASE_BUCKET}/${key}`;
  }
  return null;
}

export async function testS3() {
  s3 = s3 || new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
  return `S3 bucket "${process.env.S3_BUCKET}" reachable`;
}

export async function testSupabase() {
  const res = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/bucket/${process.env.SUPABASE_BUCKET}`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY }
  });
  if (!res.ok) throw new Error(`Supabase answered ${res.status}`);
  return `Supabase bucket "${process.env.SUPABASE_BUCKET}" reachable`;
}

// ---------- Google Cloud Vertex AI (Claude backup route) ----------
// On Google Cloud (Cloud Run sets K_SERVICE) the app signs in as its attached service account: no key file needed.
const onGoogleCloud = () => Boolean(process.env.K_SERVICE || process.env.GOOGLE_USE_DEFAULT_CREDENTIALS === 'true' || process.env.GOOGLE_APPLICATION_CREDENTIALS);
export const vertexReady = () => Boolean(process.env.GOOGLE_CLOUD_PROJECT && (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || onGoogleCloud()));

let vertexClient;
async function vertex() {
  if (vertexClient) return vertexClient;
  const { AnthropicVertex } = await import('@anthropic-ai/vertex-sdk');
  const { GoogleAuth } = await import('google-auth-library');
  const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const credentials = json ? JSON.parse(json) : undefined;
  vertexClient = new AnthropicVertex({
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    region: process.env.GOOGLE_CLOUD_REGION || 'global', // newer Claude models on Vertex need global, us or eu
    googleAuth: new GoogleAuth({ ...(credentials ? { credentials } : {}), scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
  });
  return vertexClient;
}

const VERTEX_MODELS = {
  heavy: process.env.VERTEX_MODEL_HEAVY || 'claude-opus-5-5',
  standard: process.env.VERTEX_MODEL_STANDARD || 'claude-sonnet-5-5',
  fast: process.env.VERTEX_MODEL_FAST || 'claude-haiku-5-5'
};

export async function runOnVertex(tier, system, userText) {
  const client = await vertex();
  const model = VERTEX_MODELS[tier];
  const msg = await client.messages.create({
    model, max_tokens: 4000, system,
    messages: [{ role: 'user', content: scrubPHI(userText).clean }]
  });
  return { text: msg.content.map((c) => c.text || '').join(''), model: `vertex:${model}`, usage: msg.usage };
}

// Live Vertex check with a tiny request, translating common Google errors into plain steps.
export async function testVertex() {
  if (!process.env.GOOGLE_CLOUD_PROJECT) throw new Error('Set GOOGLE_CLOUD_PROJECT to your project ID (the ID, not the display name; it is shown in the project picker).');
  const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (json) {
    let c; try { c = JSON.parse(json); } catch { throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON. Paste the whole downloaded key file.'); }
    if (c.type !== 'service_account') throw new Error('That JSON is not a service account key. Create one under IAM → Service accounts → Keys.');
    if (c.project_id && c.project_id !== process.env.GOOGLE_CLOUD_PROJECT) throw new Error(`The key belongs to project "${c.project_id}" but GOOGLE_CLOUD_PROJECT is "${process.env.GOOGLE_CLOUD_PROJECT}". Use the same project.`);
  } else if (!onGoogleCloud()) throw new Error('Add GOOGLE_APPLICATION_CREDENTIALS_JSON, or run the app on Google Cloud Run where it signs in automatically.');
  try {
    const client = await vertex();
    await client.messages.create({ model: VERTEX_MODELS.fast, max_tokens: 5, messages: [{ role: 'user', content: 'Reply OK' }] });
    return `Vertex AI answered from ${process.env.GOOGLE_CLOUD_REGION || 'global'} using ${VERTEX_MODELS.fast}`;
  } catch (e) {
    vertexClient = null;
    const m = String(e.message || e);
    if (/PERMISSION_DENIED|403/.test(m)) throw new Error('Permission denied: give the service account the "Vertex AI User" role and turn on the Vertex AI API. Enabling Claude in Model Garden also needs a person with the "Consumer Procurement Entitlement Manager" role.');
    if (/NOT_FOUND|404/.test(m)) throw new Error(`Model not found: open Vertex AI → Model Garden, enable the Claude models, and use region "global" for current Claude models (currently set: ${process.env.GOOGLE_CLOUD_REGION || 'global'}).`);
    if (/invalid_grant|unauthorized_client|401/.test(m)) throw new Error('Google rejected the key: it may be deleted or disabled. Create a new key for the service account.');
    if (/RESOURCE_EXHAUSTED|429/.test(m)) throw new Error('Vertex quota reached: request a quota increase for Claude models in this region.');
    if (/billing/i.test(m)) throw new Error('Billing is not enabled on this Google Cloud project.');
    throw new Error(`Vertex AI error: ${m.slice(0, 300)}`);
  }
}

// OpenAI's open models (gpt-oss) served by Google Vertex AI through its OpenAI-compatible endpoint.
// Same Google sign-in as Claude on Vertex; covered by the Google Cloud agreement rather than OpenAI's.
const GPT_OSS = { heavy: process.env.VERTEX_OPENAI_MODEL_HEAVY || 'openai/gpt-oss-120b-maas', standard: process.env.VERTEX_OPENAI_MODEL_STANDARD || 'openai/gpt-oss-120b-maas', fast: process.env.VERTEX_OPENAI_MODEL_FAST || 'openai/gpt-oss-20b-maas' };
let googleAuthClient;
async function googleToken() {
  if (!googleAuthClient) {
    const { GoogleAuth } = await import('google-auth-library');
    const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    googleAuthClient = new GoogleAuth({ ...(json ? { credentials: JSON.parse(json) } : {}), scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  return (await googleAuthClient.getClient()).getAccessToken().then((t) => t.token || t);
}
export async function runGptOssOnVertex(tier, system, userText) {
  const region = process.env.VERTEX_OPENAI_REGION || 'global';
  const host = region === 'global' ? 'aiplatform.googleapis.com' : `${region}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${process.env.GOOGLE_CLOUD_PROJECT}/locations/${region}/endpoints/openapi/chat/completions`;
  const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${await googleToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: GPT_OSS[tier], messages: [{ role: 'system', content: system }, { role: 'user', content: scrubPHI(userText).clean }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || j[0]?.error?.message || `Vertex OpenAI-compatible endpoint error ${r.status}: enable the gpt-oss model in Model Garden.`);
  return { text: j.choices?.[0]?.message?.content || '', model: `vertex:${GPT_OSS[tier]}`, usage: j.usage };
}
