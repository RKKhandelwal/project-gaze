import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import type { Court } from "@gaze/types";

import { db } from "@/lib/db";
import { courts, events, locations } from "@/lib/schema";
import { authorizeJwtOrAdmin, authContextToResponse } from "@/lib/auth";

export const runtime = "nodejs";

function toIsoString(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ locationId: string }> },
) {
  const auth = authorizeJwtOrAdmin(req);
  const authFailure = authContextToResponse(auth);
  if (authFailure) return authFailure;

  const { locationId } = await params;

  const locationRows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.publicId, locationId))
    .limit(1);

  if (locationRows.length === 0) {
    return NextResponse.json(
      { error: "Location not found", location_id: locationId },
      { status: 404 },
    );
  }

  const internalLocationId = locationRows[0].id;

  const courtRows = await db
    .select({
      id: courts.id,
      publicId: courts.publicId,
      name: courts.name,
      number: courts.number,
      status: courts.status,
    })
    .from(courts)
    .where(eq(courts.locationId, internalLocationId))
    .orderBy(courts.number);

  const result: Court[] = [];

  for (const court of courtRows) {
    const latestEventRows = await db
      .select({
        timestamp: events.timestamp,
      })
      .from(events)
      .where(eq(events.courtId, court.id))
      .orderBy(desc(events.timestamp))
      .limit(1);

    const latestEvent = latestEventRows[0] ?? null;
    const lastUpdated = toIsoString(latestEvent?.timestamp ?? null);

    result.push({
      court_id: court.publicId,
      name: court.name,
      status: court.status,
      last_updated: lastUpdated,
    });
  }

  return NextResponse.json(result);
}
