// F4 Intelligence: one AI router across Claude on AWS Bedrock, Claude on Google Vertex AI,
// Claude via the Anthropic API, and ChatGPT (OpenAI). If a provider fails, the next one is tried.
// HIPAA: only providers with a signed BAA may receive anything derived from PHI. Text is PHI-scrubbed first either way.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { scrubPHI } from './phi.js';
import { vertexReady, runOnVertex } from './cloud.js';

const MODELS = {
  bedrock: {
    heavy: process.env.BEDROCK_MODEL_HEAVY || 'anthropic.claude-opus-5-5',
    standard: process.env.BEDROCK_MODEL_STANDARD || 'anthropic.claude-sonnet-5-5',
    fast: process.env.BEDROCK_MODEL_FAST || 'anthropic.claude-haiku-5-5'
  },
  anthropic: {
    heavy: process.env.ANTHROPIC_MODEL_HEAVY || 'claude-opus-5-5',
    standard: process.env.ANTHROPIC_MODEL_STANDARD || 'claude-sonnet-5-5',
    fast: process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-5-5'
  },
  openai: {
    heavy: process.env.OPENAI_MODEL_HEAVY || 'gpt-5',
    standard: process.env.OPENAI_MODEL_STANDARD || 'gpt-5',
    fast: process.env.OPENAI_MODEL_FAST || 'gpt-5-mini'
  }
};

export const PROVIDERS = {
  bedrock: { label: 'Claude on AWS Bedrock', ready: () => Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY), baa: 'AWS BAA' },
  vertex: { label: 'Claude on Google Vertex AI', ready: vertexReady, baa: 'Google Cloud BAA' },
  anthropic: { label: 'Claude (Anthropic API)', ready: () => Boolean(process.env.ANTHROPIC_API_KEY), baa: 'Anthropic BAA (sales agreement)' },
  openai: { label: 'ChatGPT (OpenAI API)', ready: () => Boolean(process.env.OPENAI_API_KEY), baa: 'OpenAI BAA (sales agreement)' }
};

const ORDER = (process.env.AI_PROVIDER_ORDER || 'bedrock,vertex,anthropic,openai').split(',').map((s) => s.trim()).filter((p) => PROVIDERS[p]);

let bedrockClient;
async function callBedrock(tier, system, text) {
  bedrockClient = bedrockClient || new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const modelId = MODELS.bedrock[tier];
  const r = await bedrockClient.send(new ConverseCommand({
    modelId, system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text }] }],
    inferenceConfig: { maxTokens: 4000 }
  }));
  return { text: (r.output?.message?.content || []).map((c) => c.text || '').join(''), model: `bedrock:${modelId}`, usage: r.usage };
}

async function callAnthropic(tier, system, text) {
  const model = MODELS.anthropic[tier];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4000, system, messages: [{ role: 'user', content: text }] }),
    signal: AbortSignal.timeout(120000)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `Anthropic API error ${r.status}`);
  return { text: j.content.map((c) => c.text || '').join(''), model: `anthropic:${model}`, usage: j.usage };
}

async function callOpenAI(tier, system, text) {
  const model = MODELS.openai[tier];
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: text }] }),
    signal: AbortSignal.timeout(120000)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `OpenAI API error ${r.status}`);
  return { text: j.choices?.[0]?.message?.content || '', model: `openai:${model}`, usage: j.usage };
}

const CALLERS = { bedrock: callBedrock, vertex: runOnVertex, anthropic: callAnthropic, openai: callOpenAI };

export function aiConfigured() {
  return ORDER.some((p) => PROVIDERS[p].ready());
}

export function aiStatus() {
  return ORDER.map((p) => ({ id: p, label: PROVIDERS[p].label, ready: PROVIDERS[p].ready(), baa: PROVIDERS[p].baa }));
}

// Runs a prompt through the first working provider. Returns text, model used, PHI findings, and any failovers.
export async function complete(tier, system, userText, { preferred } = {}) {
  const guard = scrubPHI(userText);
  const order = preferred && PROVIDERS[preferred] ? [preferred, ...ORDER.filter((p) => p !== preferred)] : ORDER;
  const ready = order.filter((p) => PROVIDERS[p].ready());
  if (!ready.length) {
    throw Object.assign(new Error('No AI provider is connected. Add AWS, Google Vertex, Anthropic, or OpenAI keys in Render.'), { status: 503 });
  }
  const failovers = [];
  for (const p of ready) {
    try {
      const out = await CALLERS[p](tier, system, guard.clean);
      return { ...out, provider: p, phi: { redactions: guard.redactions, types: guard.findings }, failovers };
    } catch (e) {
      console.error(`AI provider ${p} failed: ${e.message}`);
      failovers.push({ provider: p, error: e.message });
    }
  }
  throw Object.assign(new Error(`All AI providers failed: ${failovers.map((f) => `${f.provider} (${f.error})`).join('; ')}`), { status: 502 });
}
