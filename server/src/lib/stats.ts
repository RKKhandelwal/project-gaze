type EventRow = { event_name: string; timestamp: string };

type Bucket = { occupied: number; total: number };

function pct(occupied: number, total: number): number | null {
  return total > 0 ? Math.round((occupied / total) * 100) : null;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export function buildUsageStats(rows: EventRow[], days: number) {
  if (rows.length === 0) return null;

  const buckets: Bucket[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ occupied: 0, total: 0 })),
  );

  for (const row of rows) {
    const ts = new Date(row.timestamp);
    if (Number.isNaN(ts.getTime())) continue;
    const dow = (ts.getUTCDay() + 6) % 7;
    const hour = ts.getUTCHours();
    buckets[dow][hour].total += 1;
    if (row.event_name === "court_occupied") buckets[dow][hour].occupied += 1;
  }

  const heatmap = buckets.map((row) => row.map((b) => pct(b.occupied, b.total)));

  const hourAvg = Array.from({ length: 24 }, (_, hour) => {
    const totals = buckets.reduce(
      (acc, row) => {
        acc.occupied += row[hour].occupied;
        acc.total += row[hour].total;
        return acc;
      },
      { occupied: 0, total: 0 },
    );
    return { hour, occupancy_pct: pct(totals.occupied, totals.total) ?? 0 };
  });

  const peakHours = [...hourAvg]
    .sort((a, b) => b.occupancy_pct - a.occupancy_pct)
    .slice(0, 3)
    .filter((h) => h.occupancy_pct > 0);

  const bestTimes = hourAvg
    .filter((h) => h.hour >= 7 && h.hour <= 22)
    .sort((a, b) => a.occupancy_pct - b.occupancy_pct)
    .slice(0, 3);

  const now = new Date();
  const currentDow = (now.getUTCDay() + 6) % 7;
  const currentHour = now.getUTCHours();
  const cb = buckets[currentDow][currentHour];
  const currentPrediction = pct(cb.occupied, cb.total);

  const nextHours = Array.from({ length: 6 }, (_, i) => {
    const future = new Date(now.getTime() + (i + 1) * 3600_000);
    const fb = buckets[(future.getUTCDay() + 6) % 7][future.getUTCHours()];
    return { hour: future.getUTCHours(), occupancy_pct: pct(fb.occupied, fb.total) };
  });

  const totalReadings = buckets.reduce(
    (sum, row) => sum + row.reduce((s, b) => s + b.total, 0),
    0,
  );

  return {
    heatmap,
    peak_hours: peakHours,
    best_times: bestTimes,
    current_prediction: currentPrediction,
    next_hours: nextHours,
    data_days: days,
    total_readings: totalReadings,
  };
}

export function buildDaylightStats(
  rows: EventRow[],
  days: number,
  daylightStart: number,
  daylightEnd: number,
) {
  if (rows.length === 0) return null;

  const parsed = rows
    .map((r) => {
      const ts = new Date(r.timestamp);
      if (Number.isNaN(ts.getTime())) return null;
      return {
        ts,
        status: r.event_name === "court_occupied" ? "occupied" : "available",
      };
    })
    .filter((x): x is { ts: Date; status: string } => x !== null);

  const daylightHours = Array.from(
    { length: daylightEnd - daylightStart },
    (_, i) => daylightStart + i,
  );
  const cols = daylightHours.length;

  const buckets: Bucket[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: cols }, () => ({ occupied: 0, total: 0 })),
  );

  for (const p of parsed) {
    const hour = p.ts.getUTCHours();
    if (hour < daylightStart || hour >= daylightEnd) continue;
    const dow = (p.ts.getUTCDay() + 6) % 7;
    const col = hour - daylightStart;
    buckets[dow][col].total += 1;
    if (p.status === "occupied") buckets[dow][col].occupied += 1;
  }

  const daylightHeatmap = buckets.map((row) => row.map((b) => pct(b.occupied, b.total)));

  const hourAvg = daylightHours.map((hour, col) => {
    const totals = buckets.reduce(
      (acc, row) => {
        acc.occupied += row[col].occupied;
        acc.total += row[col].total;
        return acc;
      },
      { occupied: 0, total: 0 },
    );
    return { hour, occupancy_pct: pct(totals.occupied, totals.total) ?? 0 };
  });

  const peakDaylight = [...hourAvg]
    .sort((a, b) => b.occupancy_pct - a.occupancy_pct)
    .slice(0, 3)
    .filter((h) => h.occupancy_pct > 0);

  const bestDaylight = [...hourAvg]
    .sort((a, b) => a.occupancy_pct - b.occupancy_pct)
    .slice(0, 3);

  const sessions: number[] = [];
  let sessionStart: Date | null = null;
  for (const p of parsed) {
    const hour = p.ts.getUTCHours();
    const isDaylight = hour >= daylightStart && hour < daylightEnd;
    if (p.status === "occupied" && sessionStart === null && isDaylight) {
      sessionStart = p.ts;
    } else if (sessionStart !== null) {
      if (p.status !== "occupied" || !isDaylight) {
        const durationMin = (p.ts.getTime() - sessionStart.getTime()) / 60000;
        if (durationMin > 0) sessions.push(durationMin);
        sessionStart = null;
      }
    }
  }

  let currentSession:
    | { started_at: string; duration_min: number; est_remaining_min: number; based_on_median_min: number }
    | null = null;

  if (parsed.length > 0 && parsed[parsed.length - 1].status === "occupied") {
    let runStart = parsed[parsed.length - 1].ts;
    for (let i = parsed.length - 2; i >= 0; i--) {
      if (parsed[i].status !== "occupied") {
        runStart = parsed[i + 1].ts;
        break;
      }
      if (i === 0) runStart = parsed[0].ts;
    }
    const durationMin = (Date.now() - runStart.getTime()) / 60000;
    const medianDur = sessions.length > 0 ? median(sessions) : 60;
    currentSession = {
      started_at: runStart.toISOString(),
      duration_min: Math.round(durationMin),
      est_remaining_min: Math.max(0, Math.round(medianDur - durationMin)),
      based_on_median_min: Math.round(medianDur),
    };
  }

  const avgSession = sessions.length > 0 ? Math.round(mean(sessions)) : null;
  const medianSession = sessions.length > 0 ? Math.round(median(sessions)) : null;

  const totalDaylightReadings = buckets.reduce(
    (sum, row) => sum + row.reduce((s, b) => s + b.total, 0),
    0,
  );

  return {
    daylight_heatmap: daylightHeatmap,
    daylight_hours: daylightHours,
    peak_daylight_hours: peakDaylight,
    best_daylight_times: bestDaylight,
    avg_session_min: avgSession,
    median_session_min: medianSession,
    session_count: sessions.length,
    current_session: currentSession,
    daylight_range: { start: daylightStart, end: daylightEnd },
    data_days: days,
    total_daylight_readings: totalDaylightReadings,
  };
}
