// F4 Intelligence: one AI router across Claude on AWS Bedrock, Claude on Google Vertex AI,
// Claude via the Anthropic API, and ChatGPT (OpenAI). If a provider fails, the next one is tried.
// HIPAA: only providers with a signed BAA may receive anything derived from PHI. Text is PHI-scrubbed first either way.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { scrubPHI } from './phi.js';
import { vertexReady, runOnVertex, runGptOssOnVertex } from './cloud.js';

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
  bedrock: { label: 'Claude on AWS Bedrock', ready: () => process.env.BEDROCK_ENABLED === 'true' || Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY), baa: 'AWS BAA' },
  vertex: { label: 'Claude on Google Vertex AI', ready: vertexReady, baa: 'Google Cloud BAA' },
  anthropic: { label: 'Claude (Anthropic API)', ready: () => Boolean(process.env.ANTHROPIC_API_KEY), baa: 'Anthropic BAA (sales agreement)' },
  openai: { label: 'ChatGPT (OpenAI API)', ready: () => Boolean(process.env.OPENAI_API_KEY), baa: 'OpenAI BAA (sales agreement)' },
  'vertex-openai': { label: 'OpenAI gpt-oss on Google Vertex AI', ready: () => vertexReady() && process.env.VERTEX_OPENAI_ENABLED === 'true', baa: 'Google Cloud BAA' }
};

const ORDER = (process.env.AI_PROVIDER_ORDER || 'bedrock,vertex,anthropic,openai,vertex-openai').split(',').map((s) => s.trim()).filter((p) => PROVIDERS[p]);

let bedrockClient;
// Claude features used on Bedrock:
// - prompt caching: the long system prompt is cached (cachePoint), so repeat calls are faster and cheaper
// - document input: PDFs and text files are read directly by Claude
// - Bedrock Guardrails (optional): set BEDROCK_GUARDRAIL_ID and BEDROCK_GUARDRAIL_VERSION
// - extended thinking (optional) for heavy tasks: set BEDROCK_THINKING_BUDGET (tokens, e.g. 4000)
async function callBedrock(tier, system, text, opts = {}) {
  bedrockClient = bedrockClient || new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const modelId = MODELS.bedrock[tier];
  const content = [{ text }];
  for (const d of opts.documents || []) {
    content.unshift({ document: { format: d.format, name: d.name.replace(/[^A-Za-z0-9 ()[\]-]/g, ' ').slice(0, 60) || 'document', source: { bytes: d.bytes } } });
  }
  const thinking = tier === 'heavy' && +process.env.BEDROCK_THINKING_BUDGET > 0;
  const params = {
    modelId,
    system: [{ text: system }, ...(process.env.BEDROCK_PROMPT_CACHE === 'false' ? [] : [{ cachePoint: { type: 'default' } }])],
    messages: [{ role: 'user', content }],
    inferenceConfig: { maxTokens: thinking ? 4000 + +process.env.BEDROCK_THINKING_BUDGET : 4000 }
  };
  if (thinking) params.additionalModelRequestFields = { thinking: { type: 'enabled', budget_tokens: +process.env.BEDROCK_THINKING_BUDGET } };
  if (process.env.BEDROCK_GUARDRAIL_ID) params.guardrailConfig = { guardrailIdentifier: process.env.BEDROCK_GUARDRAIL_ID, guardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION || 'DRAFT' };
  const r = await bedrockClient.send(new ConverseCommand(params));
  if (r.stopReason === 'guardrail_intervened') throw Object.assign(new Error('Blocked by the AWS Guardrail (possible patient data or unsafe content).'), { status: 422, noFailover: true });
  return { text: (r.output?.message?.content || []).map((c) => c.text || '').join(''), model: `bedrock:${modelId}`, usage: r.usage };
}

async function callAnthropic(tier, system, text, opts = {}) {
  const model = MODELS.anthropic[tier];
  const docs = (opts.documents || []).map((d) => d.format === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(d.bytes).toString('base64') } }
    : { type: 'document', source: { type: 'text', media_type: 'text/plain', data: Buffer.from(d.bytes).toString('utf8') } });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4000, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: docs.length ? [...docs, { type: 'text', text }] : text }] }),
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

const CALLERS = { bedrock: callBedrock, vertex: runOnVertex, anthropic: callAnthropic, openai: callOpenAI, 'vertex-openai': runGptOssOnVertex };

export function aiConfigured() {
  return ORDER.some((p) => PROVIDERS[p].ready());
}

export function aiStatus() {
  return ORDER.map((p) => ({ id: p, label: PROVIDERS[p].label, ready: PROVIDERS[p].ready(), baa: PROVIDERS[p].baa }));
}

// Runs a prompt through the first working provider. Returns text, model used, PHI findings, and any failovers.
export async function complete(tier, system, userText, { preferred, documents } = {}) {
  const guard = scrubPHI(userText);
  const order = preferred && PROVIDERS[preferred] ? [preferred, ...ORDER.filter((p) => p !== preferred)] : ORDER;
  const ready = order.filter((p) => PROVIDERS[p].ready() && (!documents?.length || ['bedrock', 'anthropic'].includes(p)));
  if (!ready.length) {
    throw Object.assign(new Error('No AI provider is connected. Add AWS, Google Vertex, Anthropic, or OpenAI keys in your hosting settings.'), { status: 503 });
  }
  const failovers = [];
  for (const p of ready) {
    try {
      const out = await CALLERS[p](tier, system, guard.clean, { documents });
      return { ...out, provider: p, phi: { redactions: guard.redactions, types: guard.findings }, failovers };
    } catch (e) {
      if (e.noFailover) throw e;
      console.error(`AI provider ${p} failed: ${e.message}`);
      failovers.push({ provider: p, error: e.message });
    }
  }
  throw Object.assign(new Error(`All AI providers failed: ${failovers.map((f) => `${f.provider} (${f.error})`).join('; ')}`), { status: 502 });
}
