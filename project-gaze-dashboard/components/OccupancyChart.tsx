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
import { dayBoundariesInTZ, formatHMInTZ } from "@/lib/tz";

interface Props {
  points: OccupancyPoint[];
  peak: number;
  onPointClick: (timestampMs: number) => void;
  tz: string;
  selectedDay: string | null;
}

interface ChartDatum {
  t: number;
  count: number | null;
}

// A "gap" = adjacent minute samples more than GAP_MS apart.
// Minute samples are nominally 60s; >90s means at least one full minute missing.
const GAP_MS = 90_000;

function buildSeriesAndGaps(
  points: OccupancyPoint[],
  dayStart: number,
  dayEnd: number,
): { series: ChartDatum[]; gaps: Array<[number, number]> } {
  const series: ChartDatum[] = [];
  const gaps: Array<[number, number]> = [];

  if (points.length === 0) {
    // Whole day is a gap, but we still need data points to render the axis.
    series.push({ t: dayStart, count: null });
    series.push({ t: dayEnd, count: null });
    gaps.push([dayStart, dayEnd]);
    return { series, gaps };
  }

  const first = points[0][0];
  const last = points[points.length - 1][0];

  if (first - dayStart > 60_000) {
    gaps.push([dayStart, first]);
    series.push({ t: dayStart, count: null });
  }

  for (let i = 0; i < points.length; i++) {
    const [t, c] = points[i];
    if (i > 0) {
      const prev = points[i - 1][0];
      if (t - prev > GAP_MS) {
        // Insert a null break so the area/line doesn't connect across the gap.
        series.push({ t: prev + 1, count: null });
        gaps.push([prev + 60_000, t]);
      }
    }
    series.push({ t, count: c });
  }

  if (dayEnd - last > 60_000) {
    series.push({ t: last + 1, count: null });
    series.push({ t: dayEnd, count: null });
    gaps.push([last + 60_000, dayEnd]);
  }

  return { series, gaps };
}

export default function OccupancyChart({
  points,
  peak,
  onPointClick,
  tz,
  selectedDay,
}: Props) {
  const { series, gaps, dayStart, dayEnd } = useMemo(() => {
    if (!selectedDay) {
      return { series: [], gaps: [], dayStart: 0, dayEnd: 0 };
    }
    const [start, end] = dayBoundariesInTZ(selectedDay, tz);
    const { series, gaps } = buildSeriesAndGaps(points, start, end);
    return { series, gaps, dayStart: start, dayEnd: end };
  }, [points, selectedDay, tz]);

  const formatHM = (ms: number) => formatHMInTZ(ms, tz);
  const hasData = points.length > 0;

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart
          data={series}
          margin={{ top: 12, right: 16, bottom: 12, left: 0 }}
          onClick={(e) => {
            const payload = (
              e as { activePayload?: Array<{ payload: ChartDatum }> }
            )?.activePayload?.[0]?.payload;
            if (payload && typeof payload.t === "number" && payload.count != null) {
              onPointClick(payload.t);
            }
          }}
        >
          <defs>
            <linearGradient id="occGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
            <pattern
              id="noDataStripe"
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
            domain={
              selectedDay ? [dayStart, dayEnd] : (["dataMin", "dataMax"] as const)
            }
            tickFormatter={formatHM}
            stroke="#64748b"
            tick={{
              fill: "#64748b",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
            tickLine={false}
            axisLine={{ stroke: "#1e293b" }}
            minTickGap={48}
          />
          <YAxis
            stroke="#64748b"
            tick={{
              fill: "#64748b",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
            tickLine={false}
            axisLine={{ stroke: "#1e293b" }}
            allowDecimals={false}
            width={36}
            domain={[0, "auto"]}
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
            labelFormatter={(label) =>
              typeof label === "number" ? formatHM(label) : String(label)
            }
            formatter={(value: number | string) =>
              value == null ? ["no data", ""] : [value, "people"]
            }
            cursor={{ stroke: "#22d3ee", strokeOpacity: 0.4 }}
          />

          {/* Shaded "no data" regions */}
          {gaps.map(([g1, g2]) => (
            <ReferenceArea
              key={`gap-${g1}`}
              x1={g1}
              x2={g2}
              fill="url(#noDataStripe)"
              stroke="none"
              ifOverflow="visible"
            />
          ))}

          {peak > 0 && (
            <ReferenceLine
              y={peak}
              stroke="#ef4444"
              strokeDasharray="4 4"
              label={{
                value: `peak ${peak}`,
                position: "insideTopRight",
                fill: "#ef4444",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
            />
          )}
          <Area
            type="stepAfter"
            dataKey="count"
            stroke="#22d3ee"
            strokeWidth={2}
            fill="url(#occGradient)"
            isAnimationActive={false}
            connectNulls={false}
            activeDot={{
              r: 4,
              fill: "#22d3ee",
              stroke: "#0a0e17",
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
      {!hasData && (
        <div className="chart-empty muted">No occupancy data on this day.</div>
      )}
      {hasData && gaps.length > 0 && (
        <div className="chart-legend muted mono">
          <span className="legend-swatch legend-nodata" /> no data captured
        </div>
      )}
    </div>
  );
}
