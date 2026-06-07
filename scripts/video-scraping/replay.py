#!/usr/bin/env python3
"""
Replay the EXACT sequence the browser does:
  1. Bootstrap frame: dtStartTime=01/01/2000..., search="1", maxItems="0"
  2. Real query:      dtStartTime=NOW, search="0", maxItems="5", fileID="0"

Then dump every byte the server replies with so we can see what changes.

The earlier probes used different field shapes and got 1-record replies.
Our archive.py used the right shape but got 0 records. The difference
might be: missing the bootstrap, or our dtStartTime is too far in the past.
"""
from __future__ import annotations
import datetime as dt
import json
import random
import string
import struct
import sys
import time

try:
    from websocket import create_connection
except ImportError:
    print("pip install websocket-client"); sys.exit(2)

PARENT_ID = "399899011"
SHARE_ID = "17956664"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36")
ORIGIN = "https://www.cameraftp.com"
REFERER = (f"{ORIGIN}/Camera/Cameraplayer.aspx"
           f"?parentID={PARENT_ID}&shareID={SHARE_ID}&isEmbedded=true")


def mint():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=24))


def show_frame(direction, raw):
    if isinstance(raw, bytes):
        # Strip the 4-byte length prefix the server uses
        if len(raw) >= 4:
            length = struct.unpack("<I", raw[:4])[0]
            body = raw[4:4+length]
            try:
                obj = json.loads(body.decode("utf-8", "replace"))
                tail = len(raw) - 4 - length
                tail_info = f"  + {tail}B tail" if tail > 0 else ""
                print(f"  {direction} [{len(raw)}B, len={length}{tail_info}]")
                print(f"    {json.dumps(obj)[:400]}")
                return
            except Exception:
                pass
        print(f"  {direction} [{len(raw)}B] raw: {raw[:200]!r}")
    else:
        print(f"  {direction} [{len(raw)}B] {raw[:400]}")


def send_and_drain(ws, label, frame, drain_seconds=2.0):
    print(f"\n>>> {label}")
    print(f"    {json.dumps(frame)}")
    ws.send(json.dumps(frame))
    deadline = time.time() + drain_seconds
    got = 0
    while time.time() < deadline:
        try:
            ws.settimeout(max(0.2, deadline - time.time()))
            data = ws.recv()
        except Exception:
            break
        if not data:
            continue
        got += 1
        show_frame("←", data)
    if got == 0:
        print("    (no replies)")


def main():
    ses_id = mint()
    now_utc = dt.datetime.utcnow()
    fmt = lambda t: (f"{t.month}/{t.day}/{t.year} "
                     f"{t.hour}:{t.minute}:{t.second}."
                     f"{t.microsecond // 1000:03d}")
    print(f"sesID: {ses_id}")
    print(f"now UTC: {now_utc}")

    ws = create_connection(
        f"wss://www.cameraftp.com/api/camera/WSGetCameraFilesHandler.ashx"
        f"?sesID={ses_id}",
        origin=ORIGIN,
        header=[f"User-Agent: {UA}", f"Referer: {REFERER}"],
        timeout=15,
    )
    try:
        # Step 1: bootstrap (this is what the browser sent first)
        bootstrap = {
            "Code": 0, "Message": "", "cameraPath": "",
            "dtStartTime": fmt(dt.datetime(2000, 1, 1, now_utc.hour,
                                            now_utc.minute, now_utc.second)),
            "search": "1",
            "fileID": "0", "parentID": PARENT_ID, "maxItems": "0",
            "shareID": SHARE_ID, "offset": 0, "returnType": 0,
        }
        send_and_drain(ws, "BOOTSTRAP frame", bootstrap, drain_seconds=2.5)

        # Step 2: real query for NOW
        now_query = {
            "Code": 0, "Message": "", "cameraPath": "",
            "dtStartTime": fmt(now_utc),
            "search": "0",
            "fileID": "0", "parentID": PARENT_ID, "maxItems": "5",
            "shareID": SHARE_ID, "offset": 0, "returnType": 0,
        }
        send_and_drain(ws, "REAL QUERY @ now", now_query, drain_seconds=2.5)

        # Step 3: real query for 1 hour ago (well inside data window)
        past = now_utc - dt.timedelta(hours=1)
        past_query = dict(now_query, dtStartTime=fmt(past))
        send_and_drain(ws, "REAL QUERY @ 1h ago", past_query,
                       drain_seconds=2.5)

        # Step 4: same as #3 but maxItems="100" to see if server honors it
        big_query = dict(past_query, maxItems="100")
        send_and_drain(ws, "REAL QUERY @ 1h ago, maxItems=100", big_query,
                       drain_seconds=3.0)

        # Step 5: cursor walk — use the fileID we got back (if any)
        # The replay code at the bottom will handle this manually based on
        # what came back.
    finally:
        try:
            ws.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
