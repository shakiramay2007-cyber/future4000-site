// Cloud services: AWS S3 and Supabase Storage for documents, Google Vertex AI as a backup route to Claude.
import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { scrubPHI } from './phi.js';

// ---------- Document storage (AWS S3 first, Supabase Storage second) ----------
let s3;
const s3Ready = () => Boolean(process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID);
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
export const vertexReady = () => Boolean(process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

let vertexClient;
async function vertex() {
  if (vertexClient) return vertexClient;
  const { AnthropicVertex } = await import('@anthropic-ai/vertex-sdk');
  const { GoogleAuth } = await import('google-auth-library');
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  vertexClient = new AnthropicVertex({
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    region: process.env.GOOGLE_CLOUD_REGION || 'us-east5',
    googleAuth: new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
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
