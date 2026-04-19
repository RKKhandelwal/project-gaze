import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import type { Court, CourtStatus } from "@gaze/types";

import { authContextToResponse, authorizeJwtOrAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { courts, events } from "@/lib/schema";

export const runtime = "nodejs";

function toIsoString(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function normalizeCourtStatus(value: string | null | undefined): CourtStatus {
  if (value === "occupied" || value === "available" || value === "unknown") {
    return value;
  }
  return "unknown";
}

export async function GET(req: Request) {
  const auth = authorizeJwtOrAdmin(req);
  const authError = authContextToResponse(auth);
  if (authError) return authError;

  const courtRows = await db
    .select({
      internalId: courts.id,
      publicId: courts.publicId,
      name: courts.name,
      number: courts.number,
      status: courts.status,
    })
    .from(courts)
    .orderBy(courts.number);

  const result: Court[] = [];

  for (const court of courtRows) {
    const latestEventRows = await db
      .select({
        timestamp: events.timestamp,
      })
      .from(events)
      .where(eq(events.courtId, court.internalId))
      .orderBy(desc(events.timestamp))
      .limit(1);

    const latestEvent = latestEventRows[0] ?? null;
    const lastUpdated = toIsoString(latestEvent?.timestamp ?? null);

    result.push({
      court_id: court.publicId,
      name: court.name,
      status: normalizeCourtStatus(court.status),
      last_updated: lastUpdated,
    });
  }

  return NextResponse.json(result);
}
