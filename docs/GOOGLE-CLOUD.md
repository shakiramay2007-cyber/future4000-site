# FUTURE4000 on Google Cloud: a plain-language guide

This guide explains each Google Cloud piece FUTURE4000 uses, in Google's own terms with a plain definition,
and points to the Google Cloud certification topic it belongs to. Written in our own words; check Google's
current documentation before production use.

## The pieces

| Google term | Plain meaning | What FUTURE4000 uses it for | Certification topic |
|---|---|---|---|
| Project and Project ID | A labeled box that holds everything; the ID is its permanent computer name | Every resource lives in one project | Cloud Digital Leader: resource hierarchy |
| Billing account | Who pays | Required before anything runs | Cloud Digital Leader: cost management |
| Cloud Run | Runs your app in containers and scales to zero when nobody uses it | The website and the app at /app | Associate Cloud Engineer: deploying applications |
| Cloud Run Job | A container that runs to completion and stops | The daily compliance scan | Associate Cloud Engineer: serverless jobs |
| Cloud Scheduler | A calendar alarm for computers | Starts the scan at 8:30 AM Eastern every day | Associate Cloud Engineer: operations |
| Cloud SQL for PostgreSQL | A managed database: Google patches, backs up and repairs it | All policies, training, audit logs, payments | Associate Cloud Engineer: storage and databases |
| Point-in-time recovery | Rewind the database to any minute in the backup window | Undo mistakes or recover from damage | Professional Cloud Architect: reliability |
| Secret Manager | A locked safe for passwords and keys | Database password, session secret, encryption key, processor keys | Professional Cloud Security Engineer: secrets |
| Service account | A robot user with its own permissions | The app signs in as it, so no key files are needed | Professional Cloud Security Engineer: identity |
| IAM role | A named set of permissions | Least privilege: SQL client, secret reader, Vertex AI user, run invoker | All exams: identity and access management |
| Artifact Registry | A warehouse for app images | Stores each built version of the app | Associate Cloud Engineer: CI/CD |
| Cloud Build | A build robot | Turns the code into an app image | Associate Cloud Engineer: CI/CD |
| Vertex AI and Model Garden | Google's AI platform and its catalog of models | Claude for policy drafting and agents (region: global) | Professional Machine Learning Engineer / Generative AI Leader |
| Business associate agreement (BAA) | The HIPAA contract with a vendor that handles patient data | Must be accepted before any patient data | Professional Cloud Security Engineer: compliance |

## Run it

1. Open Google Cloud Shell in the right project and clone this repository.
2. Run: `PROJECT_ID=your-project-id bash infra/gcp/deploy.sh`
3. In Vertex AI → Model Garden, enable the Claude models (needs the Consumer Procurement Entitlement Manager role).
4. Sign in to the app, open 4000 Connect, press **Test connection** on Google Vertex AI.

The script creates billable resources. Cloud Run scales to zero when idle; Cloud SQL runs all the time and is
the main monthly cost. Use the Google Cloud pricing calculator for current prices.

## Shared responsibility

Google secures the data centers and services. FUTURE4000 must configure them correctly: least-privilege
roles, secrets in Secret Manager, no patient data in logs, backups tested, and the BAA accepted.
