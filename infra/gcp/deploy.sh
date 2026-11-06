#!/usr/bin/env bash
# FUTURE4000 on Google Cloud: Cloud Run (app) + Cloud SQL Postgres (database) + Secret Manager (keys)
# + Cloud Run Job and Cloud Scheduler (daily 8:30 AM Eastern scan) + Vertex AI (Claude).
#
# Run from the repository root in Google Cloud Shell:   PROJECT_ID=my-project bash infra/gcp/deploy.sh
# Safe to run again: steps that already exist are skipped. This CREATES BILLABLE RESOURCES (mainly Cloud SQL).
# Before any patient data: accept the Google Cloud business associate agreement for this account.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your Google Cloud project ID (the ID, not the display name)}"
REGION="${REGION:-us-east4}"                 # where the app and database run
VERTEX_REGION="${VERTEX_REGION:-global}"     # current Claude models on Vertex need global, us or eu
DB_VERSION="${DB_VERSION:-POSTGRES_17}"
DB_TIER="${DB_TIER:-db-custom-1-3840}"       # 1 vCPU, 3.75 GB: small starting size
APP=future4000
SA="${APP}-app@${PROJECT_ID}.iam.gserviceaccount.com"
INSTANCE="${APP}-db"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${APP}/app:$(date +%Y%m%d-%H%M%S)"

gcloud config set project "$PROJECT_ID" >/dev/null
echo "1/8 Turning on the Google services FUTURE4000 uses"
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com aiplatform.googleapis.com

echo "2/8 Creating the app's robot user (service account) with only the roles it needs"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "${APP}-app" --display-name="FUTURE4000 app"
for role in roles/cloudsql.client roles/secretmanager.secretAccessor roles/aiplatform.user roles/run.invoker; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role="$role" --condition=None >/dev/null
done

echo "3/8 Creating secrets (random values generated here, never shown)"
make_secret() { gcloud secrets describe "$1" >/dev/null 2>&1 || printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic >/dev/null; }
make_secret "${APP}-session-secret" "$(openssl rand -hex 32)"
make_secret "${APP}-secrets-key"    "$(openssl rand -hex 32)"   # F4_SECRETS_KEY: encrypts clients' payment keys
make_secret "${APP}-db-password"    "$(openssl rand -hex 24)"

echo "4/8 Creating the Cloud SQL Postgres database (takes several minutes the first time)"
if ! gcloud sql instances describe "$INSTANCE" >/dev/null 2>&1; then
  gcloud sql instances create "$INSTANCE" --database-version="$DB_VERSION" --edition=ENTERPRISE --tier="$DB_TIER" \
    --region="$REGION" --storage-auto-increase --backup-start-time=07:00 --enable-point-in-time-recovery \
    --deletion-protection   # Cloud Run reaches it through Google's encrypted Cloud SQL connector
  gcloud sql databases create "$APP" --instance="$INSTANCE"
  gcloud sql users create "$APP" --instance="$INSTANCE" --password="$(gcloud secrets versions access latest --secret=${APP}-db-password)"
fi
CONN="$(gcloud sql instances describe "$INSTANCE" --format='value(connectionName)')"

echo "5/8 Building the app image with Cloud Build"
gcloud artifacts repositories describe "$APP" --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$APP" --repository-format=docker --location="$REGION"
gcloud builds submit --tag "$IMAGE" .

# "^@^" tells gcloud to split settings on @ instead of commas (AI_PROVIDER_ORDER contains commas).
ENV="^@^PGHOST=/cloudsql/${CONN}@PGUSER=${APP}@PGDATABASE=${APP}@GOOGLE_CLOUD_PROJECT=${PROJECT_ID}@GOOGLE_CLOUD_REGION=${VERTEX_REGION}@AI_PROVIDER_ORDER=vertex,anthropic,openai@NODE_ENV=production"
SECRETS="PGPASSWORD=${APP}-db-password:latest,SESSION_SECRET=${APP}-session-secret:latest,F4_SECRETS_KEY=${APP}-secrets-key:latest"

echo "6/8 Deploying the app to Cloud Run (scales to zero when idle)"
gcloud run deploy "$APP" --image="$IMAGE" --region="$REGION" --service-account="$SA" \
  --add-cloudsql-instances="$CONN" --set-env-vars="$ENV" --set-secrets="$SECRETS" \
  --allow-unauthenticated --min-instances=0 --max-instances=4 --cpu=1 --memory=1Gi --port=3000

echo "7/8 Creating the daily scan job"
gcloud run jobs deploy "${APP}-daily-scan" --image="$IMAGE" --region="$REGION" --service-account="$SA" \
  --set-cloudsql-instances="$CONN" --set-env-vars="$ENV" --set-secrets="$SECRETS" \
  --command=node --args=scripts/daily-scan.js --max-retries=1 --task-timeout=15m

echo "8/8 Scheduling it every day at 8:30 AM Eastern"
JOB_URI="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${APP}-daily-scan:run"
if gcloud scheduler jobs describe "${APP}-daily-scan" --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${APP}-daily-scan" --location="$REGION" --schedule="30 8 * * *" --time-zone="America/New_York" \
    --uri="$JOB_URI" --http-method=POST --oauth-service-account-email="$SA"
else
  gcloud scheduler jobs create http "${APP}-daily-scan" --location="$REGION" --schedule="30 8 * * *" --time-zone="America/New_York" \
    --uri="$JOB_URI" --http-method=POST --oauth-service-account-email="$SA"
fi

URL="$(gcloud run services describe "$APP" --region="$REGION" --format='value(status.url)')"
echo
echo "Done. FUTURE4000 is running at: $URL"
echo "Next: enable Claude in Vertex AI Model Garden, then open 4000 Connect and press Test connection on Google Vertex AI."
echo "Add Stripe or other keys with:  printf 'value' | gcloud secrets create NAME --data-file=-   then redeploy with --update-secrets."
