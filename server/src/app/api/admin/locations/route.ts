import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { locations } from "@/lib/schema";
import { authorizeAdminOnly, authContextToResponse } from "@/lib/auth";

export const runtime = "nodejs";

type CreateLocationBody = {
  public_id?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidPublicId(value: string): boolean {
  // lowercase letters, numbers, and dashes; starts/ends alphanumeric
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value);
}

export async function POST(req: Request) {
  const auth = authorizeAdminOnly(req);
  const authError = authContextToResponse(auth);
  if (authError) return authError;

  let body: CreateLocationBody;
  try {
    body = (await req.json()) as CreateLocationBody;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const publicId = body.public_id?.trim();
  const name = body.name?.trim();
  const latitude = body.latitude;
  const longitude = body.longitude;

  if (!publicId || !name || latitude === undefined || longitude === undefined) {
    return NextResponse.json(
      {
        detail:
          "Required fields: public_id, name, latitude, longitude",
      },
      { status: 400 },
    );
  }

  if (!isValidPublicId(publicId)) {
    return NextResponse.json(
      {
        detail:
          "public_id must be lowercase alphanumeric + dashes, 1-64 chars, and start/end alphanumeric",
      },
      { status: 400 },
    );
  }

  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
    return NextResponse.json(
      { detail: "latitude must be a number between -90 and 90" },
      { status: 400 },
    );
  }

  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
    return NextResponse.json(
      { detail: "longitude must be a number between -180 and 180" },
      { status: 400 },
    );
  }

  try {
    const rows = await db
      .insert(locations)
      .values({
        publicId,
        name,
        latitude,
        longitude,
      })
      .returning({
        id: locations.id,
        public_id: locations.publicId,
        name: locations.name,
        latitude: locations.latitude,
        longitude: locations.longitude,
        created_at: locations.createdAt,
      });

    return NextResponse.json(rows[0], { status: 201 });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : "";

    if (
      message.includes("duplicate key") ||
      message.includes("unique constraint")
    ) {
      return NextResponse.json(
        { detail: "Location with this public_id already exists" },
        { status: 409 },
      );
    }

    const debugMessage =
      error instanceof Error ? error.message : "Unknown database error";

    return NextResponse.json(
      {
        detail: "Failed to create location",
        error: debugMessage,
      },
      { status: 500 },
    );
  }
}
