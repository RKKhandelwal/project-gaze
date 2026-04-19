import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { courts, sensors } from "@/lib/schema";
import { authorizeAdminOnly, authContextToResponse } from "@/lib/auth";

export const runtime = "nodejs";

type AssignSensorCourtBody = {
  court_id: string; // courts.public_id
};

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ sensorId: string }> },
) {
  const auth = authorizeAdminOnly(req);
  const authFailure = authContextToResponse(auth);
  if (authFailure) return authFailure;

  const { sensorId } = await params;
  const sensorPublicId = sensorId.trim();
  if (!sensorPublicId) {
    return NextResponse.json({ detail: "sensorId path parameter is required" }, { status: 400 });
  }

  let body: AssignSensorCourtBody;
  try {
    body = (await req.json()) as AssignSensorCourtBody;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const courtPublicId = body?.court_id?.trim();
  if (!courtPublicId) {
    return NextResponse.json({ detail: "court_id is required" }, { status: 400 });
  }

  const [sensorRow] = await db
    .select({ id: sensors.id, publicId: sensors.publicId, courtId: sensors.courtId })
    .from(sensors)
    .where(eq(sensors.publicId, sensorPublicId))
    .limit(1);

  if (!sensorRow) {
    return NextResponse.json(
      { detail: "Sensor not found", sensor_id: sensorPublicId },
      { status: 404 },
    );
  }

  const [courtRow] = await db
    .select({ id: courts.id, publicId: courts.publicId, name: courts.name })
    .from(courts)
    .where(eq(courts.publicId, courtPublicId))
    .limit(1);

  if (!courtRow) {
    return NextResponse.json(
      { detail: "Court not found", court_id: courtPublicId },
      { status: 404 },
    );
  }

  await db
    .update(sensors)
    .set({ courtId: courtRow.id })
    .where(eq(sensors.id, sensorRow.id));

  return NextResponse.json({
    ok: true,
    sensor: {
      id: sensorRow.publicId,
      court_id: courtRow.publicId,
    },
  });
}
