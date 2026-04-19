import { NextResponse } from "next/server";
import { and, asc, eq, gte } from "drizzle-orm";
import type {
  ApiErrorResponse,
  CourtDaylightOrError,
  CourtDaylightResponse,
} from "@gaze/types";

import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { resolveCourtId } from "@/lib/courts";
import { buildDaylightStats } from "@/lib/stats";
import { authorizeJwtOrAdmin, authContextToResponse } from "@/lib/auth";

export const runtime = "nodejs";

type EventRow = {
  event_name: string;
  timestamp: string;
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ courtId: string }> },
) {
  const auth = authorizeJwtOrAdmin(req);
  const authError = authContextToResponse(auth);
  if (authError) return authError;

  const { courtId } = await params;
  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") ?? 28);
  const start = Number(url.searchParams.get("start") ?? 6);
  const end = Number(url.searchParams.get("end") ?? 20);

  const uuid = await resolveCourtId(courtId);
  if (!uuid) {
    const payload: ApiErrorResponse = {
      error: "No data available",
      court_id: courtId,
    };
    return NextResponse.json<CourtDaylightOrError>(payload);
  }

  const cutoff = new Date(Date.now() - days * 86400_000);

  const rows = await db
    .select({
      eventName: events.eventName,
      timestamp: events.timestamp,
    })
    .from(events)
    .where(
      and(
        eq(events.courtId, uuid),
        gte(events.timestamp, cutoff),
      ),
    )
    .orderBy(asc(events.timestamp));

  const normalized: EventRow[] = rows.map((row) => ({
    event_name: row.eventName,
    timestamp:
      row.timestamp instanceof Date
        ? row.timestamp.toISOString()
        : String(row.timestamp),
  }));

  const stats = buildDaylightStats(normalized, days, start, end);
  if (!stats) {
    const payload: ApiErrorResponse = {
      error: "No data available",
      court_id: courtId,
    };
    return NextResponse.json<CourtDaylightOrError>(payload);
  }

  const payload: CourtDaylightResponse = {
    court_id: courtId,
    ...stats,
  };

  return NextResponse.json<CourtDaylightOrError>(payload);
}
