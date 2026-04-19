import { NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import type { CourtHistoryEvent } from "@gaze/types";

import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { resolveCourtId } from "@/lib/courts";
import { authorizeJwtOrAdmin, authContextToResponse } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ courtId: string }> },
) {
  const auth = authorizeJwtOrAdmin(req);
  const authFailure = authContextToResponse(auth);
  if (authFailure) return authFailure;

  const { courtId } = await params;
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours") ?? 24);

  const uuid = await resolveCourtId(courtId);
  if (!uuid) {
    return NextResponse.json([] satisfies CourtHistoryEvent[]);
  }

  const cutoffDate = new Date(Date.now() - hours * 3600_000);

  const rows = await db
    .select({
      id: events.id,
      eventName: events.eventName,
      timestamp: events.timestamp,
      payload: events.payload,
    })
    .from(events)
    .where(
      and(
        eq(events.courtId, uuid),
        gte(events.timestamp, cutoffDate),
      ),
    )
    .orderBy(desc(events.timestamp))
    .limit(500);

  const result: CourtHistoryEvent[] = rows.map((row) => {
    const status: CourtHistoryEvent["status"] =
      row.eventName === "court_occupied" ? "occupied" : "available";

    let sensorData: Record<string, unknown> | null = null;
    if (row.payload && typeof row.payload === "object") {
      sensorData = row.payload as Record<string, unknown>;
    }

    return {
      id: String(row.id),
      court_id: courtId,
      status,
      sensor_data: sensorData,
      timestamp:
        row.timestamp instanceof Date
          ? row.timestamp.toISOString()
          : String(row.timestamp),
    };
  });

  return NextResponse.json(result);
}
