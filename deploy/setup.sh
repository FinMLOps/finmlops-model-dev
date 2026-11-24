#!/usr/bin/env bash
# One-time setup of a Google Cloud project for deploy/deploy.sh and the deploy workflow. Safe to run again.
#   GCP_PROJECT=my-project MODEL_BUCKET=my-bucket DVC_BUCKET=finmlops-pipeline-dvc deploy/setup.sh
# It enables the APIs, creates the Artifact Registry repository for the images, and gives a service account exactly
# the roles deploying needs. SERVICE_ACCOUNT reuses an existing one (e.g. the account behind the GCP_SA_KEY secret
# the train workflow already uses); otherwise "finmlops-deployer" is created. Granting access to a bucket in someone
# else's project needs that project's owner to run the bucket lines (or to give you access to do it).
set -euo pipefail

: "${GCP_PROJECT:?set GCP_PROJECT}"
: "${MODEL_BUCKET:?set MODEL_BUCKET, the bucket the champion and registry.json are pushed to}"
REGION="${GCP_REGION:-us-east1}"
REPO="${AR_REPO:-finmlops}"
SA="${SERVICE_ACCOUNT:-finmlops-deployer@$GCP_PROJECT.iam.gserviceaccount.com}"

echo "==> APIs: Cloud Run, Artifact Registry, Cloud Monitoring"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com monitoring.googleapis.com \
  --project "$GCP_PROJECT"

echo "==> Artifact Registry repository $REPO ($REGION)"
gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$GCP_PROJECT" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" \
       --project "$GCP_PROJECT" --description "FinMLOps API and web images"

echo "==> service account $SA"
if ! gcloud iam service-accounts describe "$SA" --project "$GCP_PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA%%@*}" --project "$GCP_PROJECT" --display-name "FinMLOps deployer"
fi
# deploy Cloud Run services, push images, act as the runtime account, create the uptime check
for role in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser roles/monitoring.editor; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT" --member "serviceAccount:$SA" --role "$role" \
    --condition None --quiet >/dev/null
done

echo "==> read access to the model registry and the news snapshot"
gcloud storage buckets add-iam-policy-binding "gs://${MODEL_BUCKET#gs://}" --member "serviceAccount:$SA" \
  --role roles/storage.objectViewer >/dev/null
if [ -n "${DVC_BUCKET:-}" ]; then
  gcloud storage buckets add-iam-policy-binding "gs://${DVC_BUCKET#gs://}" --member "serviceAccount:$SA" \
    --role roles/storage.objectViewer >/dev/null
fi

cat <<EOF

Done. To deploy from GitHub Actions, add to the repo (Settings -> Secrets and variables -> Actions):
  secret    GCP_SA_KEY    a JSON key of $SA
                          (gcloud iam service-accounts keys create key.json --iam-account $SA; never commit it)
  variable  GCP_PROJECT   $GCP_PROJECT
  variable  GCP_REGION    $REGION
  variable  MODEL_BUCKET  ${MODEL_BUCKET#gs://}
To deploy from this machine instead: GCP_PROJECT=$GCP_PROJECT MODEL_BUCKET=${MODEL_BUCKET#gs://} deploy/deploy.sh
EOF
