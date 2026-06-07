#!/bin/bash
# run_on_gce.sh — Create a cheap GCE VM, copy the pipeline, run it.
#
# Usage:
#   chmod +x run_on_gce.sh
#   ./run_on_gce.sh

set -euo pipefail

PROJECT="silicon-works-497302-a2"
ZONE="us-central1-a"
VM_NAME="pipeline-runner"
MACHINE_TYPE="e2-standard-2"  # 2 vCPUs, 8GB RAM, ~$0.07/hr

echo "=== Creating VM ==="
gcloud compute instances create "$VM_NAME" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --project="$PROJECT" \
  --scopes=cloud-platform \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=20GB \
  2>/dev/null || echo "  (VM already exists)"

echo "=== Waiting for VM to be ready ==="
sleep 10

echo "=== Installing dependencies ==="
gcloud compute ssh "$VM_NAME" --zone="$ZONE" --project="$PROJECT" --command="
  sudo apt-get update -qq
  sudo apt-get install -y -qq python3-pip ffmpeg python3-venv
  python3 -m venv ~/env
  ~/env/bin/pip install boto3 opencv-python-headless numpy aiohttp
"

echo "=== Copying pipeline ==="
gcloud compute scp pipeline_async.py "$VM_NAME":~/pipeline_async.py \
  --zone="$ZONE" --project="$PROJECT"

echo "=== Starting pipeline ==="
echo "SSH into the VM and run:"
echo ""
echo "  gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT"
echo ""
echo "  export R2_ACCESS_KEY=your_key"
echo "  export R2_SECRET_KEY=your_secret"
echo "  export R2_ENDPOINT=your_endpoint"
echo "  ~/env/bin/python3 ~/pipeline_async.py"
echo ""
echo "When done, delete the VM:"
echo "  gcloud compute instances delete $VM_NAME --zone=$ZONE --project=$PROJECT"
