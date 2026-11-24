#!/usr/bin/env bash
# Deploys FinMLOps to Google Cloud Run, start to finish (the deploy workflow runs this same script):
#   1. bundle the champion from the model registry and score the news with it (deploy/bundle.sh)
#   2. build the API and web images and push them to Artifact Registry
#   3. deploy the API, then the web app pointed at it
#   4. smoke-test both live services, and make sure an uptime check watches the API
# One-time project setup first: deploy/setup.sh. Step-by-step guide: DEPLOY.md.
#   GCP_PROJECT=my-project MODEL_BUCKET=my-bucket deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${GCP_PROJECT:?set GCP_PROJECT, the Google Cloud project to deploy to}"
REGION="${GCP_REGION:-us-east1}"
REPO="${AR_REPO:-finmlops}"
API="${API_SERVICE:-finmlops-api}"
WEB="${WEB_SERVICE:-finmlops-web}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"
IMAGES="$REGION-docker.pkg.dev/$GCP_PROJECT/$REPO"
WHERE=(--region "$REGION" --project "$GCP_PROJECT")

deploy/bundle.sh

echo "==> building and pushing the images (tag $TAG)"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet
docker build -f Dockerfile.api -t "$IMAGES/api:$TAG" .
docker build -t "$IMAGES/web:$TAG" web
docker push "$IMAGES/api:$TAG"
docker push "$IMAGES/web:$TAG"

echo "==> deploying the API ($API)"
# 2 GiB holds FinBERT on CPU, startup CPU boost loads it faster; MIN_INSTANCES=1 removes cold starts but costs more
gcloud run deploy "$API" --image "$IMAGES/api:$TAG" "${WHERE[@]}" --allow-unauthenticated --quiet \
  --port 8080 --memory 2Gi --cpu 2 --cpu-boost --concurrency 8 --timeout 120 \
  --min-instances "${MIN_INSTANCES:-0}" --max-instances 3 --labels "app=finmlops,commit=$TAG"
API_URL=$(gcloud run services describe "$API" "${WHERE[@]}" --format 'value(status.url)')

echo "==> deploying the web app ($WEB), pointed at $API_URL"
gcloud run deploy "$WEB" --image "$IMAGES/web:$TAG" "${WHERE[@]}" --allow-unauthenticated --quiet \
  --port 8080 --memory 512Mi --cpu 1 --max-instances 3 --set-env-vars "API_URL=$API_URL" \
  --labels "app=finmlops,commit=$TAG"
WEB_URL=$(gcloud run services describe "$WEB" "${WHERE[@]}" --format 'value(status.url)')

echo "==> smoke test"
uv run python -m scripts.deploy check "$API_URL" "$WEB_URL"

echo "==> uptime check on $API_URL/api/health (Cloud Monitoring)"
CHECK="$API-health"
if [ -z "$(gcloud monitoring uptime list-configs --project "$GCP_PROJECT" --filter "displayName=$CHECK" --format 'value(name)' 2>/dev/null)" ]; then
  gcloud monitoring uptime create "$CHECK" --project "$GCP_PROJECT" --resource-type uptime-url \
    --resource-labels "host=${API_URL#https://},project_id=$GCP_PROJECT" --protocol https --path /api/health --period 5 \
    || echo "warning: couldn't create the uptime check; add it in the console (DEPLOY.md, Monitoring)"
fi

echo "deployed: site $WEB_URL  ·  API $API_URL"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "api_url=$API_URL"; echo "web_url=$WEB_URL"; } >> "$GITHUB_OUTPUT"
fi
