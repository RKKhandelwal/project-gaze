#!/usr/bin/env python3
"""
Pull the last 7 days of CameraFTP segments and upload them to Cloudflare R2.

One command, two progress bars (listing, then downloading), then done.

Setup (one time):
  pip install requests websocket-client boto3 tqdm
  export R2_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
  export R2_ACCESS_KEY_ID="..."
  export R2_SECRET_ACCESS_KEY="..."
  export R2_BUCKET="mckenna-pickleball-feed-may-17"

Run:
  python backfill_to_r2.py

What it does:
  1. Asks the CameraFTP timeline endpoint how far back data goes
     (always ~7 days for this share)
  2. Pages through the WebSocket file list, building the full set of
     fileIDs available
  3. Downloads each segment from CameraFTP and uploads to R2 under
     uploads/YYYY/MM/DD/<fileID>.mp4
  4. Skips anything already in R2 (so re-running picks up where it
     stopped — safe to interrupt)

Knobs you probably don't need to change:
  --prefix          R2 key prefix (default "uploads")
  --workers N       parallel download/upload workers (default 4)
  --start "..."    override the auto-detected start time (UTC)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import re
import string
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode

import boto3
import requests
from botocore.config import Config
from botocore.exceptions import ClientError
from tqdm import tqdm
from websocket import create_connection

# ---- CameraFTP constants (specific to this share) -------------------------

PARENT_ID = "399899011"
SHARE_ID = "17956664"

WS_URL = (
    "wss://www.cameraftp.com/api/camera/WSGetCameraFilesHandler.ashx?sesID={ses_id}"
)
TIMELINE_URL = "https://www.cameraftp.com/api/camera/gettimelinejson.aspx"
DOWNLOAD_URL = "https://cameraftpapi.drivehq.com/api/camera/DF.aspx"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
)
ORIGIN = "https://www.cameraftp.com"
REFERER = (
    f"{ORIGIN}/Camera/Cameraplayer.aspx"
    f"?parentID={PARENT_ID}&shareID={SHARE_ID}&isEmbedded=true"
)

_TS_RE = re.compile(r"_(\d{14})\.mp4$", re.IGNORECASE)


# ---- helpers --------------------------------------------------------------


def mint_ses_id() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=24))


def fmt_anchor(t: dt.datetime) -> str:
    """The browser sends 'M/D/YYYY H:M:S.fff' with millisecond precision."""
    return (
        f"{t.month}/{t.day}/{t.year} "
        f"{t.hour}:{t.minute}:{t.second}."
        f"{t.microsecond // 1000:03d}"
    )


def fmt_cftp(t: dt.datetime) -> str:
    return f"{t.month}/{t.day}/{t.year} {t.hour}:{t.minute}:{t.second}"


def parse_segment_time(file_name: str):
    """Filenames embed 'YYYYMMDDHHMMSS' in PT. We return UTC."""
    m = _TS_RE.search(file_name or "")
    if not m:
        return None
    try:
        local = dt.datetime.strptime(m.group(1), "%Y%m%d%H%M%S")
        # Camera is in Pacific Time. May = PDT = UTC-7.
        return local + dt.timedelta(hours=7)
    except ValueError:
        return None


def parse_frame(raw):
    """The server sometimes appends a JPEG thumbnail after the JSON. Walk
    braces to find the first balanced object and parse just that."""
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    if not raw:
        return None
    i = raw.find("{")
    if i == -1:
        return None
    raw = raw[i:]
    depth, in_str, esc, end = 0, False, False, -1
    for idx, c in enumerate(raw):
        if esc:
            esc = False
            continue
        if c == "\\":
            esc = True
            continue
        if c == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                end = idx + 1
                break
    if end == -1:
        return None
    try:
        return json.loads(raw[:end])
    except json.JSONDecodeError:
        return None


# ---- CameraFTP API --------------------------------------------------------


def fetch_data_range(ses_id: str) -> tuple[dt.datetime, dt.datetime]:
    """Ask the timeline endpoint what's available. Returns (start, end) UTC."""
    now = dt.datetime.utcnow()
    params = {
        "sesID": ses_id,
        "cameraID": PARENT_ID,
        "shareID": SHARE_ID,
        "startTime": fmt_cftp(now - dt.timedelta(days=10)),
        "endTime": fmt_cftp(now),
        "unit": "1day",
        "t": int(time.time() * 1000),
    }
    headers = {
        "User-Agent": UA,
        "Referer": REFERER,
        "X-Requested-With": "XMLHttpRequest",
    }
    r = requests.get(TIMELINE_URL, params=params, headers=headers, timeout=20)
    body = r.json()
    if body.get("status") != 0 or not body.get("data"):
        raise RuntimeError(
            f"timeline endpoint returned no data: {body}. "
            "Either the share is empty or the API changed."
        )
    earliest = min(e["from"] for e in body["data"])
    latest = max(e["to"] for e in body["data"])
    return (
        dt.datetime.strptime(earliest[:19], "%m/%d/%Y %H:%M:%S"),
        dt.datetime.strptime(latest[:19], "%m/%d/%Y %H:%M:%S"),
    )


def list_all_files(
    ses_id: str, start: dt.datetime, end: dt.datetime, page_size: int = 25
) -> list[dict]:
    """Page forward in time from `start`, collecting every record up to
    `end`. Opens a fresh WebSocket per page — there's some per-connection
    state in the server that stops returning data after one query, so we
    can't keep a single socket alive across paging.

    Pagination strategy: advance `dtStartTime` to just after the latest
    file we've received. This is what the browser does (it polls every 5
    seconds with the current playback timestamp). Using fileID as the
    cursor seemed to work for one page but didn't continue."""
    seen_ids: set[int] = set()
    all_records: list[dict] = []
    cursor_time = start

    pbar = tqdm(desc="listing files", unit="seg", dynamic_ncols=True)

    consecutive_empty = 0
    page_num = 0
    while True:
        page_num += 1
        ws = create_connection(
            WS_URL.format(ses_id=ses_id),
            origin=ORIGIN,
            header=[f"User-Agent: {UA}", f"Referer: {REFERER}"],
            timeout=20,
        )
        try:
            req = {
                "Code": 0,
                "Message": "",
                "cameraPath": "",
                "dtStartTime": fmt_anchor(cursor_time),
                "search": "0",
                "fileID": "0",
                "parentID": PARENT_ID,
                "maxItems": str(page_size),
                "shareID": SHARE_ID,
                "offset": 0,
                "returnType": 0,
            }
            ws.send(json.dumps(req))
            batch = []
            deadline = time.time() + 10
            while time.time() < deadline:
                try:
                    ws.settimeout(max(0.5, deadline - time.time()))
                    frame = ws.recv()
                except Exception:
                    break
                if not frame:
                    continue
                obj = parse_frame(frame)
                if obj is None:
                    continue
                if obj.get("fileID") == -100 or obj.get("fileName") == "LoadCompleted":
                    break
                batch.append(obj)
        finally:
            try:
                ws.close()
            except Exception:
                pass

        new = [
            r
            for r in batch
            if isinstance(r.get("fileID"), int)
            and r.get("fileID") > 0
            and r.get("fileID") not in seen_ids
        ]

        if not new:
            # Page returned no new records. Try once more after a brief
            # pause — sometimes the server has a brief hiccup. If two
            # consecutive empty pages, we've reached the end.
            consecutive_empty += 1
            if consecutive_empty >= 2:
                break
            time.sleep(0.5)
            continue
        consecutive_empty = 0

        for r in new:
            seen_ids.add(r.get("fileID"))
            all_records.append(r)
        pbar.update(len(new))

        # Advance cursor to just after the latest segment we got. The
        # filename embeds local-time YYYYMMDDHHMMSS; parse_segment_time
        # returns UTC. If we can't parse (shouldn't happen) we fall back
        # to using the record's `datetime` field directly.
        latest_record = max(
            new,
            key=lambda r: r.get("fileID", 0) if isinstance(r.get("fileID"), int) else 0,
        )
        latest_time = parse_segment_time(latest_record.get("fileName", ""))
        if latest_time is None:
            dt_str = latest_record.get("datetime", "")
            try:
                latest_time = dt.datetime.strptime(dt_str[:19], "%Y-%m-%dT%H:%M:%S")
            except Exception:
                latest_time = cursor_time + dt.timedelta(minutes=4)

        # Bump 1 second past the latest record so the next page starts
        # AFTER it, not AT it (which would re-return the same record).
        new_cursor = latest_time + dt.timedelta(seconds=1)
        if new_cursor <= cursor_time:
            # Defensive: if cursor isn't advancing, force progress to
            # avoid an infinite loop
            new_cursor = cursor_time + dt.timedelta(minutes=1)
        cursor_time = new_cursor

        if cursor_time >= end:
            break

    pbar.close()
    print(f"  ({page_num} pages, {len(all_records)} unique segments)")
    return all_records


def build_download_url(ses_id: str, file_id) -> str:
    params = {
        "sesID": ses_id,
        "isGallery": "",
        "share": "true",
        "shareID": SHARE_ID,
        "fileID": str(file_id),
        "outputErrorInHeader": "true",
    }
    return f"{DOWNLOAD_URL}?{urlencode(params)}&a.mp4"


def download_to_bytes(http: requests.Session, ses_id: str, file_id) -> bytes:
    url = build_download_url(ses_id, file_id)
    with http.get(
        url, headers={"Referer": "https://www.cameraftp.com/"}, stream=True, timeout=180
    ) as r:
        r.raise_for_status()
        for h in ("X-Error", "ErrorMessage", "X-Camera-Error"):
            if h in r.headers:
                raise RuntimeError(f"server error fileID={file_id}: {r.headers[h]}")
        return r.content


# ---- R2 ------------------------------------------------------------------


def make_r2_client(endpoint: str, access_key: str, secret_key: str):
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(
            s3={"addressing_style": "virtual"},
            signature_version="s3v4",
            retries={"max_attempts": 5, "mode": "standard"},
        ),
    )


def r2_key_for(file_id: str, ts: dt.datetime, prefix: str) -> str:
    """Key layout: <prefix>/YYYY/MM/DD/<YYYYMMDDHHMMSS>_<fileID>.mp4

    The timestamp is in UTC (parse_segment_time converts the camera-local
    Pacific filename to UTC). This matches `segment_start_utc` in the
    annotations JSONL, so the same value appears everywhere. Note this is
    7 hours ahead of the time shown in the original CameraFTP filename
    (which was PT). Embedding it in the key means:
      - wall-clock time is recoverable from the key alone, in UTC, with no
        need to re-query CameraFTP or open the annotations JSONL
      - the date-path (YYYY/MM/DD) and the filename timestamp are both UTC,
        so they're internally consistent
      - listing a day's folder returns segments in chronological order
        (the timestamp prefix sorts lexicographically)
      - the fileID suffix keeps the key unique

    Caveat: because the date-path is UTC, segments recorded in the evening
    Pacific time land in the *next* UTC day's folder. That's correct and
    consistent, just worth knowing when eyeballing the folder structure.
    """
    if ts:
        return f"{prefix}/{ts:%Y/%m/%d}/{ts:%Y%m%d%H%M%S}_{file_id}.mp4"
    return f"{prefix}/unknown_date/{file_id}.mp4"


def r2_exists(r2, bucket: str, key: str) -> bool:
    try:
        r2.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


# ---- the worker ----------------------------------------------------------


def process_one(
    record: dict, ses_id: str, r2, bucket: str, prefix: str, http: requests.Session
) -> dict:
    """Download one segment from CameraFTP and upload to R2. Returns a
    small status dict for the progress logger."""
    fid = record.get("fileID")
    fname = record.get("fileName", "")
    ts = parse_segment_time(fname)
    key = r2_key_for(str(fid), ts, prefix)

    try:
        if r2_exists(r2, bucket, key):
            return {"fid": fid, "key": key, "skipped": True, "size": 0}
        body = download_to_bytes(http, ses_id, fid)
        r2.put_object(
            Bucket=bucket,
            Key=key,
            Body=body,
            ContentType="video/mp4",
            Metadata={"file_id": str(fid), "source_name": fname[:1024]},
        )
        return {"fid": fid, "key": key, "skipped": False, "size": len(body)}
    except Exception as e:
        return {"fid": fid, "key": key, "error": str(e), "size": 0}


# ---- main ----------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--prefix", default="uploads", help='R2 key prefix (default "uploads")'
    )
    ap.add_argument(
        "--workers",
        type=int,
        default=4,
        help="parallel download/upload workers (default 4)",
    )
    ap.add_argument(
        "--start",
        default=None,
        help='UTC "YYYY-MM-DD HH:MM:SS" — override auto-detected start',
    )
    ap.add_argument(
        "--end",
        default=None,
        help='UTC "YYYY-MM-DD HH:MM:SS" — override auto-detected end',
    )
    args = ap.parse_args()

    endpoint = os.environ.get("R2_ENDPOINT")
    bucket = os.environ.get("R2_BUCKET")
    access = os.environ.get("R2_ACCESS_KEY_ID")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY")
    missing = [
        name
        for name, val in [
            ("R2_ENDPOINT", endpoint),
            ("R2_BUCKET", bucket),
            ("R2_ACCESS_KEY_ID", access),
            ("R2_SECRET_ACCESS_KEY", secret),
        ]
        if not val
    ]
    if missing:
        print(f"missing env vars: {', '.join(missing)}", file=sys.stderr)
        sys.exit(2)

    r2 = make_r2_client(endpoint, access, secret)

    # Sanity check: can we reach the bucket?
    try:
        r2.head_bucket(Bucket=bucket)
    except Exception as e:
        print(f"can't reach r2://{bucket}: {e}", file=sys.stderr)
        sys.exit(2)
    print(f"→ r2://{bucket}/{args.prefix}/")

    ses_id = mint_ses_id()
    http = requests.Session()
    http.headers["User-Agent"] = UA

    # 1) Figure out the time range
    if args.start and args.end:
        start = dt.datetime.strptime(args.start, "%Y-%m-%d %H:%M:%S")
        end = dt.datetime.strptime(args.end, "%Y-%m-%d %H:%M:%S")
        print(f"using window {start} → {end} UTC (from --start/--end)")
    else:
        start, end = fetch_data_range(ses_id)
        print(
            f"share has data {start} → {end} UTC "
            f"({(end - start).total_seconds() / 86400:.2f} days)"
        )

    # 2) List every file in the window
    print()
    records = list_all_files(ses_id, start, end)
    if not records:
        print(
            "no files in window. Either the API changed or you've "
            "specified an empty range."
        )
        sys.exit(1)

    # 3) Download → upload in parallel
    print(f"\ndownloading {len(records)} segments → R2 ({args.workers} workers)\n")

    skipped = 0
    uploaded = 0
    errored = 0
    bytes_uploaded = 0

    pbar = tqdm(total=len(records), desc="archiving", unit="seg", dynamic_ncols=True)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = [
            ex.submit(process_one, rec, ses_id, r2, bucket, args.prefix, http)
            for rec in records
        ]
        for fut in as_completed(futures):
            res = fut.result()
            if res.get("error"):
                errored += 1
                pbar.write(f"  ERR fileID={res['fid']}: {res['error']}")
            elif res.get("skipped"):
                skipped += 1
            else:
                uploaded += 1
                bytes_uploaded += res["size"]
            pbar.set_postfix(
                {
                    "up": uploaded,
                    "skip": skipped,
                    "err": errored,
                    "MB": f"{bytes_uploaded / 1024 / 1024:.0f}",
                }
            )
            pbar.update(1)
    pbar.close()

    print()
    print(
        f"done: uploaded={uploaded}, skipped={skipped}, "
        f"errored={errored}, total_MB={bytes_uploaded / 1024 / 1024:.1f}"
    )
    if errored:
        print(
            f"({errored} segments failed — re-run to retry them; "
            "already-uploaded files are skipped.)"
        )


if __name__ == "__main__":
    main()
