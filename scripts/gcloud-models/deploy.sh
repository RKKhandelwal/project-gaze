#!/bin/bash
# deploy.sh — Build, push, and deploy YOLO26x to Vertex AI with GPU
#
# Prerequisites:
#   1. gcloud CLI installed + authenticated: gcloud auth login
#   2. A GCP project with billing enabled
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh

set -euo pipefail

# ─── CONFIGURE THESE ─────────────────────────────────────────────────────────
PROJECT_ID="silicon-works-497302-a2"        # gcloud config get-value project
REGION="us-central1"                      # pick a region with GPU quota
REPO_NAME="yolo-models"                   # Artifact Registry repo name
IMAGE_NAME="yolo26x-pickleball"
IMAGE_TAG="v1"
ENDPOINT_NAME="yolo26x-pickleball"
MODEL_NAME="yolo26x-pickleball"
# ─────────────────────────────────────────────────────────────────────────────

FULL_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${IMAGE_NAME}:${IMAGE_TAG}"

echo "=== Step 1: Enable required APIs ==="
gcloud services enable \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  --project="${PROJECT_ID}"

echo "=== Step 2: Create Artifact Registry repo (if needed) ==="
gcloud artifacts repositories create "${REPO_NAME}" \
  --repository-format=docker \
  --location="${REGION}" \
  --project="${PROJECT_ID}" \
  2>/dev/null || echo "  (repo already exists)"

echo "=== Step 3: Build + push via Cloud Build (no local Docker needed) ==="
gcloud builds submit \
  --tag "${FULL_IMAGE}" \
  --project="${PROJECT_ID}" \
  --timeout=1800

echo "=== Step 4: Import model into Vertex AI ==="
# Upload the container as a Vertex AI Model
gcloud ai models upload \
  --region="${REGION}" \
  --display-name="${MODEL_NAME}" \
  --container-image-uri="${FULL_IMAGE}" \
  --container-health-route="/health" \
  --container-predict-route="/predict" \
  --container-ports=8080 \
  --project="${PROJECT_ID}"

echo ""
echo "=== Step 5: Create endpoint ==="
gcloud ai endpoints create \
  --region="${REGION}" \
  --display-name="${ENDPOINT_NAME}" \
  --project="${PROJECT_ID}"

echo ""
echo "============================================================"
echo "  Model uploaded and endpoint created!"
echo ""
echo "  Next steps (in GCP Console → Vertex AI → Endpoints):"
echo ""
echo "  1. Click your endpoint: ${ENDPOINT_NAME}"
echo "  2. Click 'Deploy Model to Endpoint'"
echo "  3. Select model: ${MODEL_NAME}"
echo "  4. Machine type: n1-standard-4 (or n1-standard-8)"
echo "  5. Accelerator: NVIDIA T4 (1 GPU)  ← THIS IS THE KEY PART"
echo "     - T4 is cheapest (~\$0.35/hr) and runs TensorRT great"
echo "     - L4 (~\$0.70/hr) is 2x faster if you need more speed"
echo "  6. Min replicas: 1, Max replicas: 1"
echo "  7. Click Deploy"
echo ""
echo "  Deployment takes ~10-30 min. You'll get an email when ready."
echo "============================================================"
