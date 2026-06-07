#!/usr/bin/env python3
"""
Find the actual retention horizon of this share.

We know:
  - Today's window (last ~24h) returns ~290 segments
  - The HAR from 5/2 captured a fileID we couldn't retrieve later (5/2 is
    15 days ago today, so it might have aged out)

This script:
  1. Asks gettimelinejson.aspx for ranges over progressively longer windows
     (1d, 3d, 7d, 14d, 30d) — that endpoint reveals the FULL availability,
     even if listing is gated
  2. Tries the WS list against the oldest day in the timeline range
  3. For sanity, lists ~25 segments from N days ago to confirm they're
     actually retrievable
  4. Reports the practical retention horizon

Run:
  python probe_retention.py
"""
from __future__ import annotations
import datetime as dt
import json
import random
import string
import sys
import time
from typing import Optional

import requests

try:
    from websocket import create_connection
except ImportError:
    print("pip install websocket-client requests"); sys.exit(2)


PARENT_ID = "399899011"
SHARE_ID = "17956664"
WS_URL = ("wss://www.cameraftp.com/api/camera/WSGetCameraFilesHandler.ashx"
          "?sesID={ses_id}")
TL_URL = "https://www.cameraftp.com/api/camera/gettimelinejson.aspx"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36")
ORIGIN = "https://www.cameraftp.com"
REFERER = (f"{ORIGIN}/Camera/Cameraplayer.aspx"
           f"?parentID={PARENT_ID}&shareID={SHARE_ID}&isEmbedded=true")


def mint():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=24))


def fmt_anchor(t):
    return (f"{t.month}/{t.day}/{t.year} "
            f"{t.hour}:{t.minute}:{t.second}."
            f"{t.microsecond // 1000:03d}")


def fmt_cftp(t):
    return f"{t.month}/{t.day}/{t.year} {t.hour}:{t.minute}:{t.second}"


def parse_frame(raw):
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    if not raw: return None
    i = raw.find("{")
    if i == -1: return None
    raw = raw[i:]
    depth, in_str, esc, end = 0, False, False, -1
    for idx, c in enumerate(raw):
        if esc: esc = False; continue
        if c == "\\": esc = True; continue
        if c == '"': in_str = not in_str; continue
        if in_str: continue
        if c == "{": depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0: end = idx + 1; break
    if end == -1: return None
    try: return json.loads(raw[:end])
    except json.JSONDecodeError: return None


def ws_list(ses_id, anchor, max_items=25, timeout=8.0):
    """One page of files starting at `anchor`."""
    url = WS_URL.format(ses_id=ses_id)
    ws = create_connection(url, origin=ORIGIN,
                           header=[f"User-Agent: {UA}",
                                   f"Referer: {REFERER}"],
                           timeout=15)
    try:
        req = {
            "Code": 0, "Message": "", "cameraPath": "",
            "dtStartTime": fmt_anchor(anchor),
            "search": "0", "fileID": "0",
            "parentID": PARENT_ID, "maxItems": str(max_items),
            "shareID": SHARE_ID, "offset": 0, "returnType": 0,
        }
        ws.send(json.dumps(req))
        records = []
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                ws.settimeout(max(0.5, deadline - time.time()))
                frame = ws.recv()
            except Exception:
                break
            if not frame: continue
            obj = parse_frame(frame)
            if obj is None: continue
            if obj.get("fileID") == -100 or \
                    obj.get("fileName") == "LoadCompleted":
                break
            records.append(obj)
        return records
    finally:
        try: ws.close()
        except Exception: pass


def tl_range(s, ses_id, start, end, unit="1day"):
    """Ask the timeline endpoint what's available in [start, end]."""
    params = {"sesID": ses_id, "cameraID": PARENT_ID, "shareID": SHARE_ID,
              "startTime": fmt_cftp(start), "endTime": fmt_cftp(end),
              "unit": unit, "t": int(time.time() * 1000)}
    return s.get(TL_URL, params=params, timeout=20).json()


def main():
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Referer": REFERER,
                      "X-Requested-With": "XMLHttpRequest",
                      "Accept": "application/json"})
    ses_id = mint()
    now_utc = dt.datetime.utcnow()
    print(f"sesID:  {ses_id}")
    print(f"now UTC: {now_utc}")
    print()

    # ---- Part 1: timeline horizon -----------------------------------------
    print("=" * 60)
    print("Part 1: how far back does the timeline say data exists?")
    print("=" * 60)
    horizons = [1, 3, 7, 14, 30, 60, 90]
    earliest_seen = None
    for days in horizons:
        start = now_utc - dt.timedelta(days=days)
        body = tl_range(s, ses_id, start, now_utc, unit="1day")
        status = body.get("status")
        ranges = body.get("data", [])
        if not ranges:
            print(f"  last {days:>3}d: status={status}, no data")
            continue
        earliest = min(r["from"] for r in ranges)
        latest = max(r["to"] for r in ranges)
        n_ranges = len(ranges)
        print(f"  last {days:>3}d: status={status}, {n_ranges} range(s), "
              f"earliest={earliest[:19]}, latest={latest[:19]}")
        earliest_seen = earliest

    # ---- Part 2: minute-by-minute around the horizon ----------------------
    # Sometimes the daily timeline shows availability, but listing is gated.
    # Let's try to actually fetch from progressively older anchors.
    print()
    print("=" * 60)
    print("Part 2: can we LIST files at each horizon? (25 records per probe)")
    print("=" * 60)
    for days in horizons:
        # Pick a noon UTC anchor that many days back
        anchor = now_utc - dt.timedelta(days=days)
        anchor = anchor.replace(hour=12, minute=0, second=0, microsecond=0)
        try:
            recs = ws_list(mint(), anchor, max_items=25)
            real = [r for r in recs
                    if isinstance(r.get("fileID"), int)
                    and r.get("fileID") > 0]
            if not real:
                print(f"  {days:>3}d ago ({anchor.strftime('%Y-%m-%d %H:%M')} UTC): "
                      f"0 records")
                continue
            names = [r.get("fileName", "") for r in real]
            # Extract earliest and latest timestamps from filenames
            from datetime import datetime as DT
            import re
            ts_re = re.compile(r"_(\d{14})\.mp4$")
            stamps = []
            for n in names:
                m = ts_re.search(n)
                if m:
                    try:
                        stamps.append(DT.strptime(m.group(1), "%Y%m%d%H%M%S"))
                    except ValueError:
                        pass
            if stamps:
                earliest_ts = min(stamps)
                latest_ts = max(stamps)
                age_days = (now_utc - earliest_ts).total_seconds() / 86400
                print(f"  {days:>3}d ago: {len(real)} records, "
                      f"earliest seg {earliest_ts.strftime('%Y-%m-%d %H:%M')} "
                      f"(={age_days:.1f}d old), "
                      f"latest seg {latest_ts.strftime('%Y-%m-%d %H:%M')}")
            else:
                print(f"  {days:>3}d ago: {len(real)} records, "
                      f"first={names[0][:60]}")
        except Exception as e:
            print(f"  {days:>3}d ago: error: {e}")

    # ---- Part 3: bisect for the exact horizon -----------------------------
    print()
    print("=" * 60)
    print("Part 3: bisect for exact retention horizon")
    print("=" * 60)

    def has_data_at(days_ago: float) -> bool:
        anchor = now_utc - dt.timedelta(days=days_ago)
        anchor = anchor.replace(hour=12, minute=0, second=0, microsecond=0)
        try:
            recs = ws_list(mint(), anchor, max_items=5, timeout=5.0)
            return any(isinstance(r.get("fileID"), int) and r.get("fileID") > 0
                       for r in recs)
        except Exception:
            return False

    lo, hi = 0.0, 90.0
    # First find an empty hi
    while hi <= 365 and has_data_at(hi):
        lo = hi
        hi *= 2
        print(f"  data exists at {lo:.1f}d, trying {hi:.1f}d...")
    if hi > 365:
        print(f"  data exists going back at least {lo:.1f} days, "
              f"didn't bisect further")
        return
    # Now lo has data, hi doesn't (or hi == initial 90 and is empty)
    print(f"  data at {lo:.1f}d, none at {hi:.1f}d — bisecting")
    for _ in range(8):  # ~6 hours precision at most
        mid = (lo + hi) / 2
        if has_data_at(mid):
            print(f"    {mid:.2f}d: data present")
            lo = mid
        else:
            print(f"    {mid:.2f}d: empty")
            hi = mid
        if hi - lo < 0.25:
            break

    print()
    print(f"RETENTION HORIZON: between {lo:.2f} and {hi:.2f} days back")
    print(f"  ≈ {lo*24:.0f}h to {hi*24:.0f}h")


if __name__ == "__main__":
    main()
