#!/usr/bin/env python3
"""
Probe with timezone-correct windows. T5 from probe_http.py revealed the
data range: 05/17 13:01:47 → 18:36:44 UTC for today. We were querying in
local time before, which is why everything returned empty.

This script:
  1. Asks the timeline for the *actual* availability range (so we know
     the right window to use)
  2. Queries the WS with several UTC windows inside that range
  3. Tries more `unit` values on the HTTP timeline to see if any of them
     return per-segment entries instead of just the availability range
  4. Tries hitting the timeline with a one-minute window (smallest unit)
     in case it returns minute-level fileID buckets

Run:
  python probe_aware.py
"""

from __future__ import annotations

import datetime as dt
import json
import random
import re
import string
import sys
import time

import requests

try:
    from websocket import create_connection
except ImportError:
    print("pip install websocket-client requests", file=sys.stderr)
    sys.exit(2)

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


def mint_ses_id():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=24))


def fmt_cftp(t):
    return f"{t.month}/{t.day}/{t.year} {t.hour}:{t.minute}:{t.second}"


def parse_frame(raw):
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


def ws_query(ses_id, start, end, extra=None, timeout=8.0):
    ws = create_connection(WS_URL.format(ses_id=ses_id), origin=ORIGIN,
                           header=[f"User-Agent: {UA}", f"Referer: {REFERER}"],
                           timeout=15)
    try:
        req = {"parentID": PARENT_ID, "shareID": SHARE_ID, "sesID": ses_id,
               "startTime": fmt_cftp(start), "endTime": fmt_cftp(end)}
        if extra: req.update(extra)
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
            if obj.get("fileName") == "LoadCompleted": break
            records.append(obj)
        return records
    finally:
        try: ws.close()
        except Exception: pass


def tl_query(s, ses_id, start, end, unit="1min", extra=None):
    params = {"sesID": ses_id, "cameraID": PARENT_ID, "shareID": SHARE_ID,
              "startTime": fmt_cftp(start), "endTime": fmt_cftp(end),
              "unit": unit, "t": int(time.time() * 1000)}
    if extra: params.update(extra)
    return s.get(TL_URL, params=params, timeout=20).json()


def summarize_records(records):
    if not records: return "  (empty)"
    out = []
    for r in records[:5]:
        out.append(f"    fileID={r.get('fileID')} name={r.get('fileName')!r} "
                   f"type={r.get('fileType')} size={r.get('fileSize')}")
    if len(records) > 5:
        out.append(f"    ... +{len(records)-5} more, "
                   f"last fileID={records[-1].get('fileID')}")
    return "\n".join(out)


def main():
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Referer": REFERER,
                      "X-Requested-With": "XMLHttpRequest",
                      "Accept": "application/json"})
    ses_id = mint_ses_id()
    now_utc = dt.datetime.utcnow()
    print(f"sesID: {ses_id}")
    print(f"now (UTC): {now_utc}")
    print()

    # --- Step 1: find the actual availability range -----------------------
    # Wide query, in UTC. Use the same start the player would: 24h ago.
    avail = tl_query(s, ses_id, now_utc - dt.timedelta(hours=24), now_utc,
                     unit="1day")
    print(f"[step 1] availability (last 24h):")
    print(f"  {json.dumps(avail, indent=2)}")
    if avail.get("status") != 0 or not avail.get("data"):
        print("\nno data in last 24h — try a wider window")
        avail = tl_query(s, ses_id,
                         now_utc - dt.timedelta(days=14), now_utc,
                         unit="1day")
        print(f"[step 1b] last 14 days:")
        print(f"  {json.dumps(avail, indent=2)}")
        if avail.get("status") != 0 or not avail.get("data"):
            print("still no data, aborting")
            return

    # Parse the range
    range_entry = avail["data"][0]
    range_from = dt.datetime.strptime(range_entry["from"][:19],
                                      "%m/%d/%Y %H:%M:%S")
    range_to = dt.datetime.strptime(range_entry["to"][:19],
                                    "%m/%d/%Y %H:%M:%S")
    print(f"\n[step 1 done] data available {range_from} → {range_to} UTC")
    print(f"             = {(range_to - range_from).total_seconds()/60:.1f} min")

    # --- Step 2: try varying `unit` on the HTTP timeline ------------------
    # We've tried 1sec, 1min, 1hour, 1day. Try some we haven't.
    print(f"\n[step 2] trying various `unit` values on a window inside "
          f"the available range:")
    inner_start = range_from
    inner_end = min(range_from + dt.timedelta(minutes=10), range_to)
    for unit in ("1min", "5min", "10min", "30min", "min", "minute",
                 "file", "files", "segment", "all", ""):
        try:
            r = tl_query(s, ses_id, inner_start, inner_end, unit=unit)
            body = json.dumps(r)
            if len(body) > 200: body = body[:200] + f"... +{len(body)-200}"
            print(f"  unit={unit!r:12s} → {body}")
        except Exception as e:
            print(f"  unit={unit!r:12s} → error: {e}")

    # --- Step 3: WS queries inside the available window -------------------
    print(f"\n[step 3] WS query for a 10-minute window inside available range:")
    records = ws_query(ses_id, inner_start, inner_end)
    print(f"  {len(records)} record(s)")
    print(summarize_records(records))

    # Try with various extras now that we know the window contains data
    print(f"\n[step 4] WS query, same window, with extra fields:")
    for label, extra in [
        ("fileType=1 (video)", {"fileType": 1}),
        ("pageSize=100",       {"pageSize": 100}),
        ("count=100",          {"count": 100}),
        ("limit=100",          {"limit": 100}),
        ("maxFiles=100",       {"maxFiles": 100}),
        ("requestType=files",  {"requestType": "files"}),
        ("requestType=list",   {"requestType": "list"}),
        ("getThumb=false",     {"getThumb": False}),
        ("noThumb=true",       {"noThumb": True}),
        ("includeFiles=true",  {"includeFiles": True}),
    ]:
        try:
            records = ws_query(ses_id, inner_start, inner_end, extra=extra,
                               timeout=5.0)
            extras_info = ""
            if records:
                fids = [r.get("fileID") for r in records]
                extras_info = (f"  ids: {min(fids)}…{max(fids)} "
                               f"({len(set(fids))} unique)")
            print(f"  {label:25s} → {len(records)} records{extras_info}")
            if records and len(records) > 1:
                # Found pagination! Show details.
                print(f"    first: {records[0].get('fileName')}")
                print(f"    last:  {records[-1].get('fileName')}")
        except Exception as e:
            print(f"  {label:25s} → error: {e}")


if __name__ == "__main__":
    main()
