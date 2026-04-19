import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { authorizeAdminOnly, authContextToResponse } from "@/lib/auth";
import { db } from "@/lib/db";
import { courts, sensors } from "@/lib/schema";

export const runtime = "nodejs";

type RegisterSensorBody = {
  public_id?: string;
  court_id?: string; // Optional court public_id
};

function isValidPublicId(value: string): boolean {
  // lowercase letters, numbers, dashes; 1-64 chars; must start/end alphanumeric
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value);
}

export async function POST(req: Request) {
  const auth = authorizeAdminOnly(req);
  const authError = authContextToResponse(auth);
  if (authError) return authError;

  let body: RegisterSensorBody;
  try {
    body = (await req.json()) as RegisterSensorBody;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const publicId = body.public_id?.trim();
  if (!publicId) {
    return NextResponse.json(
      { detail: "public_id is required" },
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

  let linkedCourtInternalId: number | null = null;
  let linkedCourtPublicId: string | null = null;

  if (body.court_id && body.court_id.trim().length > 0) {
    const courtPublicId = body.court_id.trim();

    const [courtRow] = await db
      .select({
        id: courts.id,
        publicId: courts.publicId,
        name: courts.name,
      })
      .from(courts)
      .where(eq(courts.publicId, courtPublicId))
      .limit(1);

    if (!courtRow) {
      return NextResponse.json(
        {
          detail: `court not found for public_id=${courtPublicId}`,
        },
        { status: 404 },
      );
    }

    linkedCourtInternalId = courtRow.id;
    linkedCourtPublicId = courtRow.publicId;
  }

  try {
    const [inserted] = await db
      .insert(sensors)
      .values({
        publicId,
        courtId: linkedCourtInternalId,
      })
      .returning({
        id: sensors.id,
        public_id: sensors.publicId,
        court_id: sensors.courtId,
        registered_at: sensors.registeredAt,
        last_seen_at: sensors.lastSeenAt,
      });

    return NextResponse.json(
      {
        id: inserted.id, // internal integer ID
        public_id: inserted.public_id,
        court_id: linkedCourtPublicId, // external/public court ID if linked
        registered_at:
          inserted.registered_at instanceof Date
            ? inserted.registered_at.toISOString()
            : String(inserted.registered_at),
        last_seen_at:
          inserted.last_seen_at instanceof Date
            ? inserted.last_seen_at.toISOString()
            : inserted.last_seen_at,
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";

    if (message.includes("duplicate key") || message.includes("unique constraint")) {
      return NextResponse.json(
        { detail: `sensor public_id already exists: ${publicId}` },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { detail: "Failed to register sensor" },
      { status: 500 },
    );
  }
}
