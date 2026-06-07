"""
pipeline_async.py — Async pickleball detection pipeline.

Hits Vertex AI YOLO26x endpoint with concurrent requests.
No tracking — just per-frame detection + overlay rendering.
Designed to run from a GCE VM in the same region for low latency.

Setup (on GCE VM):
    sudo apt-get update && sudo apt-get install -y python3-pip ffmpeg
    pip3 install boto3 opencv-python-headless numpy aiohttp tqdm

    export R2_ACCESS_KEY=xxx
    export R2_SECRET_KEY=xxx
    export R2_ENDPOINT=xxx

    python3 pipeline_async.py
"""

import asyncio
import base64
import datetime as dt
import json
import os
import re
import subprocess
import time
from collections import defaultdict
from pathlib import Path

import aiohttp
import boto3
import cv2
import numpy as np
from botocore.config import Config
from tqdm import tqdm

# ─── CONFIG ──────────────────────────────────────────────────────────────────
BUCKET = "mckenna-pickleball-feed-may-17"
UPLOADS_PREFIX = "uploads/"
ANNOTATIONS_PREFIX = "annotations/"
OVERLAYS_PREFIX = "overlays/"
FRAMES_PREFIX = "frames/"

# Vertex AI endpoint
GCP_PROJECT = "silicon-works-497302-a2"
GCP_REGION = "us-central1"
VERTEX_ENDPOINT_ID = "9124618850250260480"
VERTEX_URL = (
    f"https://{GCP_REGION}-aiplatform.googleapis.com/v1/"
    f"projects/{GCP_PROJECT}/locations/{GCP_REGION}/"
    f"endpoints/{VERTEX_ENDPOINT_ID}:predict"
)

# Concurrency — how many frames to send in parallel
CONCURRENT_REQUESTS = 10
CONFIDENCE = 0.25
JPEG_QUALITY = 85

# Court polygon + crop (same as your Colab notebook)
POLY_FULL = np.array(
    [
        (567, 389),
        (546, 12),
        (1007, 40),
        (1310, 147),
        (1341, 193),
    ],
    np.int32,
)

PAD = 8
CROP_X = max(0, int(POLY_FULL[:, 0].min()) - PAD)
CROP_Y = max(0, int(POLY_FULL[:, 1].min()) - PAD)
CROP_X2 = int(POLY_FULL[:, 0].max()) + PAD
CROP_Y2 = int(POLY_FULL[:, 1].max()) + PAD
CROP_W = CROP_X2 - CROP_X
CROP_H = CROP_Y2 - CROP_Y

POLY_CROP = POLY_FULL - np.array([CROP_X, CROP_Y])
PLAY_MASK = np.zeros((CROP_H, CROP_W), dtype=np.uint8)
cv2.fillPoly(PLAY_MASK, [POLY_CROP], 255)

PACIFIC_OFFSET_HOURS = 7
_TS_RE = re.compile(r"_(\d{14})\.mp4$", re.IGNORECASE)


# ─── R2 CLIENT ───────────────────────────────────────────────────────────────
s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["R2_ENDPOINT"],
    region_name="auto",
    config=Config(s3={"addressing_style": "virtual"}, signature_version="s3v4"),
)


# ─── AUTH ────────────────────────────────────────────────────────────────────
def get_gcp_token():
    """Get GCP access token via metadata server (on GCE) or gcloud CLI."""
    # Try metadata server first (works on GCE VMs)
    try:
        import urllib.request

        req = urllib.request.Request(
            "http://metadata.google.internal/computeMetadata/v1/"
            "instance/service-accounts/default/token",
            headers={"Metadata-Flavor": "Google"},
        )
        resp = urllib.request.urlopen(req, timeout=2)
        return json.loads(resp.read())["access_token"]
    except Exception:
        pass

    # Fall back to gcloud CLI (works locally)
    return (
        subprocess.check_output(["gcloud", "auth", "print-access-token"])
        .decode()
        .strip()
    )


# ─── TOKEN MANAGER ───────────────────────────────────────────────────────────
class TokenManager:
    """Auto-refreshes GCP auth token on 401 errors."""

    def __init__(self):
        self._token = None
        self._lock = asyncio.Lock()
        self._last_refresh = 0

    async def get(self) -> str:
        if self._token is None:
            await self.refresh()
        return self._token

    async def refresh(self):
        async with self._lock:
            # Don't refresh more than once per 10 seconds
            now = time.time()
            if now - self._last_refresh < 10:
                return
            self._token = get_gcp_token()
            self._last_refresh = now
            tqdm.write("  (refreshed auth token)")


token_mgr = TokenManager()


# ─── VERTEX AI ASYNC CLIENT (worker queue pattern) ──────────────────────────
async def detect_one_frame(
    session: aiohttp.ClientSession,
    frame: np.ndarray,
    max_retries: int = 3,
) -> list[dict]:
    """Send one frame to Vertex AI with retries + auto token refresh."""
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    b64 = base64.b64encode(buf.tobytes()).decode("utf-8")

    body = json.dumps(
        {
            "instances": [{"image": b64}],
            "parameters": {"confidence": CONFIDENCE},
        }
    )

    for attempt in range(max_retries):
        token = await token_mgr.get()
        try:
            async with session.post(
                VERTEX_URL,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                data=body,
            ) as resp:
                if resp.status == 401:
                    await token_mgr.refresh()
                    continue
                if resp.status == 429:
                    wait = int(resp.headers.get("Retry-After", 2**attempt))
                    await asyncio.sleep(wait)
                    continue
                if resp.status != 200:
                    err = await resp.text()
                    tqdm.write(f"    API error {resp.status}: {err[:100]}")
                    return []
                data = await resp.json()
                preds = data.get("predictions", [{}])
                return preds[0].get("detections", []) if preds else []
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            if attempt < max_retries - 1:
                await asyncio.sleep(1 * (attempt + 1))
                continue
            tqdm.write(f"    Request failed after {max_retries} retries: {e}")
            return []

    return []


async def detect_all_frames(
    session: aiohttp.ClientSession,
    frames: list[np.ndarray],
    num_workers: int,
) -> list[list[dict]]:
    """Worker queue: N workers pull frames from a queue, process one at a time."""
    results = [None] * len(frames)
    queue = asyncio.Queue()

    # Fill queue with (index, frame) pairs
    for i, frame in enumerate(frames):
        queue.put_nowait((i, frame))

    processed = 0
    t0 = time.time()

    async def worker():
        nonlocal processed
        while True:
            try:
                idx, frame = queue.get_nowait()
            except asyncio.QueueEmpty:
                return

            dets = await detect_one_frame(session, frame)
            results[idx] = dets

            processed += 1
            if processed == len(frames):
                elapsed = time.time() - t0
                fps_actual = processed / elapsed if elapsed > 0 else 0
                tqdm.write(
                    f"    {processed} frames in {elapsed:.1f}s ({fps_actual:.0f} fps)"
                )

            queue.task_done()

    # Start N workers — each pulls one job at a time
    workers = [asyncio.create_task(worker()) for _ in range(num_workers)]
    await asyncio.gather(*workers)

    return results


# ─── HELPERS ─────────────────────────────────────────────────────────────────
def segment_start_utc(filename):
    m = _TS_RE.search(filename)
    if not m:
        return None
    local = dt.datetime.strptime(m.group(1), "%Y%m%d%H%M%S")
    return local + dt.timedelta(hours=PACIFIC_OFFSET_HOURS)


def color_for_det(idx):
    """Color per detection index (no track IDs, so just cycle colors)."""
    hsv = np.uint8([[[(idx * 67) % 180, 220, 240]]])
    b, g, r = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0, 0]
    return int(b), int(g), int(r)


def list_keys(prefix):
    out = set()
    for page in s3.get_paginator("list_objects_v2").paginate(
        Bucket=BUCKET, Prefix=prefix
    ):
        for o in page.get("Contents", []):
            out.add(o["Key"])
    return out


# ─── PROCESS ONE VIDEO ──────────────────────────────────────────────────────
async def process_video(session, video_key):
    fid = Path(video_key).stem
    seg = segment_start_utc(Path(video_key).name)
    seg_iso = (seg.isoformat() + "Z") if seg else None

    src = f"/tmp/{fid}.mp4"
    out = f"/tmp/{fid}_overlay.mp4"

    # Download from R2
    tqdm.write(f"  Downloading...")
    with open(src, "wb") as f:
        s3.download_fileobj(BUCKET, video_key, f)

    # Read all frames
    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS) or 4.0
    all_frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        cropped = frame[CROP_Y : CROP_Y + CROP_H, CROP_X : CROP_X + CROP_W]
        all_frames.append(cropped)
    cap.release()
    os.unlink(src)

    if not all_frames:
        tqdm.write(f"  No frames, skipping")
        return 0

    # Detect all frames via Vertex AI (worker queue)
    tqdm.write(
        f"  Detecting {len(all_frames)} frames ({CONCURRENT_REQUESTS} workers)..."
    )
    t0 = time.time()

    all_detections = await detect_all_frames(
        session, all_frames, num_workers=CONCURRENT_REQUESTS
    )

    detect_time = time.time() - t0
    tqdm.write(
        f"  Detection done: {len(all_frames)} frames in {detect_time:.1f}s "
        f"({len(all_frames) / detect_time:.1f} fps)"
    )

    # Filter by play mask
    filtered_detections = []
    for dets in all_detections:
        frame_dets = []
        for d in dets:
            cx, cy = int(d.get("cx", 0)), int(d.get("cy", 0))
            if 0 <= cx < CROP_W and 0 <= cy < CROP_H and PLAY_MASK[cy, cx] > 0:
                frame_dets.append(d)
        filtered_detections.append(frame_dets)

    # Render overlay video
    tqdm.write(f"  Rendering overlay...")
    out_w = CROP_W + (CROP_W % 2)
    out_h = CROP_H + (CROP_H % 2)

    ff = subprocess.Popen(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-vcodec",
            "rawvideo",
            "-pix_fmt",
            "bgr24",
            "-s",
            f"{out_w}x{out_h}",
            "-r",
            str(fps),
            "-i",
            "-",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "26",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            out,
        ],
        stdin=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    for frame_idx, (cropped, dets) in enumerate(zip(all_frames, filtered_detections)):
        canvas = np.zeros((out_h, out_w, 3), dtype=np.uint8)
        canvas[:CROP_H, :CROP_W] = cropped

        for i, d in enumerate(dets):
            x1, y1 = int(d["x1"]), int(d["y1"])
            x2, y2 = int(d["x2"]), int(d["y2"])
            col = color_for_det(i)
            cv2.rectangle(canvas, (x1, y1), (x2, y2), col, 2)
            lbl = f"p{i} {d['confidence']:.0%}"
            (tw, th_), _ = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            cv2.rectangle(canvas, (x1, y1 - th_ - 6), (x1 + tw + 6, y1), col, -1)
            cv2.putText(
                canvas,
                lbl,
                (x1 + 3, y1 - 3),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                (255, 255, 255),
                1,
                cv2.LINE_AA,
            )

        # Frame counter
        cv2.putText(
            canvas,
            f"t={frame_idx / fps:5.1f}s  n={len(dets)}",
            (10, out_h - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (240, 240, 240),
            1,
            cv2.LINE_AA,
        )
        ff.stdin.write(canvas.tobytes())

    ff.stdin.close()
    if ff.wait() != 0:
        raise RuntimeError(ff.stderr.read().decode("utf-8", "replace"))

    # Build per-frame JSONL (same format as your Colab notebook)
    frame_records = []
    for fi, dets in enumerate(filtered_detections):
        frame_records.append(
            {
                "f": fi,
                "t": round(fi / fps, 3),
                "dets": [
                    [
                        round(d["cx"], 1),
                        round(d["cy"], 1),
                        round(d["w"], 1),
                        round(d["h"], 1),
                        round(d["confidence"], 3),
                    ]
                    for d in dets
                ],
            }
        )

    # Build per-segment summary
    total_person_frames = sum(len(dets) for dets in filtered_detections)
    summary = {
        "fileID": fid,
        "segment_start_utc": seg_iso,
        "total_frames": len(all_frames),
        "fps": round(fps, 2),
        "total_person_detections": total_person_frames,
        "avg_people_per_frame": round(total_person_frames / max(1, len(all_frames)), 2),
        "max_people_in_frame": max((len(d) for d in filtered_detections), default=0),
    }

    # Upload to R2
    tqdm.write(f"  Uploading results...")
    akey = f"{ANNOTATIONS_PREFIX}{fid}.jsonl"
    fkey = f"{FRAMES_PREFIX}{fid}.jsonl"
    okey = f"{OVERLAYS_PREFIX}{fid}.mp4"

    # Annotations = summary
    s3.put_object(
        Bucket=BUCKET,
        Key=akey,
        Body=json.dumps(summary).encode(),
        ContentType="application/json",
    )

    # Per-frame detections
    s3.put_object(
        Bucket=BUCKET,
        Key=fkey,
        Body=("\n".join(json.dumps(r) for r in frame_records)).encode(),
        ContentType="application/x-ndjson",
    )

    # Overlay video
    with open(out, "rb") as f:
        s3.put_object(Bucket=BUCKET, Key=okey, Body=f.read(), ContentType="video/mp4")
    os.unlink(out)

    return summary["max_people_in_frame"]


# ─── MAIN ────────────────────────────────────────────────────────────────────
async def main():
    # List videos
    videos = []
    for page in s3.get_paginator("list_objects_v2").paginate(
        Bucket=BUCKET, Prefix=UPLOADS_PREFIX
    ):
        for o in page.get("Contents", []):
            if o["Key"].endswith(".mp4"):
                videos.append(o["Key"])
    videos.sort()
    print(f"Found {len(videos)} videos in R2")

    # Check what's already done
    existing_annot = list_keys(ANNOTATIONS_PREFIX)
    existing_over = list_keys(OVERLAYS_PREFIX)
    existing_frames = list_keys(FRAMES_PREFIX)

    todo = [
        v
        for v in videos
        if not (
            f"{ANNOTATIONS_PREFIX}{Path(v).stem}.jsonl" in existing_annot
            and f"{OVERLAYS_PREFIX}{Path(v).stem}.mp4" in existing_over
            and f"{FRAMES_PREFIX}{Path(v).stem}.jsonl" in existing_frames
        )
    ]
    print(f"{len(todo)} videos remaining ({len(videos) - len(todo)} already done)\n")

    if not todo:
        print("Nothing to do!")
        return

    # Initialize token
    await token_mgr.refresh()

    # aiohttp session for all requests
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        ok_n = err_n = 0

        pbar = tqdm(todo, dynamic_ncols=True, unit="vid")
        for i, v in enumerate(pbar):
            try:
                max_people = await process_video(session, v)
                ok_n += 1
                pbar.set_postfix(ok=ok_n, err=err_n, max_ppl=max_people)
            except Exception as e:
                err_n += 1
                pbar.set_postfix(ok=ok_n, err=err_n)
                tqdm.write(f"  ✗ {Path(v).name}: {e}")
        pbar.close()


if __name__ == "__main__":
    asyncio.run(main())
