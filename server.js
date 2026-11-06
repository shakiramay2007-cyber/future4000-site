import express from 'express';
import Stripe from 'stripe';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, runAgent, aiConfigured } from './src/agents.js';
import { listIntegrations, testIntegration } from './src/integrations.js';
import { PLANS } from './src/plans.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Stripe webhook needs the raw body, so it is registered before express.json().
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Stripe webhook not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature check failed: ${err.message}`);
  }
  switch (event.type) {
    case 'payment_intent.succeeded':
      // TODO: activate the organization's plan in the database.
      console.log('Payment succeeded:', event.data.object.id, event.data.object.metadata);
      break;
    case 'payment_intent.payment_failed':
      console.log('Payment failed:', event.data.object.id);
      break;
    default:
      console.log('Stripe event:', event.type);
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/api/status', (_req, res) => res.json({
  ai: aiConfigured(),
  stripe: Boolean(stripe && process.env.STRIPE_PUBLISHABLE_KEY),
  stripeMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'live' : (process.env.STRIPE_SECRET_KEY ? 'test' : 'off')
}));

// Agents
app.get('/api/agents', (_req, res) => res.json(AGENTS.map(({ prompt, ...a }) => a)));
app.post('/api/agents/:id/run', async (req, res) => {
  try {
    res.json(await runAgent(req.params.id, req.body?.input));
  } catch (e) {
    console.error('Agent error:', e.message);
    res.status(e.status || 500).json({ error: e.message, phi: e.phi });
  }
});

// Integrations
app.get('/api/integrations', (_req, res) => res.json(listIntegrations()));
app.post('/api/integrations/:id/test', async (req, res) => {
  try {
    res.json(await testIntegration(req.params.id));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Payments (Stripe Payment Element)
app.get('/api/plans', (_req, res) => res.json(PLANS));
app.get('/api/stripe/config', (_req, res) => {
  if (!process.env.STRIPE_PUBLISHABLE_KEY) return res.status(503).json({ error: 'Stripe is not connected yet.' });
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});
app.post('/api/stripe/payment-intent', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not connected yet. Add STRIPE_SECRET_KEY in Render.' });
  const plan = PLANS[req.body?.plan];
  if (!plan) return res.status(400).json({ error: 'Choose a valid plan.' });
  const organization = String(req.body?.organization || '').slice(0, 120);
  const email = String(req.body?.email || '').slice(0, 200);
  try {
    const intent = await stripe.paymentIntents.create({
      amount: plan.amount,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      receipt_email: email || undefined,
      description: `FUTURE4000 ${plan.name} plan`,
      // Organization billing details only. Never put patient information in Stripe.
      metadata: { plan: req.body.plan, organization }
    });
    res.json({ clientSecret: intent.client_secret, amount: plan.amount, plan: plan.name });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`FUTURE4000 platform running on port ${port}`));
