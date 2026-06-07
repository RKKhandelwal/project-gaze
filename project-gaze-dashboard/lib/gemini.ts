import { GoogleGenAI } from "@google/genai";
import { fetchIndexJson } from "./r2";
import type { IndexData, Segment } from "./types";

let cachedAi: GoogleGenAI | null = null;
export function getGenAI(): GoogleGenAI {
  if (cachedAi) return cachedAi;
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");
  cachedAi = new GoogleGenAI({ apiKey });
  return cachedAi;
}

let cachedIndex: { data: IndexData; at: number } | null = null;
const INDEX_TTL_MS = 60_000;

export async function getCachedIndex(): Promise<IndexData> {
  if (cachedIndex && Date.now() - cachedIndex.at < INDEX_TTL_MS) {
    return cachedIndex.data;
  }
  const data = (await fetchIndexJson()) as IndexData;
  cachedIndex = { data, at: Date.now() };
  return data;
}

// Trim segments to a compact array form to keep the system prompt small.
// Each row: [fileID, startISO, totalFrames, maxPeople, avgPeople]
function compactSegments(segments: Segment[]) {
  return segments.map((s) => [
    s.fileID,
    s.start_utc,
    s.total_frames,
    s.max_people,
    Number(s.avg_people.toFixed(2)),
  ]);
}

export function buildSystemInstruction(index: IndexData, tz: string): string {
  const compactIndex = {
    totals: index.totals,
    daily_summary: index.daily_summary,
    occupancy_minute: index.occupancy_minute,
    segments_schema: [
      "fileID",
      "start_utc",
      "total_frames",
      "max_people",
      "avg_people",
    ],
    segments: compactSegments(index.segments),
  };

  const now = new Date().toLocaleString("en-US", {
    timeZone: tz,
    dateStyle: "full",
    timeStyle: "long",
  });

  return `You are the assistant for the McKenzie Park Courts pickleball occupancy dashboard (Los Altos, CA). A UniFi Protect camera processes ~5-minute video segments and a CV pipeline counts people on the courts per frame at ~4 fps. The frontend shows occupancy charts, a video player, and an insights page.

You have complete access to all aggregated occupancy data below. Answer questions directly using these numbers — don't speculate. Be concise. Use specific times, dates, and counts. Use bullet points for lists. Use the user's selected timezone for all times you display.

USER CONTEXT:
- Selected timezone: ${tz}
- Current time: ${now}

DATA NOTES:
- occupancy_minute is an array of [unix_ms_utc, person_count] pairs. The person_count is the 95th percentile of per-frame detections within that minute. Convert ms to a date for time-based queries.
- segments is a compact array; each row is [fileID, start_utc_iso, total_frames, max_people, avg_people]. There are ${index.segments.length} segments covering ${Object.keys(index.daily_summary).length} days.
- daily_summary keys are YYYY-MM-DD in UTC.
- Convert all UTC values into the user's timezone (${tz}) before showing them.

WHEN TO USE TOOLS:
- Use get_video_url when the user wants to watch a specific moment, see a particular segment, or you want to give them a clickable playback link. Return the URL in markdown link form, e.g. [Watch segment](url).
- For everything else (trends, comparisons, busiest times, peaks, distributions), answer directly from the DATA below — no tool needed.

DATA:
${JSON.stringify(compactIndex)}`;
}
