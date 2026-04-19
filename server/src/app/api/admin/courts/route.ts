import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { authorizeAdminOnly, authContextToResponse } from "@/lib/auth";
import { db } from "@/lib/db";
import { courts, locations } from "@/lib/schema";

export const runtime = "nodejs";

type CreateCourtBody = {
  public_id?: string;
  location_id?: string; // location public_id
  name?: string;
  number?: number;
};

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildCourtPublicId(locationPublicId: string, courtNumber: number): string {
  return `court-${slugify(locationPublicId)}-${courtNumber}`;
}

export async function POST(req: Request) {
  const auth = authorizeAdminOnly(req);
  const authError = authContextToResponse(auth);
  if (authError) return authError;

  const body = (await req.json()) as CreateCourtBody;

  if (!body.location_id || typeof body.location_id !== "string") {
    return NextResponse.json(
      { detail: "location_id (location public_id) is required" },
      { status: 400 },
    );
  }

  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json(
      { detail: "name is required" },
      { status: 400 },
    );
  }

  if (typeof body.number !== "number" || !Number.isInteger(body.number) || body.number <= 0) {
    return NextResponse.json(
      { detail: "number must be a positive integer" },
      { status: 400 },
    );
  }

  const locationPublicId = body.location_id.trim();
  const locationRows = await db
    .select({
      id: locations.id,
      publicId: locations.publicId,
      name: locations.name,
    })
    .from(locations)
    .where(eq(locations.publicId, locationPublicId))
    .limit(1);

  if (locationRows.length === 0) {
    return NextResponse.json(
      { detail: `location not found for public_id=${locationPublicId}` },
      { status: 404 },
    );
  }

  const location = locationRows[0];

  const existingByNumber = await db
    .select({ id: courts.id })
    .from(courts)
    .where(
      and(
        eq(courts.locationId, location.id),
        eq(courts.number, body.number),
      ),
    )
    .limit(1);

  if (existingByNumber.length > 0) {
    return NextResponse.json(
      {
        detail: `court number ${body.number} already exists for location ${location.publicId}`,
      },
      { status: 409 },
    );
  }

  const requestedPublicId =
    body.public_id && body.public_id.trim().length > 0
      ? body.public_id.trim()
      : buildCourtPublicId(location.publicId, body.number);

  const existingByPublicId = await db
    .select({ id: courts.id })
    .from(courts)
    .where(eq(courts.publicId, requestedPublicId))
    .limit(1);

  if (existingByPublicId.length > 0) {
    return NextResponse.json(
      { detail: `court public_id already exists: ${requestedPublicId}` },
      { status: 409 },
    );
  }

  const inserted = await db
    .insert(courts)
    .values({
      publicId: requestedPublicId,
      locationId: location.id,
      name: body.name.trim(),
      number: body.number,
    })
    .returning({
      id: courts.id,
      public_id: courts.publicId,
      name: courts.name,
      number: courts.number,
      created_at: courts.createdAt,
    });

  const court = inserted[0];

  return NextResponse.json(
    {
      id: court.id, // internal integer ID
      public_id: court.public_id,
      location_id: location.publicId, // external/public location ID
      name: court.name,
      number: court.number,
      created_at:
        court.created_at instanceof Date
          ? court.created_at.toISOString()
          : String(court.created_at),
    },
    { status: 201 },
  );
}
