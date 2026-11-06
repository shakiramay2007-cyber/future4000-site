# FUTURE4000 Platform

AI-powered healthcare compliance operating system by LaFortune Business Management.

## What is in this app

- **AI Agents** (Claude on AWS Bedrock): DocuTrack Policy Writer, Regulation Mapper, LearnTrack Training Builder, Survey and Audit Prep, Claim Denial Explainer, EVV Compliance Checker, HL7/FHIR Interface Analyst, HR Credentialing Agent. Every request passes through a PHI guard that masks identifiers first.
- **Integrations Marketplace**: HL7/FHIR, Epic, Oracle Health, athenahealth, Surescripts, EVV systems, clearinghouses, Stripe, QuickBooks, Microsoft 365, Google Workspace, Slack, Zoom, DocuSign/Jotform Sign. A connector shows "Connected" only after a real live test passes.
- **Plans and Payment**: Stripe Payment Element embedded in the app, with a signed webhook endpoint.

## Deploy on Render

1. New > Web Service > connect this GitHub repo.
2. Runtime: Node. Build command: `npm install`. Start command: `npm start`. Region: Virginia.
3. Add environment variables from `.env.example` (at minimum the AWS and Stripe keys).
4. In Stripe > Developers > Webhooks, add `https://YOUR-APP.onrender.com/api/stripe/webhook` with events `payment_intent.succeeded` and `payment_intent.payment_failed`, then copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

## Run locally

```
npm install
npm start
```

Then open http://localhost:3000.

## Safety rules

- Do not send real patient data until the AWS BAA is signed and the hosting environment is HIPAA-enabled.
- Stripe is for organization billing only. Never put patient information in Stripe.
- AI output must be reviewed and approved by a qualified clinician before it becomes official policy.
- Prices in `src/plans.js` are placeholders.
