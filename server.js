import express from 'express';
import Stripe from 'stripe';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS } from './src/agents.js';
import { aiConfigured, aiStatus } from './src/ai.js';
import { migrate, dbConfigured } from './src/db.js';
import { loadUser } from './src/auth.js';
import { router, handleStripeEvent } from './src/routes.js';
import { storageProvider } from './src/cloud.js';
import { learnRouter } from './src/learn.js';
import { govRouter } from './src/governance.js';
import { resumeJobs } from './src/jobs.js';
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
  handleStripeEvent(event)
    .then(() => res.json({ received: true }))
    .catch((e) => { console.error('Stripe event handling failed:', e.message); res.status(500).send('Handler error'); });
});

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '20mb' }));
app.use(loadUser);
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));
const CLOUD_PAGES = new Set(['workers', 'sandboxes', 'agents', 'code-studio', 'templates']);
app.get('/cloud', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'cloud', 'index.html')));
app.get('/cloud/:page', (req, res, next) => CLOUD_PAGES.has(req.params.page) ? res.sendFile(path.join(__dirname, 'public', 'cloud', `${req.params.page}.html`)) : next());
app.get('/changelog', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'changelog.html')));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/api/status', (_req, res) => res.json({
  ai: aiConfigured(),
  aiProviders: aiStatus(),
  database: dbConfigured(),
  storage: storageProvider(),
  stripe: Boolean(stripe && process.env.STRIPE_PUBLISHABLE_KEY),
  stripeMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'live' : (process.env.STRIPE_SECRET_KEY ? 'test' : 'off')
}));

app.use('/api', router);
app.use('/api/learn', learnRouter);
app.use('/api/governance', govRouter);

// Agents
app.get('/api/agents', (_req, res) => res.json(AGENTS.map(({ prompt, ...a }) => a)));
// Agent runs require sign-in (see /api/org/agents/:id/run) so every AI use is governed and audit-logged.

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
  if (!stripe) return res.status(503).json({ error: 'Stripe is not connected yet. Add STRIPE_SECRET_KEY to your environment.' });
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
migrate()
  .then(() => dbConfigured() && resumeJobs())
  .catch((e) => console.error('Database setup failed:', e.message))
  .finally(() => app.listen(port, () => console.log(`FUTURE4000 platform running on port ${port}`)));
