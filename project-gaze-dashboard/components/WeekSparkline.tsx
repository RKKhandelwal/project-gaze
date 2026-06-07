"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OccupancyPoint } from "@/lib/types";
import { dayKeyInTZ, weekdayForDayKey, shortDateForDayKey } from "@/lib/tz";

interface Props {
  points: OccupancyPoint[];
  tz: string;
  selectedDay: string | null;
  peak: number;
  onSelectDay: (day: string) => void;
}

interface DayMeta {
  key: string;
  start: number;
  end: number;
}

interface SeriesDatum {
  t: number;
  count: number | null;
}

// At week zoom, gaps shorter than ~5 minutes are pixel-invisible noise.
// Only treat anything >= 5 minutes apart as a "gap" worth marking.
const GAP_MS = 5 * 60_000;

function buildSeriesAndGaps(points: OccupancyPoint[]) {
  const series: SeriesDatum[] = [];
  const gaps: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i++) {
    const [t, c] = points[i];
    if (i > 0) {
      const prev = points[i - 1][0];
      if (t - prev > GAP_MS) {
        series.push({ t: prev + 1, count: null });
        gaps.push([prev + 60_000, t]);
      }
    }
    series.push({ t, count: c });
  }
  return { series, gaps };
}

export default function WeekSparkline({
  points,
  tz,
  selectedDay,
  peak,
  onSelectDay,
}: Props) {
  const { series, gaps } = useMemo(
    () => buildSeriesAndGaps(points),
    [points],
  );

  const dayMetas = useMemo<DayMeta[]>(() => {
    const map = new Map<string, { start: number; end: number }>();
    for (const [ms] of points) {
      const k = dayKeyInTZ(ms, tz);
      const cur = map.get(k);
      if (!cur) map.set(k, { start: ms, end: ms });
      else {
        if (ms < cur.start) cur.start = ms;
        if (ms > cur.end) cur.end = ms;
      }
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.start - b.start);
  }, [points, tz]);

  const selected = selectedDay
    ? dayMetas.find((d) => d.key === selectedDay)
    : null;

  const tooltipLabel = (ms: number) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));

  return (
    <div className="sparkline">
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart
          data={series}
          margin={{ top: 8, right: 8, bottom: 20, left: 0 }}
          onClick={(e) => {
            const payload = (
              e as {
                activePayload?: Array<{ payload: SeriesDatum }>;
              }
            )?.activePayload?.[0]?.payload;
            if (payload && typeof payload.t === "number") {
              onSelectDay(dayKeyInTZ(payload.t, tz));
            }
          }}
        >
          <defs>
            <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
            <pattern
              id="sparkNoDataStripe"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="#1e293b" fillOpacity="0.5" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="#475569"
                strokeWidth="1"
                strokeOpacity="0.5"
              />
            </pattern>
          </defs>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            ticks={dayMetas.map((d) => d.start)}
            tickFormatter={(ms: number) => {
              const k = dayKeyInTZ(ms, tz);
              return `${weekdayForDayKey(k, tz)} ${shortDateForDayKey(k)}`;
            }}
            stroke="#64748b"
            tick={{
              fill: "#64748b",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
            tickLine={false}
            axisLine={{ stroke: "#1e293b" }}
          />
          <YAxis hide domain={[0, "auto"]} />
          <Tooltip
            contentStyle={{
              background: "#0a0e17",
              border: "1px solid #1e293b",
              borderRadius: 6,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "#e2e8f0",
            }}
            labelFormatter={(label) =>
              typeof label === "number" ? tooltipLabel(label) : String(label)
            }
            formatter={(value: number | string) =>
              value == null ? ["no data", ""] : [value, "people"]
            }
            cursor={{ stroke: "#22d3ee", strokeOpacity: 0.4 }}
          />

          {/* No-data shading for gaps within the recorded span */}
          {gaps.map(([g1, g2]) => (
            <ReferenceArea
              key={`spark-gap-${g1}`}
              x1={g1}
              x2={g2}
              fill="url(#sparkNoDataStripe)"
              stroke="none"
              ifOverflow="visible"
            />
          ))}

          {/* Day boundary separators */}
          {dayMetas.slice(1).map((d) => (
            <ReferenceLine
              key={`boundary-${d.key}`}
              x={d.start}
              stroke="#1e293b"
              strokeDasharray="2 4"
            />
          ))}

          {/* Highlight the selected day */}
          {selected && (
            <ReferenceArea
              x1={selected.start}
              x2={selected.end}
              fill="#22d3ee"
              fillOpacity={0.06}
              stroke="#22d3ee"
              strokeOpacity={0.4}
              strokeDasharray="3 3"
            />
          )}

          {peak > 0 && (
            <ReferenceLine
              y={peak}
              stroke="#ef4444"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
            />
          )}

          <Area
            type="stepAfter"
            dataKey="count"
            stroke="#22d3ee"
            strokeWidth={1.75}
            fill="url(#sparkGradient)"
            isAnimationActive={false}
            connectNulls={false}
            activeDot={{
              r: 3,
              fill: "#22d3ee",
              stroke: "#0a0e17",
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
