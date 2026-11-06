# FUTURE4000 Platform

AI-powered healthcare compliance operating system by LaFortune Business Management.

## Features

| Area | What it does |
|---|---|
| **Accounts and roles** | Organization sign-up, secure passwords (scrypt), signed session cookies, login rate limiting. Roles: admin, compliance officer, clinician reviewer, staff. |
| **Organization setup** | Organization type, state, services, beds, accreditor, then federal and accreditation requirements auto-mapped (HIPAA, CMS CoPs, EMTALA, OSHA, CLIA, DEA, 42 CFR Part 2, EVV, ADA/504, ACA 1557, FERPA, Joint Commission, ACGME). |
| **Compliance map** | Live score: requirements covered by an approved policy. |
| **Policies** | AI-drafted or manual. Version history, send for review, clinician approval (authors cannot approve their own work), changes requested, annual review date, staff read-and-sign tracking, encrypted archive of every approved version to AWS S3 or Supabase Storage. PHI in policy text is blocked. |
| **F4 Intelligence (AI)** | 8 agents. Router tries Claude on AWS Bedrock, then Claude on Google Vertex AI, then the Anthropic API, then ChatGPT, with automatic failover. Patient identifiers are masked first. Every run is audit-logged. |
| **F4 Connect** | 23 connectors across Healthcare, Cloud & AI, Business, and Media, each with its FUTURE4000 brand name, the weaknesses it fixes, and a live connection test where one exists. |
| **F4 Daily Scan** | Every day at 8:30 AM Eastern: new CMS, HHS, OSHA, DEA, SAMHSA, and FDA rules and notices from the Federal Register; policies due for review; reviews waiting 7+ days; missing staff sign-offs; integration health; Slack summary. |
| **Audit log** | Every sign-in, failed sign-in, policy action, AI run, scan, and billing event. CSV export for surveyors. |
| **F4 Pay** | Monthly subscriptions through embedded Stripe Checkout, plan activation by signed webhook, Stripe billing portal. |

## Deploy on AWS

`infra/aws.yaml` creates the full HIPAA-eligible stack: ECS Fargate app, encrypted RDS PostgreSQL, private encrypted S3 document archive, ECR, CodeBuild, Secrets Manager, CloudWatch Logs, and the 8:30 AM Eastern daily scan (EventBridge Scheduler, daylight saving handled).

1. Sign the AWS BAA in AWS Artifact and enable Claude in Amazon Bedrock (Model catalog, submit use case details).
2. Create the stack from `infra/aws.yaml` with your VPC and two subnets (DesiredCount 0).
3. Run the `future4000-build` CodeBuild project, then update the stack with DesiredCount 1.
4. Add Stripe and Slack values to the `future4000/app` secret in Secrets Manager.
5. In Stripe, add the webhook `https://YOUR-DOMAIN/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.

## Run locally

```
npm install
DATABASE_URL=postgres://user@localhost:5432/future4000 SESSION_SECRET=dev npm start
```

## Safety rules

- No real patient data until the AWS BAA (and any other provider's BAA) is signed and hosting is HIPAA-enabled.
- ChatGPT and Replit have no BAA by default; keep them out of PHI workflows.
- Stripe is for organization billing only.
- AI output must be approved by a qualified clinician before it becomes official policy.
- Prices in `src/plans.js` are placeholders.
