#!/usr/bin/env python3
"""
Characterize what the CameraFTP file-list WebSocket actually returns.

We know `parentID + shareID + sesID + startTime + endTime` works. What we
don't know:
  - Does the server cap the result count per query?
  - Does it cap the time window it'll look back at?
  - Is paging done via `offset`, `pageSize`, both, neither?
  - Does the response actually depend on the time window we ask for, or
    is it always "the most recent N"?

This script runs a handful of carefully-chosen queries and prints what
each one returned, so we can read the protocol's behavior off the data.

Run:
  pip install websocket-client
  python probe.py
"""

from __future__ import annotations

import datetime as dt
import json
import random
import re
import string
import sys
import time
from collections import Counter

try:
    from websocket import create_connection
except ImportError:
    print("pip install websocket-client", file=sys.stderr)
    sys.exit(2)


PARENT_ID = "399899011"
SHARE_ID = "17956664"
WS_URL = ("wss://www.cameraftp.com/api/camera/WSGetCameraFilesHandler.ashx"
          "?sesID={ses_id}")
ORIGIN = "https://www.cameraftp.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36")
REFERER = (f"{ORIGIN}/Camera/Cameraplayer.aspx"
           f"?parentID={PARENT_ID}&shareID={SHARE_ID}&isEmbedded=true")

_TS_RE = re.compile(r"_(\d{14})\.mp4$", re.IGNORECASE)


def mint_ses_id() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=24))


def fmt_cftp(t: dt.datetime) -> str:
    return f"{t.month}/{t.day}/{t.year} {t.hour}:{t.minute}:{t.second}"


def parse_frame(raw):
    """Strip the JPEG bytes the server tacks onto sentinels."""
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    if not raw:
        return None
    i = raw.find("{")
    if i == -1:
        return None
    raw = raw[i:]
    depth, in_str, esc = 0, False, False
    end = -1
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


def query(ses_id, start, end, *, extra=None, recv_timeout=10.0):
    """One WS round-trip. Returns list of file records (sentinel stripped)."""
    url = WS_URL.format(ses_id=ses_id)
    ws = create_connection(url, origin=ORIGIN,
                           header=[f"User-Agent: {UA}",
                                   f"Referer: {REFERER}"],
                           timeout=15)
    try:
        req = {
            "parentID": PARENT_ID,
            "shareID": SHARE_ID,
            "sesID": ses_id,
            "startTime": fmt_cftp(start),
            "endTime": fmt_cftp(end),
        }
        if extra:
            req.update(extra)
        ws.send(json.dumps(req))

        records = []
        deadline = time.time() + recv_timeout
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
            if obj.get("fileName") == "LoadCompleted":
                break
            records.append(obj)
        return records
    finally:
        try:
            ws.close()
        except Exception:
            pass


def parse_segment_time(name):
    m = _TS_RE.search(name or "")
    if not m:
        return None
    try:
        return dt.datetime.strptime(m.group(1), "%Y%m%d%H%M%S")
    except ValueError:
        return None


def summarize(records, label):
    print(f"\n--- {label}")
    print(f"  {len(records)} record(s)")
    if not records:
        return
    times = [parse_segment_time(r.get("fileName", "")) for r in records]
    times = [t for t in times if t]
    if times:
        times.sort()
        print(f"  earliest: {times[0]}")
        print(f"  latest:   {times[-1]}")
        if len(times) > 1:
            span_min = (times[-1] - times[0]).total_seconds() / 60
            print(f"  span:     {span_min:.1f} min "
                  f"({len(times)} files over {span_min:.0f}min "
                  f"= ~1 every {span_min/max(1,len(times)-1):.1f}min)")
    fids = [r.get("fileID") for r in records]
    print(f"  fileID range: {min(fids)} … {max(fids)}")
    # show first 3 + last 3 filenames so we see the shape
    sample = records[:3] + ([{"fileName": "..."}] if len(records) > 6 else
                            []) + records[-3:] if len(records) > 6 else records
    for r in sample:
        print(f"    {r.get('fileName')}")


def main():
    ses_id = mint_ses_id()
    now = dt.datetime.now()
    print(f"sesID: {ses_id}")
    print(f"now:   {now}")

    # --- Test 1: tiny window vs huge window, same anchor ----------------
    # If results are independent of window size → server returns "latest N"
    # If they scale with window → server respects time bounds
    five_min  = query(ses_id, now - dt.timedelta(minutes=5),  now)
    summarize(five_min,  "T1a: last 5 minutes")

    one_hour  = query(ses_id, now - dt.timedelta(hours=1),    now)
    summarize(one_hour,  "T1b: last 1 hour")

    six_hours = query(ses_id, now - dt.timedelta(hours=6),    now)
    summarize(six_hours, "T1c: last 6 hours")

    one_day   = query(ses_id, now - dt.timedelta(days=1),     now)
    summarize(one_day,   "T1d: last 24 hours")

    # --- Test 2: same window, fresh sesIDs ------------------------------
    # If fresh sesIDs return different results → sesID has state we're
    # not setting up. If identical → sesID is just an identifier.
    fresh1 = query(mint_ses_id(), now - dt.timedelta(hours=1), now)
    fresh2 = query(mint_ses_id(), now - dt.timedelta(hours=1), now)
    print(f"\n--- T2: two fresh sesIDs, same 1hr window")
    print(f"  fresh1: {len(fresh1)} records, fresh2: {len(fresh2)} records")
    set1 = {r.get("fileID") for r in fresh1}
    set2 = {r.get("fileID") for r in fresh2}
    if set1 == set2:
        print("  → identical results (sesID is stateless identifier)")
    else:
        only1 = set1 - set2
        only2 = set2 - set1
        print(f"  → different: only in fresh1 = {len(only1)}, "
              f"only in fresh2 = {len(only2)}")

    # --- Test 3: window way in the past ---------------------------------
    # If past windows return data → server does honor time bounds
    # If past windows return same "recent N" → server ignores time
    yesterday_noon = now.replace(hour=12, minute=0, second=0) - \
        dt.timedelta(days=1)
    past = query(ses_id,
                 yesterday_noon - dt.timedelta(hours=1),
                 yesterday_noon)
    summarize(past, f"T3: 1hr window around {yesterday_noon} (yesterday noon)")

    # --- Test 4: paging probes ------------------------------------------
    # Try common pagination knobs on a 1-hour window. We compare against
    # `one_hour` from Test 1. Any frame that returns MORE records than
    # one_hour did, or shifts the fileID range, tells us we found the knob.
    print(f"\n--- T4: paging-knob probes (compare to T1b which got "
          f"{len(one_hour)})")
    for label, extra in [
        ("offset=1",          {"offset": 1}),
        ("offset=10",         {"offset": 10}),
        ("pageSize=100",      {"pageSize": 100}),
        ("count=100",         {"count": 100}),
        ("maxResults=100",    {"maxResults": 100}),
        ("limit=100",         {"limit": 100}),
        ("pageIndex=1",       {"pageIndex": 1}),
        ("startIndex=10",     {"startIndex": 10}),
        ("nextID=N",          {"nextFileID": (one_hour[-1].get("fileID")
                                              if one_hour else 0)}),
    ]:
        try:
            r = query(ses_id, now - dt.timedelta(hours=1), now, extra=extra,
                      recv_timeout=6.0)
            fids = {x.get("fileID") for x in r}
            new = fids - {x.get("fileID") for x in one_hour}
            tag = ""
            if len(r) != len(one_hour):
                tag = "  ← DIFFERENT COUNT"
            elif new:
                tag = f"  ← {len(new)} NEW fileIDs"
            print(f"  {label:20s} → {len(r)} records{tag}")
        except Exception as e:
            print(f"  {label:20s} → error: {e}")

    # --- Final read --------------------------------------------------
    print("\n=== INTERPRETATION ===")
    if len(one_day) > len(one_hour) > len(five_min):
        print("Server respects time window. Pagination not needed for "
              "windows we care about. Just query in slices and dedupe.")
    elif len({len(five_min), len(one_hour), len(six_hours),
              len(one_day)}) == 1:
        print(f"Server returned the same count ({len(five_min)}) "
              "regardless of window size. Likely a hard cap per query "
              "— pagination knob is required.")
    else:
        print("Results don't follow window size cleanly. Eyeball the "
              "summaries above to figure out the rule.")


if __name__ == "__main__":
    main()
