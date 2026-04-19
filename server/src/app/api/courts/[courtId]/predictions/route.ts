import { NextResponse } from "next/server";
import { and, asc, eq, gte } from "drizzle-orm";
import type { CourtPredictionsOrError, CourtPredictionsResponse } from "@gaze/types";

import { authContextToResponse, authorizeJwtOrAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { resolveCourtId } from "@/lib/courts";
import { buildUsageStats } from "@/lib/stats";

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
  const days = Number(new URL(req.url).searchParams.get("days") ?? 28);

  const uuid = await resolveCourtId(courtId);
  if (!uuid) {
    const errorResponse: CourtPredictionsOrError = {
      error: "No data available",
      court_id: courtId,
    };
    return NextResponse.json<CourtPredictionsOrError>(errorResponse);
  }

  const cutoffDate = new Date(Date.now() - days * 86400_000);

  const rows = await db
    .select({
      event_name: events.eventName,
      timestamp: events.timestamp,
    })
    .from(events)
    .where(and(eq(events.courtId, uuid), gte(events.timestamp, cutoffDate)))
    .orderBy(asc(events.timestamp));

  const normalized: EventRow[] = rows.map((row) => ({
    event_name: row.event_name,
    timestamp:
      row.timestamp instanceof Date
        ? row.timestamp.toISOString()
        : String(row.timestamp),
  }));

  const stats = buildUsageStats(normalized, days);
  if (!stats) {
    const errorResponse: CourtPredictionsOrError = {
      error: "No data available",
      court_id: courtId,
    };
    return NextResponse.json<CourtPredictionsOrError>(errorResponse);
  }

  const response: CourtPredictionsResponse = {
    court_id: courtId,
    ...stats,
  };

  return NextResponse.json<CourtPredictionsResponse>(response);
}
