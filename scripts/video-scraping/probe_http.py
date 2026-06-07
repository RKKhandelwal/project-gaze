#!/usr/bin/env python3
"""
Look at what the HTTP endpoints actually return.

The WebSocket file-list returns 1 file regardless of query — it's not the
segment directory we thought. The browser must figure out which fileIDs
to play some other way. The most likely candidate is gettimelinejson.aspx
returning fileIDs we missed earlier.

This script just hits gettimelinejson.aspx and GetAlarmEvents.aspx across
a few windows and prints the full body of each response, so we can read
the shape directly.

Run:
  pip install requests
  python probe_http.py
"""

from __future__ import annotations

import datetime as dt
import json
import random
import string
import sys
import time

import requests

PARENT_ID = "399899011"
SHARE_ID = "17956664"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36")
REFERER = (f"https://www.cameraftp.com/Camera/Cameraplayer.aspx"
           f"?parentID={PARENT_ID}&shareID={SHARE_ID}&isEmbedded=true")


def mint_ses_id():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=24))


def fmt_cftp(t):
    return f"{t.month}/{t.day}/{t.year} {t.hour}:{t.minute}:{t.second}"


def hit(s, url, params, label):
    print(f"\n--- {label}")
    print(f"  GET {url}")
    print(f"  params: {dict(params)}")
    try:
        r = s.get(url, params=params, timeout=20)
        print(f"  status: {r.status_code}  size: {len(r.content)}B  "
              f"content-type: {r.headers.get('content-type')}")
        text = r.text
        # try to pretty-print JSON; fall back to raw
        try:
            parsed = r.json()
            pretty = json.dumps(parsed, indent=2)
            if len(pretty) > 3000:
                pretty = pretty[:3000] + f"\n  ... <+{len(pretty)-3000} chars>"
            print(f"  body:\n{pretty}")
        except Exception:
            if len(text) > 1500:
                text = text[:1500] + f"... <+{len(text)-1500} chars>"
            print(f"  raw body: {text!r}")
    except Exception as e:
        print(f"  error: {e}")


def main():
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Referer": REFERER,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
    })

    ses_id = mint_ses_id()
    print(f"sesID: {ses_id}")

    now = dt.datetime.now()
    # The HAR captured this exact window: 5/2/2026 6:00 → 7:00 UTC
    # Let's hit several different windows to see how the body shape changes.

    # T1: HAR's exact window — known to contain the segment fileID=13454002929
    har_start = dt.datetime(2026, 5, 2, 6, 0, 0)
    har_end = dt.datetime(2026, 5, 2, 7, 0, 0)
    hit(s, "https://www.cameraftp.com/api/camera/gettimelinejson.aspx", {
        "sesID": ses_id, "cameraID": PARENT_ID, "shareID": SHARE_ID,
        "startTime": fmt_cftp(har_start), "endTime": fmt_cftp(har_end),
        "unit": "1min", "t": int(time.time() * 1000),
    }, "T1: gettimelinejson — HAR's exact window (5/2 06:00→07:00)")

    hit(s, "https://www.cameraftp.com/api/camera/GetAlarmEvents.aspx", {
        "sesID": ses_id, "cameraID": PARENT_ID, "shareID": SHARE_ID,
        "StartDate": fmt_cftp(har_start), "EndDate": fmt_cftp(har_end),
        "client": "browser", "t": int(time.time() * 1000),
    }, "T2: GetAlarmEvents — same window")

    # T3: try parentID instead of cameraID, since that was the WS fix
    hit(s, "https://www.cameraftp.com/api/camera/gettimelinejson.aspx", {
        "sesID": ses_id, "parentID": PARENT_ID, "shareID": SHARE_ID,
        "startTime": fmt_cftp(har_start), "endTime": fmt_cftp(har_end),
        "unit": "1min", "t": int(time.time() * 1000),
    }, "T3: gettimelinejson — same window, parentID instead of cameraID")

    # T4: a recent 1-hour window
    recent_start = now - dt.timedelta(hours=1)
    hit(s, "https://www.cameraftp.com/api/camera/gettimelinejson.aspx", {
        "sesID": ses_id, "cameraID": PARENT_ID, "shareID": SHARE_ID,
        "startTime": fmt_cftp(recent_start), "endTime": fmt_cftp(now),
        "unit": "1min", "t": int(time.time() * 1000),
    }, "T4: gettimelinejson — last 1 hour, unit=1min")

    # T5: same window with different `unit` values, since the player might
    # zoom in/out using this
    for unit in ("1sec", "1hour", "1day"):
        hit(s, "https://www.cameraftp.com/api/camera/gettimelinejson.aspx", {
            "sesID": ses_id, "cameraID": PARENT_ID, "shareID": SHARE_ID,
            "startTime": fmt_cftp(recent_start), "endTime": fmt_cftp(now),
            "unit": unit, "t": int(time.time() * 1000),
        }, f"T5: gettimelinejson — last 1 hour, unit={unit}")

    # T6: see if there's a "list files" REST endpoint we haven't tried.
    # DriveHQ exposes /api/camera/GetCameraFiles.aspx and similar in some
    # versions of the product.
    for path in (
        "/api/camera/GetCameraFiles.aspx",
        "/api/camera/GetFiles.aspx",
        "/api/camera/getfiles.aspx",
        "/api/camera/getFiles.aspx",
        "/api/camera/GetVideoList.aspx",
        "/api/camera/getvideolist.aspx",
    ):
        hit(s, f"https://www.cameraftp.com{path}", {
            "sesID": ses_id, "cameraID": PARENT_ID, "shareID": SHARE_ID,
            "parentID": PARENT_ID,
            "startTime": fmt_cftp(har_start), "endTime": fmt_cftp(har_end),
            "t": int(time.time() * 1000),
        }, f"T6: probing {path}")


if __name__ == "__main__":
    main()
