"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useIndexData } from "@/lib/useIndexData";
import { useTimezone } from "@/lib/TimezoneContext";
import {
  dayKeyInTZ,
  formatFullDateTimeInTZ,
  weekdayForDayKey,
} from "@/lib/tz";
import StatCard from "./StatCard";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ACCENT = "#22d3ee";
const ACCENT_DIM = "#0e7490";
const PEAK = "#ef4444";

interface PartsCache {
  hour: number;
  weekday: number; // 0=Sun ... 6=Sat
}

function partsInTZ(ms: number, tz: string): PartsCache {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const weekday = WEEKDAY_LABELS.indexOf(weekdayStr);
  // Intl can give "24" for hour at midnight in some locales — normalize.
  let hour = parseInt(hourStr, 10);
  if (hour === 24) hour = 0;
  return { hour, weekday: weekday < 0 ? 0 : weekday };
}

export default function Insights() {
  const state = useIndexData();
  const { tz } = useTimezone();

  const derived = useMemo(() => {
    if (state.kind !== "ready") return null;
    const { occupancy_minute, segments, totals } = state.data;

    // Aggregate per-minute occupancy by hour-of-day and weekday in the
    // selected timezone. Each `count` represents people in that minute, so
    // summing yields person-minutes.
    const hourSum = new Array(24).fill(0);
    const hourMax = new Array(24).fill(0);
    const hourCount = new Array(24).fill(0);

    const dowSum = new Array(7).fill(0);
    const dowMax = new Array(7).fill(0);
    const dowCount = new Array(7).fill(0);

    // Histogram bins for "how many people on the courts at once?"
    const bins = [
      { label: "0", min: 0, max: 0, count: 0 },
      { label: "1–2", min: 1, max: 2, count: 0 },
      { label: "3–5", min: 3, max: 5, count: 0 },
      { label: "6–10", min: 6, max: 10, count: 0 },
      { label: "11+", min: 11, max: Infinity, count: 0 },
    ];

    let totalPersonMinutes = 0;
    let activeMinutes = 0;

    for (const [ms, count] of occupancy_minute) {
      const { hour, weekday } = partsInTZ(ms, tz);
      hourSum[hour] += count;
      hourCount[hour] += 1;
      hourMax[hour] = Math.max(hourMax[hour], count);

      dowSum[weekday] += count;
      dowCount[weekday] += 1;
      dowMax[weekday] = Math.max(dowMax[weekday], count);

      totalPersonMinutes += count;
      if (count > 0) activeMinutes += 1;

      for (const b of bins) {
        if (count >= b.min && count <= b.max) {
          b.count += 1;
          break;
        }
      }
    }

    const hourly = hourSum.map((sum, h) => ({
      hour: h,
      label: `${String(h).padStart(2, "0")}`,
      avg: hourCount[h] ? sum / hourCount[h] : 0,
      peak: hourMax[h],
      minutes: hourCount[h],
    }));

    const dow = dowSum.map((sum, w) => ({
      weekday: w,
      label: WEEKDAY_LABELS[w],
      avg: dowCount[w] ? sum / dowCount[w] : 0,
      peak: dowMax[w],
      minutes: dowCount[w],
    }));

    // Busiest hour: highest avg occupancy.
    const busiestHour = hourly.reduce(
      (best, h) => (h.avg > best.avg ? h : best),
      hourly[0] ?? { label: "—", avg: 0, peak: 0, hour: 0, minutes: 0 },
    );

    // Busiest day-of-week: highest avg occupancy.
    const busiestDow = dow.reduce(
      (best, d) => (d.avg > best.avg ? d : best),
      dow[0] ?? { label: "—", avg: 0, peak: 0, weekday: 0, minutes: 0 },
    );

    // Top 8 busiest segments by max_people.
    const topSegments = [...segments]
      .sort((a, b) => b.max_people - a.max_people || b.avg_people - a.avg_people)
      .slice(0, 8);

    // Daily peaks (date string + max) — re-bucket in tz.
    const dailyPeakMap = new Map<string, number>();
    for (const [ms, count] of occupancy_minute) {
      const k = dayKeyInTZ(ms, tz);
      const prev = dailyPeakMap.get(k) ?? 0;
      if (count > prev) dailyPeakMap.set(k, count);
    }
    const dailyPeaks = [...dailyPeakMap.entries()]
      .map(([key, peak]) => ({ key, label: weekdayForDayKey(key, tz), peak }))
      .sort((a, b) => a.key.localeCompare(b.key));

    return {
      totals,
      hourly,
      dow,
      bins,
      busiestHour,
      busiestDow,
      topSegments,
      dailyPeaks,
      totalPersonMinutes,
      activeMinutes,
      coveredMinutes: occupancy_minute.length,
    };
  }, [state, tz]);

  if (state.kind === "loading") {
    return (
      <main className="page">
        <div className="loading">Loading insights…</div>
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

  if (!derived) return null;
  const {
    totals,
    hourly,
    dow,
    bins,
    busiestHour,
    busiestDow,
    topSegments,
    dailyPeaks,
    totalPersonMinutes,
    activeMinutes,
    coveredMinutes,
  } = derived;

  const utilization =
    coveredMinutes > 0 ? activeMinutes / coveredMinutes : 0;

  return (
    <main className="page">
      <section className="stats-row">
        <StatCard
          label="Peak occupancy"
          value={totals.peak_occupancy}
          accent="peak"
        />
        <StatCard
          label="Total person-minutes"
          value={totalPersonMinutes.toLocaleString()}
          sub={`${(totalPersonMinutes / 60).toFixed(1)} person-hours`}
        />
        <StatCard
          label="Busiest hour"
          value={`${String(busiestHour.hour).padStart(2, "0")}:00`}
          sub={`avg ${busiestHour.avg.toFixed(1)} · peak ${busiestHour.peak}`}
          accent="accent"
        />
        <StatCard
          label="Busiest day"
          value={busiestDow.label}
          sub={`avg ${busiestDow.avg.toFixed(1)} · peak ${busiestDow.peak}`}
          accent="accent"
        />
      </section>

      <section className="card insights-card">
        <div className="card-label">
          Hour of day
          <span className="card-label-aux mono">
            avg vs peak occupancy across all days
          </span>
        </div>
        <div className="insights-chart">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={hourly}
              margin={{ top: 12, right: 12, bottom: 12, left: 0 }}
              barGap={2}
            >
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#64748b"
                tick={{
                  fill: "#64748b",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
                tickLine={false}
                axisLine={{ stroke: "#1e293b" }}
                interval={1}
              />
              <YAxis
                stroke="#64748b"
                tick={{
                  fill: "#64748b",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
                tickLine={false}
                axisLine={{ stroke: "#1e293b" }}
                allowDecimals={false}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  background: "#0a0e17",
                  border: "1px solid #1e293b",
                  borderRadius: 6,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "#e2e8f0",
                }}
                cursor={{ fill: "rgba(34,211,238,0.06)" }}
                formatter={(value: number | string, name: string) => [
                  typeof value === "number" ? value.toFixed(1) : value,
                  name,
                ]}
                labelFormatter={(l) => `${l}:00`}
              />
              <Bar dataKey="peak" name="peak" fill={ACCENT_DIM} radius={[2, 2, 0, 0]} />
              <Bar dataKey="avg" name="avg" fill={ACCENT} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="insights-row">
        <section className="card insights-card">
          <div className="card-label">Day of week</div>
          <div className="insights-chart">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={dow}
                margin={{ top: 12, right: 12, bottom: 12, left: 0 }}
                barGap={2}
              >
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#64748b"
                  tick={{
                    fill: "#64748b",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  }}
                  tickLine={false}
                  axisLine={{ stroke: "#1e293b" }}
                />
                <YAxis
                  stroke="#64748b"
                  tick={{
                    fill: "#64748b",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  }}
                  tickLine={false}
                  axisLine={{ stroke: "#1e293b" }}
                  allowDecimals={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0a0e17",
                    border: "1px solid #1e293b",
                    borderRadius: 6,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "#e2e8f0",
                  }}
                  cursor={{ fill: "rgba(34,211,238,0.06)" }}
                  formatter={(value: number | string, name: string) => [
                    typeof value === "number" ? value.toFixed(1) : value,
                    name,
                  ]}
                />
                <Bar dataKey="peak" name="peak" fill={ACCENT_DIM} radius={[2, 2, 0, 0]} />
                <Bar dataKey="avg" name="avg" fill={ACCENT} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card insights-card">
          <div className="card-label">
            Crowd-size distribution
            <span className="card-label-aux mono">
              fraction of recorded minutes
            </span>
          </div>
          <div className="insights-chart">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={bins.map((b) => ({
                  ...b,
                  pct: coveredMinutes
                    ? (b.count / coveredMinutes) * 100
                    : 0,
                }))}
                margin={{ top: 12, right: 12, bottom: 12, left: 0 }}
              >
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#64748b"
                  tick={{
                    fill: "#64748b",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  }}
                  tickLine={false}
                  axisLine={{ stroke: "#1e293b" }}
                />
                <YAxis
                  stroke="#64748b"
                  tick={{
                    fill: "#64748b",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  }}
                  tickLine={false}
                  axisLine={{ stroke: "#1e293b" }}
                  tickFormatter={(v) => `${v}%`}
                  width={36}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0a0e17",
                    border: "1px solid #1e293b",
                    borderRadius: 6,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "#e2e8f0",
                  }}
                  cursor={{ fill: "rgba(34,211,238,0.06)" }}
                  formatter={(value: number | string, _name, ctx) => {
                    const minutes = (ctx?.payload as { count?: number })?.count ?? 0;
                    return [
                      `${typeof value === "number" ? value.toFixed(1) : value}% · ${minutes} min`,
                      "share",
                    ];
                  }}
                />
                <Bar dataKey="pct" radius={[2, 2, 0, 0]}>
                  {bins.map((b, i) => (
                    <Cell
                      key={b.label}
                      fill={i === 0 ? "#334155" : i >= 3 ? PEAK : ACCENT}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="insights-foot mono muted">
            Court utilization:{" "}
            <span className="strong">{(utilization * 100).toFixed(0)}%</span>{" "}
            of recorded minutes had ≥1 person
          </div>
        </section>
      </div>

      <section className="card insights-card">
        <div className="card-label">Daily peak occupancy</div>
        <div className="insights-chart">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={dailyPeaks}
              margin={{ top: 12, right: 12, bottom: 12, left: 0 }}
            >
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="key"
                stroke="#64748b"
                tick={{
                  fill: "#64748b",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
                tickLine={false}
                axisLine={{ stroke: "#1e293b" }}
                tickFormatter={(k: string) => {
                  const entry = dailyPeaks.find((d) => d.key === k);
                  return entry ? `${entry.label} ${k.slice(5)}` : k;
                }}
              />
              <YAxis
                stroke="#64748b"
                tick={{
                  fill: "#64748b",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
                tickLine={false}
                axisLine={{ stroke: "#1e293b" }}
                allowDecimals={false}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  background: "#0a0e17",
                  border: "1px solid #1e293b",
                  borderRadius: 6,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "#e2e8f0",
                }}
                cursor={{ fill: "rgba(34,211,238,0.06)" }}
                formatter={(value) => [value, "peak"]}
              />
              <Bar dataKey="peak" fill={ACCENT} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card insights-card">
        <div className="card-label">Busiest segments</div>
        <div className="busy-list">
          {topSegments.map((seg, i) => (
            <div className="busy-row" key={seg.fileID}>
              <span className="busy-rank mono muted">#{i + 1}</span>
              <span className="busy-time mono">
                {formatFullDateTimeInTZ(seg.start_utc, tz)}
              </span>
              <span className="busy-stats mono">
                <span className="busy-peak">{seg.max_people}</span>
                <span className="muted small">peak</span>
                <span className="busy-avg">{seg.avg_people.toFixed(1)}</span>
                <span className="muted small">avg</span>
                <span className="busy-frames muted small">
                  {seg.total_frames} frames
                </span>
              </span>
              <span className="busy-id mono muted small">{seg.fileID}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
