export interface TimezoneOption {
  id: string;
  label: string;
}

export const TIMEZONES: TimezoneOption[] = [
  { id: "America/Los_Angeles", label: "Pacific" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/New_York", label: "Eastern" },
  { id: "UTC", label: "UTC" },
];

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

// Cache formatters — Intl.DateTimeFormat construction is non-trivial.
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions) {
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", opts);
    fmtCache.set(key, f);
  }
  return f;
}

/** YYYY-MM-DD calendar day in the given timezone. */
export function dayKeyInTZ(ms: number, tz: string): string {
  const parts = fmt(`day-${tz}`, {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** HH:MM in the given timezone, 24h. */
export function formatHMInTZ(ms: number, tz: string): string {
  return fmt(`hm-${tz}`, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

/** Short weekday ("Mon", "Tue", …) for a YYYY-MM-DD key interpreted in tz. */
export function weekdayForDayKey(dayKey: string, tz: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  // Noon UTC on the nominal date — safe for every IANA offset (-12..+14).
  const ts = Date.UTC(y, m - 1, d, 12, 0, 0);
  return fmt(`wd-${tz}`, {
    timeZone: tz,
    weekday: "short",
  }).format(ts);
}

/** "5/17" style short date for a YYYY-MM-DD key. */
export function shortDateForDayKey(dayKey: string): string {
  const [, m, d] = dayKey.split("-").map(Number);
  return `${m}/${d}`;
}

/** "May 17 → May 18" date range in the given timezone. */
export function formatDateRangeInTZ(
  startISO: string,
  endISO: string,
  tz: string,
): string {
  const fmtter = fmt(`range-${tz}`, {
    timeZone: tz,
    month: "short",
    day: "numeric",
  });
  return `${fmtter.format(new Date(startISO))} → ${fmtter.format(new Date(endISO))}`;
}

/** "May 17, 2026, 1:30 PM" style timestamp in the given timezone. */
export function formatFullDateTimeInTZ(iso: string, tz: string): string {
  return fmt(`full-${tz}`, {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** Offset (minutes east of UTC) for the given tz at the given moment. */
export function tzOffsetMinutesAt(ms: number, tz: string): number {
  const parts = fmt(`off-${tz}`, {
    timeZone: tz,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(ms));
  const off =
    parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(off);
  if (!m) return 0;
  const sign = m[1] === "+" ? 1 : -1;
  return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
}

/** Unix ms for the midnight that starts the given YYYY-MM-DD calendar day in tz. */
export function midnightMsInTZ(dayKey: string, tz: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  const probe = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offMin = tzOffsetMinutesAt(probe, tz);
  return probe - offMin * 60_000;
}

/** [startMs, endMs) for the given calendar day in tz. */
export function dayBoundariesInTZ(
  dayKey: string,
  tz: string,
): [number, number] {
  const start = midnightMsInTZ(dayKey, tz);
  // Use the next day's midnight (handles DST so length isn't always 86_400_000).
  const next = addDayToKey(dayKey, 1);
  const end = midnightMsInTZ(next, tz);
  return [start, end];
}

/** Add n days to a YYYY-MM-DD key (calendar arithmetic, ignores tz). */
export function addDayToKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const dd = new Date(ms);
  return `${dd.getUTCFullYear()}-${String(dd.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(dd.getUTCDate()).padStart(2, "0")}`;
}

/** Inclusive list of YYYY-MM-DD keys from start to end. */
export function dayRange(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  let cur = startKey;
  while (cur <= endKey) {
    out.push(cur);
    cur = addDayToKey(cur, 1);
  }
  return out;
}

/** Short timezone abbreviation ("PDT", "UTC") for display. */
export function tzAbbrev(tz: string): string {
  const parts = fmt(`abbr-${tz}`, {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(new Date());
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}
