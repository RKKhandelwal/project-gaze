"use client";

import { useEffect, useRef, useState } from "react";
import type { Segment, VideoUrlResponse } from "@/lib/types";
import { formatFullDateTimeInTZ } from "@/lib/tz";

interface Props {
  segment: Segment;
  onClose: () => void;
  tz: string;
}

type UrlState =
  | { kind: "loading" }
  | { kind: "ready"; url: string; expiresAt: number }
  | { kind: "error"; message: string; notFound: boolean };

export default function VideoPlayer({ segment, onClose, tz }: Props) {
  const formatTime = (iso: string) => formatFullDateTimeInTZ(iso, tz);
  const [state, setState] = useState<UrlState>({ kind: "loading" });
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState({ kind: "loading" });

    fetch(`/api/video?fileID=${encodeURIComponent(segment.fileID)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw Object.assign(new Error(body?.error || `HTTP ${r.status}`), {
            status: r.status,
          });
        }
        return r.json() as Promise<VideoUrlResponse>;
      })
      .then((res) => {
        if (cancelled) return;
        setState({ kind: "ready", url: res.url, expiresAt: res.expiresAt });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err?.message || "Failed to load video",
          notFound: err?.status === 404,
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [segment.fileID]);

  return (
    <section className="card player-card">
      <div className="player-header">
        <div>
          <div className="card-label">Now playing</div>
          <div className="player-title mono">{segment.fileID}</div>
          <div className="player-meta mono muted">
            {formatTime(segment.start_utc)} · {segment.total_frames} frames ·
            max {segment.max_people} · avg {segment.avg_people.toFixed(1)}
          </div>
        </div>
        <button className="close-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="player-body">
        {state.kind === "loading" && (
          <div className="player-status muted">Loading video…</div>
        )}
        {state.kind === "error" && (
          <div className="player-status">
            {state.notFound
              ? "Video not yet processed."
              : `Couldn't load video: ${state.message}`}
          </div>
        )}
        {state.kind === "ready" && (
          <video
            ref={videoRef}
            src={state.url}
            controls
            autoPlay
            playsInline
            onError={() =>
              setState({
                kind: "error",
                message: "Video failed to load (URL may have expired)",
                notFound: false,
              })
            }
          />
        )}
      </div>
    </section>
  );
}
