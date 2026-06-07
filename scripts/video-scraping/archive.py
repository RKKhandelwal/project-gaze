#!/usr/bin/env python3
"""
CameraFTP archiver — using the real protocol observed in the browser.

Frame format (every field is required, even the empty ones):
  {
    "Code": 0,
    "Message": "",
    "cameraPath": "",
    "dtStartTime": "M/D/YYYY H:M:S.fff",   # anchor time, millisecond precision
    "search": "0",
    "fileID": "0",                         # cursor: "0" for first page,
                                           #         last received fileID for next
    "parentID": "399899011",
    "maxItems": "5",                       # bump to 100; default 5 is why we were stuck
    "shareID": "17956664",
    "offset": 0,
    "returnType": 0
  }

The server returns a stream of file records, then a LoadCompleted sentinel
(fileID=-100). To page: take the smallest fileID you received, put it
in the cursor field, resend. Stop when fewer than maxItems come back, or
when no new fileIDs appear.

The player polls this every 5 seconds with the original dtStartTime and
fileID=0 — it's tailing for new segments. We do the same in daemon mode.

Run:
  pip install requests websocket-client boto3
  python archive.py                                  # last 10min, ./segments/
  python archive.py --start "2026-05-17 11:00:00"    # specific UTC anchor
  python archive.py --daemon                         # continuous tail
  python archive.py --daemon --s3-bucket my-bucket
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import random
import re
import string
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import requests
from websocket import WebSocket, create_connection

PARENT_ID = "399899011"
SHARE_ID = "17956664"

WS_URL = ("wss://www.cameraftp.com/api/camera/WSGetCameraFilesHandler.ashx"
          "?sesID={ses_id}")
DOWNLOAD_URL = "https://cameraftpapi.drivehq.com/api/camera/DF.aspx"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36")
ORIGIN = "https://www.cameraftp.com"
REFERER = (f"{ORIGIN}/Camera/Cameraplayer.aspx"
           f"?parentID={PARENT_ID}&shareID={SHARE_ID}&isEmbedded=true")

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("cam")


# ---- helpers ---------------------------------------------------------------

def mint_ses_id() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=24))


def fmt_anchor(t: dt.datetime) -> str:
    """The browser sends 'M/D/YYYY H:M:S.fff' (millisecond precision).
    Server is in UTC."""
    return (f"{t.month}/{t.day}/{t.year} "
            f"{t.hour}:{t.minute}:{t.second}."
            f"{t.microsecond // 1000:03d}")


def parse_dt(s: str) -> dt.datetime:
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(s)


def parse_frame(raw):
    """Strip the JPEG bytes the server tacks onto sentinels (the 'binary
    message' that's actually JSON + thumbnail concatenated)."""
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
            esc = False; continue
        if c == "\\":
            esc = True; continue
        if c == '"':
            in_str = not in_str; continue
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


def build_request(anchor: dt.datetime, cursor_file_id: str = "0",
                  max_items: int = 100) -> dict:
    """Build the exact frame shape the player uses. Strings need to stay
    strings — the player sends fileID, maxItems, search as quoted."""
    return {
        "Code": 0,
        "Message": "",
        "cameraPath": "",
        "dtStartTime": fmt_anchor(anchor),
        "search": "0",
        "fileID": str(cursor_file_id),
        "parentID": PARENT_ID,
        "maxItems": str(max_items),
        "shareID": SHARE_ID,
        "offset": 0,
        "returnType": 0,
    }


# ---- protocol --------------------------------------------------------------

def fetch_page(ws: WebSocket, anchor: dt.datetime, cursor: str,
               max_items: int, timeout: float = 10.0) -> list[dict]:
    """Send one query frame, collect records until LoadCompleted sentinel."""
    ws.send(json.dumps(build_request(anchor, cursor, max_items)))
    records: list[dict] = []
    deadline = time.time() + timeout
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
        # Sentinel: fileID=-100 / name LoadCompleted. End of this page.
        if obj.get("fileID") == -100 or obj.get("fileName") == "LoadCompleted":
            break
        records.append(obj)
    return records


def find_max_page_size(ses_id: str, anchor: dt.datetime) -> int:
    """The server appears to have a whitelist of acceptable maxItems values.
    Probe to find the largest one it accepts. Returns the working size."""
    url = WS_URL.format(ses_id=ses_id)
    ws = create_connection(url, origin=ORIGIN,
                           header=[f"User-Agent: {UA}",
                                   f"Referer: {REFERER}"],
                           timeout=15)
    try:
        # Try common values in descending order, return the first that
        # gives ≥2 records (proving it's not stuck at 1).
        best = 5  # we know this works
        for candidate in (50, 25, 20, 10):
            batch = fetch_page(ws, anchor, "0", candidate, timeout=4.0)
            real = [r for r in batch
                    if isinstance(r.get("fileID"), int)
                    and r.get("fileID") > 0]
            if len(real) >= 2:
                best = candidate
                break
        return best
    finally:
        try: ws.close()
        except Exception: pass


def list_files(ses_id: str, anchor: dt.datetime, max_pages: int = 1000,
               page_size: int = 5) -> list[dict]:
    """Page forward in time from `anchor`. Cursor semantics, confirmed by
    the wire trace:
      - dtStartTime = LOWER BOUND on file time
      - fileID="0"  → return files at or after dtStartTime (oldest first)
      - fileID="N"  → return files AFTER fileID N (continues forward)
    A page with fewer than `page_size` real records, or a LoadCompleted
    with offset==0, means we've caught up to the present."""
    url = WS_URL.format(ses_id=ses_id)
    ws = create_connection(url, origin=ORIGIN,
                           header=[f"User-Agent: {UA}",
                                   f"Referer: {REFERER}"],
                           timeout=20)
    try:
        cursor = "0"
        seen_ids: set = set()
        all_records: list[dict] = []
        for page in range(max_pages):
            batch = fetch_page(ws, anchor, cursor, page_size)
            new = [r for r in batch
                   if isinstance(r.get("fileID"), int)
                   and r.get("fileID") > 0
                   and r.get("fileID") not in seen_ids]
            if not new:
                # End of data: server has nothing newer than our cursor
                break
            all_records.extend(new)
            for r in new:
                seen_ids.add(r.get("fileID"))
            int_fids = [r.get("fileID") for r in new]
            min_fid, max_fid = min(int_fids), max(int_fids)
            log.info("  page %d: +%d records (fileID %d…%d, total %d)",
                     page + 1, len(new), min_fid, max_fid,
                     len(all_records))
            # Next cursor = the LATEST (largest) fileID from this page;
            # we want files newer than it on the next call
            cursor = str(max_fid)
            # If we got fewer than asked, server has no more data
            if len(new) < page_size:
                break
        return all_records
    finally:
        try:
            ws.close()
        except Exception:
            pass


# ---- download --------------------------------------------------------------

def build_download_url(ses_id: str, file_id) -> str:
    params = {
        "sesID": ses_id, "isGallery": "", "share": "true",
        "shareID": SHARE_ID, "fileID": str(file_id),
        "outputErrorInHeader": "true",
    }
    return f"{DOWNLOAD_URL}?{urlencode(params)}&a.mp4"


def download_segment(http: requests.Session, ses_id: str,
                     file_id, out_path: Path) -> int:
    url = build_download_url(ses_id, file_id)
    with http.get(url, headers={"Referer": "https://www.cameraftp.com/"},
                  stream=True, timeout=180) as r:
        r.raise_for_status()
        for h in ("X-Error", "ErrorMessage", "X-Camera-Error"):
            if h in r.headers:
                raise RuntimeError(f"server error fileID={file_id}: "
                                   f"{r.headers[h]}")
        total = 0
        with open(out_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=64 * 1024):
                if chunk:
                    f.write(chunk)
                    total += len(chunk)
        return total


# ---- segment name parsing --------------------------------------------------

_TS_RE = re.compile(r"_(\d{14})\.mp4$", re.IGNORECASE)


def parse_segment_time(file_name: str):
    m = _TS_RE.search(file_name or "")
    if not m:
        return None
    try:
        return dt.datetime.strptime(m.group(1), "%Y%m%d%H%M%S")
    except ValueError:
        return None


# ---- storage ---------------------------------------------------------------

class Store:
    def __init__(self, *, local_dir, s3_bucket, s3_prefix="cam"):
        self.local_dir = local_dir
        self.s3_bucket = s3_bucket
        self.s3_prefix = s3_prefix.strip("/")
        self._s3 = None
        if s3_bucket:
            import boto3
            self._s3 = boto3.client("s3")
        if local_dir:
            local_dir.mkdir(parents=True, exist_ok=True)

    def key_for(self, file_id, ts):
        if ts:
            return f"{self.s3_prefix}/{ts:%Y/%m/%d}/{file_id}.mp4"
        return f"{self.s3_prefix}/unknown_date/{file_id}.mp4"

    def exists(self, file_id, ts):
        if self.local_dir:
            ts_dir = (self.local_dir / f"{ts:%Y/%m/%d}") if ts else \
                     (self.local_dir / "unknown_date")
            return (ts_dir / f"{file_id}.mp4").exists()
        if self._s3:
            from botocore.exceptions import ClientError
            try:
                self._s3.head_object(Bucket=self.s3_bucket,
                                     Key=self.key_for(file_id, ts))
                return True
            except ClientError:
                return False
        return False

    def write(self, file_id, ts, source_path: Path):
        if self.local_dir:
            ts_dir = (self.local_dir / f"{ts:%Y/%m/%d}") if ts else \
                     (self.local_dir / "unknown_date")
            ts_dir.mkdir(parents=True, exist_ok=True)
            dest = ts_dir / f"{file_id}.mp4"
            source_path.replace(dest)
            return str(dest)
        if self._s3:
            key = self.key_for(file_id, ts)
            self._s3.upload_file(str(source_path), self.s3_bucket, key,
                                 ExtraArgs={"ContentType": "video/mp4"})
            source_path.unlink(missing_ok=True)
            return f"s3://{self.s3_bucket}/{key}"
        raise RuntimeError("no store configured")


# ---- archive loop ----------------------------------------------------------

def archive_one_pass(ses_id, http, store, anchor: dt.datetime,
                     seen: set, page_size: int):
    records = list_files(ses_id, anchor, page_size=page_size)
    log.info("query @ %s UTC → %d records", anchor.strftime("%H:%M:%S"),
             len(records))

    tmp_dir = Path("/tmp/cam_archive_tmp")
    tmp_dir.mkdir(parents=True, exist_ok=True)
    downloaded = 0

    for rec in records:
        fid = rec.get("fileID")
        if fid is None or (isinstance(fid, int) and fid < 0):
            continue
        fid_s = str(fid)
        name = rec.get("fileName", "")
        ts = parse_segment_time(name)
        if fid_s in seen:
            continue
        if store.exists(fid_s, ts):
            seen.add(fid_s)
            continue

        tmp = tmp_dir / f"{fid_s}.mp4.tmp"
        try:
            n = download_segment(http, ses_id, fid_s, tmp)
        except Exception as e:
            log.warning("download fileID=%s failed: %s", fid_s, e)
            tmp.unlink(missing_ok=True)
            continue

        try:
            dest = store.write(fid_s, ts, tmp)
            seen.add(fid_s)
            downloaded += 1
            log.info("  fileID=%s (%.1f MiB) %s → %s",
                     fid_s, n / (1024 * 1024),
                     ts.strftime("%H:%M:%S") if ts else "??:??:??",
                     dest)
        except Exception as e:
            log.warning("store write fileID=%s failed: %s", fid_s, e)
            tmp.unlink(missing_ok=True)

    return downloaded


def run_daemon(ses_id, store, poll_seconds, page_size):
    """Tail. Each poll re-anchors to current UTC; we get records ≤ that
    anchor, dedupe against `seen`."""
    http = requests.Session()
    http.headers["User-Agent"] = UA
    seen: set = set()
    log.info("daemon: polling every %.0fs, page_size=%d",
             poll_seconds, page_size)
    backoff = 5
    while True:
        try:
            anchor = dt.datetime.utcnow()
            n = archive_one_pass(ses_id, http, store, anchor,
                                 seen, page_size)
            if n == 0:
                log.info("  (nothing new)")
            backoff = 5
        except KeyboardInterrupt:
            log.info("interrupted"); return
        except Exception as e:
            log.exception("loop failed: %s — backing off %ds", e, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 300)
            continue
        time.sleep(poll_seconds)


# ---- main ------------------------------------------------------------------

def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", help='UTC anchor "YYYY-MM-DD HH:MM:SS"; '
                                    "defaults to now")
    ap.add_argument("--daemon", action="store_true")
    ap.add_argument("--poll-seconds", type=float, default=60.0)
    ap.add_argument("--page-size", type=int, default=5,
                    help="maxItems per WS query. Server may have a "
                         "whitelist — known working: 5. Pass --probe-page-size "
                         "to detect the highest accepted value.")
    ap.add_argument("--probe-page-size", action="store_true",
                    help="auto-detect the largest accepted page size "
                         "before listing")
    ap.add_argument("--out", default="./segments")
    ap.add_argument("--s3-bucket", default=os.environ.get("S3_BUCKET"))
    ap.add_argument("--s3-prefix", default="losaltos-pickleball")
    ap.add_argument("--ses-id", default=None)
    return ap.parse_args()


def main():
    args = parse_args()
    store = Store(
        local_dir=None if args.s3_bucket else Path(args.out),
        s3_bucket=args.s3_bucket, s3_prefix=args.s3_prefix,
    )
    ses_id = args.ses_id or mint_ses_id()
    log.info("sesID: %s", ses_id)

    page_size = args.page_size
    if args.probe_page_size:
        anchor_for_probe = (parse_dt(args.start) if args.start
                            else dt.datetime.utcnow() - dt.timedelta(hours=1))
        page_size = find_max_page_size(ses_id, anchor_for_probe)
        log.info("probed page size: %d", page_size)

    if args.daemon:
        run_daemon(ses_id, store, args.poll_seconds, page_size)
        return

    http = requests.Session()
    http.headers["User-Agent"] = UA
    anchor = parse_dt(args.start) if args.start else dt.datetime.utcnow()
    seen: set = set()
    n = archive_one_pass(ses_id, http, store, anchor, seen, page_size)
    log.info("done — %d new segments", n)


if __name__ == "__main__":
    main()
