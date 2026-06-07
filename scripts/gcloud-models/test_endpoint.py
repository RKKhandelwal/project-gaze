import argparse, base64, json, time, subprocess

def get_token():
    return subprocess.check_output(
        ["gcloud", "auth", "print-access-token"]
    ).decode().strip()

def test(project, region, endpoint_id, image_path):
    import urllib.request

    with open(image_path, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode("utf-8")

    url = (
        f"https://{region}-aiplatform.googleapis.com/v1/"
        f"projects/{project}/locations/{region}/"
        f"endpoints/{endpoint_id}:predict"
    )
    body = json.dumps({
        "instances": [{"image": image_b64}],
        "parameters": {"confidence": 0.3}
    }).encode()

    req = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Bearer {get_token()}",
        "Content-Type": "application/json",
    })

    print(f"Sending {image_path}...")
    start = time.time()
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    elapsed = time.time() - start

    print(f"\nResponse in {elapsed:.2f}s:")
    for pred in data["predictions"]:
        print(f"  {pred['detection_count']} people detected")
        for d in pred["detections"]:
            print(f"    person conf={d['confidence']:.2f} @ ({d['cx']:.0f},{d['cy']:.0f})")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--region", default="us-central1")
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--image", required=True)
    args = parser.parse_args()
    test(args.project, args.region, args.endpoint, args.image)
