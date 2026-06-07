#!/usr/bin/env python3
"""
v2 dumper. The v1 run showed the server understands our frames (it replies
with LoadCompleted sentinel records) but always returns zero real files.
So the *envelope* is right; the *contents* aren't matching anything.

This version tries three new angles:
  1. Prime per-sesID state via HTTP first — hit gettimelinejson.aspx with
     the same sesID before opening the WS, like the real browser does
  2. Add a 'type' / 'opType' discriminator field — many DriveHQ-style
     handlers route on this
  3. Try .NET ticks (100ns intervals since 0001-01-01) as the time format,
     since the LoadCompleted response uses .NET DateTime ISO format
  4. Try shifting the window further back — maybe "last 5 minutes" has no
     footage but yesterday at noon does

Run:
  python ws_dump2.py
  python ws_dump2.py --hours-ago 12     # query 12 hours ago instead
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import string
import sys
import threading
import time

import requests

try:
    from websocket import WebSocketApp
except ImportError:
    print("pip install websocket-client", file=sys.stderr)
    sys.exit(2)


PARENT_ID = "399899011"
SHARE_ID = "17956664"

WS_URL = (
    "wss://www.cameraftp.com/api/camera/WSGetCameraFilesHandler.ashx"
    "?sesID={ses_id}"
)
TIMELINE_URL = "https://www.cameraftp.com/api/camera/gettimelinejson.aspx"
EVENTS_URL = "https://www.cameraftp.com/api/camera/GetAlarmEvents.aspx"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36")
ORIGIN = "https://www.cameraftp.com"
REFERER = (f"{ORIGIN}/Camera/Cameraplayer.aspx"
           f"?parentID={PARENT_ID}&shareID={SHARE_ID}&isEmbedded=true")


def mint_ses_id() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=24))


def fmt_cftp(t: dt.datetime) -> str:
    return f"{t.month}/{t.day}/{t.year} {t.hour}:{t.minute}:{t.second}"


def to_dotnet_ticks(t: dt.datetime) -> int:
    """.NET DateTime ticks = 100-nanosecond intervals since 0001-01-01.
    Reference epoch in Python: 621355968000000000 ticks at 1970-01-01 UTC."""
    epoch_ticks = 621355968000000000
    ts_ns = int(t.timestamp() * 10_000_000)  # 100ns intervals since 1970
    return epoch_ticks + ts_ns


def prime_via_http(ses_id: str, start: dt.datetime, end: dt.datetime,
                   verbose: bool) -> None:
    """Hit gettimelinejson.aspx and GetAlarmEvents.aspx with our sesID,
    same as the browser does before opening the WS. The point isn't the
    response data — it's whether the server primes some sesID-keyed state
    that the WS handler will look up later."""
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Referer": REFERER,
                      "X-Requested-With": "XMLHttpRequest"})

    params = {
        "sesID": ses_id, "cameraID": PARENT_ID, "shareID": SHARE_ID,
        "startTime": fmt_cftp(start), "endTime": fmt_cftp(end),
        "unit": "1min",
        "t": int(time.time() * 1000),
    }
    try:
        r = s.get(TIMELINE_URL, params=params, timeout=15)
        if verbose:
            print(f"[http] gettimelinejson → {r.status_code} "
                  f"{len(r.content)}B")
            if r.headers.get("content-type", "").startswith("application/json"):
                try:
                    body = r.json()
                    rendered = json.dumps(body)[:300]
                    print(f"[http]   body: {rendered}")
                except Exception:
                    pass
    except Exception as e:
        print(f"[http] gettimelinejson failed: {e}")

    params2 = {
        "sesID": ses_id, "cameraID": PARENT_ID, "shareID": SHARE_ID,
        "StartDate": fmt_cftp(start), "EndDate": fmt_cftp(end),
        "client": "browser",
        "t": int(time.time() * 1000),
    }
    try:
        r = s.get(EVENTS_URL, params=params2, timeout=15)
        if verbose:
            print(f"[http] GetAlarmEvents → {r.status_code} "
                  f"{len(r.content)}B")
    except Exception as e:
        print(f"[http] GetAlarmEvents failed: {e}")


def build_frames(start: dt.datetime, end: dt.datetime,
                 ses_id: str) -> list:
    start_str = fmt_cftp(start)
    end_str = fmt_cftp(end)
    start_ticks = to_dotnet_ticks(start)
    end_ticks = to_dotnet_ticks(end)

    return [
        # Shape G: discriminator field "type"
        {"type": "getFiles", "cameraID": PARENT_ID, "shareID": SHARE_ID,
         "sesID": ses_id, "startTime": start_str, "endTime": end_str},

        # Shape H: "opType" — DriveHQ's other handlers use this
        {"opType": "getFiles", "cameraID": PARENT_ID, "shareID": SHARE_ID,
         "sesID": ses_id, "startTime": start_str, "endTime": end_str},

        # Shape I: .NET ticks for time
        {"cameraID": PARENT_ID, "shareID": SHARE_ID, "sesID": ses_id,
         "startTime": start_ticks, "endTime": end_ticks},

        # Shape J: ISO 8601 like the LoadCompleted record showed
        {"cameraID": PARENT_ID, "shareID": SHARE_ID, "sesID": ses_id,
         "startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
         "endTime": end.strftime("%Y-%m-%dT%H:%M:%SZ")},

        # Shape K: file-record-shaped query (the response is shaped like
        # a file record, so maybe the request mirrors that schema)
        {"cameraID": PARENT_ID, "shareID": SHARE_ID, "sesID": ses_id,
         "datetime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
         "filetime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
         "fileType": 0},

        # Shape L: with explicit fileType (video=1? image=0?)
        {"type": "getFiles", "cameraID": PARENT_ID, "shareID": SHARE_ID,
         "sesID": ses_id, "startTime": start_str, "endTime": end_str,
         "fileType": 1},

        # Shape M: parentID (the player URL uses parentID, not cameraID)
        {"parentID": PARENT_ID, "shareID": SHARE_ID, "sesID": ses_id,
         "startTime": start_str, "endTime": end_str},
    ]


class Dumper:
    def __init__(self, ses_id, frames, duration):
        self.ses_id = ses_id
        self.frames = frames
        self.duration = duration
        self.start_time = time.time()
        self.frame_idx = 0
        self.recv_count = 0
        # Track: did this frame yield anything other than the empty
        # LoadCompleted sentinel? If yes, we may have hit the right shape.
        self.frames_with_real_data: list[int] = []
        self.current_frame_responses: list[str] = []
        self.last_send_t: float | None = None
        self.last_send_label: str | None = None

    def log(self, prefix: str, payload, *, raw_bytes=None):
        ts = time.time() - self.start_time
        if isinstance(payload, (dict, list)):
            rendered = json.dumps(payload, ensure_ascii=False)
        elif isinstance(payload, bytes):
            rendered = payload.decode("utf-8", "replace")
        else:
            rendered = str(payload)
        if len(rendered) > 1000:
            rendered = rendered[:1000] + f"... <+{len(rendered)-1000} more>"
        size = f"[{raw_bytes}B] " if raw_bytes is not None else ""
        print(f"[+{ts:6.2f}s] {prefix} {size}{rendered}", flush=True)

    def send_next_frame(self, ws):
        if self.frame_idx >= len(self.frames):
            return False
        # Score the previous frame's responses before moving on
        if self.last_send_label is not None:
            interesting = any(
                "LoadCompleted" not in r and r.strip()
                for r in self.current_frame_responses
            )
            if interesting:
                self.frames_with_real_data.append(self.frame_idx - 1)
                self.log("** !!", f"shape {self.last_send_label} produced "
                                   f"non-sentinel data!")
            self.current_frame_responses = []

        f = self.frames[self.frame_idx]
        label = chr(ord("G") + self.frame_idx)  # G, H, I, ...
        self.last_send_label = label
        self.log(f"→ SEND  JSON (shape {label})", f)
        ws.send(json.dumps(f))
        self.frame_idx += 1
        self.last_send_t = time.time()
        return True

    def on_open(self, ws):
        self.log("**", f"connected sesID={self.ses_id}")
        self.send_next_frame(ws)

        def pacer():
            while ws.keep_running:
                time.sleep(1)
                now = time.time()
                if (self.last_send_t and now - self.last_send_t > 3 and
                        self.frame_idx < len(self.frames)):
                    self.send_next_frame(ws)
                if now - self.start_time > self.duration:
                    # final scoring pass
                    if self.last_send_label is not None:
                        interesting = any(
                            "LoadCompleted" not in r and r.strip()
                            for r in self.current_frame_responses
                        )
                        if interesting:
                            self.frames_with_real_data.append(self.frame_idx - 1)
                    ws.close()
                    break
        threading.Thread(target=pacer, daemon=True).start()

    def on_message(self, ws, message):
        self.recv_count += 1
        text = message if isinstance(message, str) else \
            message.decode("utf-8", "replace")
        self.current_frame_responses.append(text)
        try:
            parsed = json.loads(text)
            self.log("← RECV  JSON", parsed,
                     raw_bytes=len(text.encode("utf-8")))
        except Exception:
            self.log("← RECV text", text,
                     raw_bytes=len(text.encode("utf-8")))

    def on_error(self, ws, err):
        self.log("!! ERROR", repr(err))

    def on_close(self, ws, code, reason):
        self.log("**", f"closed code={code} reason={reason!r}")
        elapsed = time.time() - self.start_time
        print()
        print("=" * 60)
        print(f"messages: {self.recv_count} over {elapsed:.1f}s")
        print(f"frames sent: {self.frame_idx} of {len(self.frames)}")
        if self.frames_with_real_data:
            labels = [chr(ord("G") + i) for i in self.frames_with_real_data]
            print(f"WINNING SHAPES: {', '.join(labels)}")
        else:
            print("no shape produced real file records "
                  "(all replies were LoadCompleted sentinels)")
        print("=" * 60)


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration", type=float, default=40.0)
    ap.add_argument("--hours-ago", type=float, default=0.0,
                    help="query a window centered N hours ago instead of now")
    ap.add_argument("--window-minutes", type=int, default=60,
                    help="how wide a time window to query (default 60min)")
    ap.add_argument("--ses-id", default=None)
    ap.add_argument("--skip-prime", action="store_true",
                    help="skip the HTTP priming step")
    return ap.parse_args()


def main():
    args = parse_args()

    anchor = dt.datetime.now() - dt.timedelta(hours=args.hours_ago)
    start = anchor - dt.timedelta(minutes=args.window_minutes // 2)
    end = anchor + dt.timedelta(minutes=args.window_minutes // 2)

    ses_id = args.ses_id or mint_ses_id()
    print(f"sesID:  {ses_id}")
    print(f"window: {start:%Y-%m-%d %H:%M:%S} → {end:%Y-%m-%d %H:%M:%S}")
    print()

    if not args.skip_prime:
        print("[priming server state via HTTP]")
        prime_via_http(ses_id, start, end, verbose=True)
        print()

    frames = build_frames(start, end, ses_id)
    dumper = Dumper(ses_id, frames, args.duration)

    ws = WebSocketApp(
        WS_URL.format(ses_id=ses_id),
        header=[f"User-Agent: {UA}", f"Origin: {ORIGIN}",
                f"Referer: {REFERER}"],
        on_open=dumper.on_open,
        on_message=dumper.on_message,
        on_error=dumper.on_error,
        on_close=dumper.on_close,
    )
    try:
        ws.run_forever(ping_interval=20, ping_timeout=10)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
