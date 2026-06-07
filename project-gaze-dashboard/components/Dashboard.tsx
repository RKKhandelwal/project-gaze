"use client";

import { useEffect, useMemo, useState } from "react";
import type { Segment, DaySummary } from "@/lib/types";
import {
  dayKeyInTZ,
  dayRange,
  formatDateRangeInTZ,
} from "@/lib/tz";
import { useTimezone } from "@/lib/TimezoneContext";
import { useIndexData } from "@/lib/useIndexData";
import DaySelector, { type DayEntry } from "./DaySelector";
import OccupancyChart from "./OccupancyChart";
import WeekSparkline from "./WeekSparkline";
import VideoPlayer from "./VideoPlayer";

export default function Dashboard() {
  const state = useIndexData();
  const { tz } = useTimezone();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedFileID, setSelectedFileID] = useState<string | null>(null);

  // Re-derive day buckets in the currently selected timezone.
  const dailySummary = useMemo<Record<string, DaySummary>>(() => {
    if (state.kind !== "ready") return {};
    const map = new Map<string, DaySummary>();
    for (const [ms, count] of state.data.occupancy_minute) {
      const k = dayKeyInTZ(ms, tz);
      const entry = map.get(k) ?? { max: 0, total_frames: 0, segments: 0 };
      entry.max = Math.max(entry.max, count);
      map.set(k, entry);
    }
    for (const seg of state.data.segments) {
      const k = dayKeyInTZ(new Date(seg.start_utc).getTime(), tz);
      const entry = map.get(k) ?? { max: 0, total_frames: 0, segments: 0 };
      entry.total_frames += seg.total_frames;
      entry.segments += 1;
      map.set(k, entry);
    }
    return Object.fromEntries(map);
  }, [state, tz]);

  const populatedDays = useMemo(
    () => Object.keys(dailySummary).sort(),
    [dailySummary],
  );

  const dayEntries = useMemo<DayEntry[]>(() => {
    if (populatedDays.length === 0) return [];
    const range = dayRange(
      populatedDays[0],
      populatedDays[populatedDays.length - 1],
    );
    return range.map((k) => ({ key: k, summary: dailySummary[k] ?? null }));
  }, [populatedDays, dailySummary]);

  useEffect(() => {
    if (populatedDays.length === 0) return;
    if (!selectedDay || !populatedDays.includes(selectedDay)) {
      setSelectedDay(populatedDays[0]);
    }
  }, [populatedDays, selectedDay]);

  const filteredOccupancy = useMemo(() => {
    if (state.kind !== "ready" || !selectedDay) return [];
    return state.data.occupancy_minute.filter(
      ([ms]) => dayKeyInTZ(ms, tz) === selectedDay,
    );
  }, [state, selectedDay, tz]);

  const segmentsForDay = useMemo<Segment[]>(() => {
    if (state.kind !== "ready" || !selectedDay) return [];
    return state.data.segments
      .filter(
        (s) =>
          dayKeyInTZ(new Date(s.start_utc).getTime(), tz) === selectedDay,
      )
      .sort(
        (a, b) =>
          new Date(a.start_utc).getTime() - new Date(b.start_utc).getTime(),
      );
  }, [state, selectedDay, tz]);

  const onChartClick = (timestampMs: number) => {
    if (state.kind !== "ready") return;
    const fiveMin = 5 * 60 * 1000;
    let best: { seg: Segment; delta: number } | null = null;
    for (const seg of segmentsForDay) {
      const segMs = new Date(seg.start_utc).getTime();
      const delta = Math.abs(segMs - timestampMs);
      if (delta <= fiveMin && (!best || delta < best.delta)) {
        best = { seg, delta };
      }
    }
    if (best) setSelectedFileID(best.seg.fileID);
  };

  if (state.kind === "loading") {
    return (
      <main className="page">
        <div className="loading">Loading occupancy data…</div>
      </main>
    );
  }

  if (state.kind === "error") {
    const empty = state.status === 404;
    return (
      <main className="page">
        <div className="empty-state">
          <h1>{empty ? "No data yet" : "Couldn't load index"}</h1>
          <p>
            {empty
              ? "Run the pipeline first to generate index.json in R2."
              : state.message}
          </p>
        </div>
      </main>
    );
  }

  const { data } = state;
  const daySummary = selectedDay ? dailySummary[selectedDay] : null;
  const selectedSegment = selectedFileID
    ? data.segments.find((s) => s.fileID === selectedFileID) || null
    : null;

  return (
    <main className="page page-two-col">
      <div className="col-left">
        <section className="card sparkline-card">
          <div className="card-label">
            Week overview
            <span className="card-label-aux mono">
              {formatDateRangeInTZ(
                data.totals.earliest_utc,
                data.totals.latest_utc,
                tz,
              )}
            </span>
          </div>
          <WeekSparkline
            points={data.occupancy_minute}
            tz={tz}
            selectedDay={selectedDay}
            peak={data.totals.peak_occupancy}
            onSelectDay={setSelectedDay}
          />
        </section>

        <section className="day-selector-wrap">
          <DaySelector
            days={dayEntries}
            selected={selectedDay}
            onSelect={setSelectedDay}
            tz={tz}
          />
        </section>

        <section className="card chart-card">
          <div className="chart-header">
            <div>
              <div className="card-label">Occupancy by minute</div>
              <div className="chart-subtitle">
                {selectedDay ?? "No day selected"}
              </div>
            </div>
            {daySummary && (
              <div className="chart-peak mono">peak {daySummary.max}</div>
            )}
          </div>
          <OccupancyChart
            points={filteredOccupancy}
            peak={daySummary?.max ?? 0}
            onPointClick={onChartClick}
            tz={tz}
            selectedDay={selectedDay}
          />
        </section>
      </div>

      <aside className="col-right">
        {selectedSegment ? (
          <VideoPlayer
            segment={selectedSegment}
            onClose={() => setSelectedFileID(null)}
            tz={tz}
          />
        ) : (
          <div className="card video-placeholder">
            <div className="card-label">Video</div>
            <div className="placeholder-body">
              <div className="placeholder-icon" aria-hidden>
                ▶
              </div>
              <p>Click anywhere on the occupancy chart to load the closest segment&apos;s overlay video here.</p>
              <p className="muted small">
                {segmentsForDay.length} segments available on{" "}
                {selectedDay ?? "—"}
              </p>
            </div>
          </div>
        )}
      </aside>
    </main>
  );
}
