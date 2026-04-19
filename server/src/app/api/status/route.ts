import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import type {
  SensorStatus,
  StatusPostRequest,
  StatusPostErrorResponse,
  StatusPostResponse,
} from "@gaze/types";
import { db } from "@/lib/db";
import { courts, events, sensors } from "@/lib/schema";
import { publishCourtStatusUpdate } from "@/lib/realtime/hub";
import { authorizeJwtOrAdminOrSensor, authContextToResponse } from "@/lib/auth";

export const runtime = "nodejs";

type StatusPostRequestBySensorPublicId = StatusPostRequest;

type SensorResolution =
  | { kind: "not_found" }
  | { kind: "unassigned"; sensorId: number; sensorPublicId: string }
  | {
      kind: "linked";
      sensorId: number;
      sensorPublicId: string;
      courtId: number;
      courtPublicId: string;
    };

async function resolveBySensorPublicId(
  sensorPublicId: string,
): Promise<SensorResolution> {
  const rows = await db
    .select({
      sensorId: sensors.id,
      sensorPublicId: sensors.publicId,
      courtId: sensors.courtId,
    })
    .from(sensors)
    .where(eq(sensors.publicId, sensorPublicId))
    .limit(1);

  if (rows.length === 0) {
    return { kind: "not_found" };
  }

  const sensor = rows[0];

  if (sensor.courtId === null) {
    return {
      kind: "unassigned",
      sensorId: sensor.sensorId,
      sensorPublicId: sensor.sensorPublicId,
    };
  }

  const courtRows = await db
    .select({
      courtId: courts.id,
      courtPublicId: courts.publicId,
    })
    .from(courts)
    .where(eq(courts.id, sensor.courtId))
    .limit(1);

  if (courtRows.length === 0) {
    return {
      kind: "unassigned",
      sensorId: sensor.sensorId,
      sensorPublicId: sensor.sensorPublicId,
    };
  }

  const court = courtRows[0];

  return {
    kind: "linked",
    sensorId: sensor.sensorId,
    sensorPublicId: sensor.sensorPublicId,
    courtId: court.courtId,
    courtPublicId: court.courtPublicId,
  };
}

function toEventName(status: SensorStatus): "court_occupied" | "court_unoccupied" {
  return status === "occupied" ? "court_occupied" : "court_unoccupied";
}

function isValidIsoDate(value: string): boolean {
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

export async function POST(
  req: Request,
): Promise<NextResponse<StatusPostResponse | StatusPostErrorResponse>> {
  const auth = authorizeJwtOrAdminOrSensor(req);
  const authError = authContextToResponse(auth);
  if (authError) return authError;

  const body = (await req.json()) as Partial<StatusPostRequestBySensorPublicId>;

  if (!body.sensor_id || typeof body.sensor_id !== "string") {
    return NextResponse.json({ detail: "sensor_id is required" }, { status: 400 });
  }

  if (!body.timestamp || typeof body.timestamp !== "string") {
    return NextResponse.json({ detail: "timestamp is required" }, { status: 400 });
  }

  if (!isValidIsoDate(body.timestamp)) {
    return NextResponse.json(
      { detail: "timestamp must be a valid ISO-8601 datetime string" },
      { status: 400 },
    );
  }

  if (body.status !== "occupied" && body.status !== "available") {
    return NextResponse.json(
      { detail: "status must be 'occupied' or 'available'" },
      { status: 400 },
    );
  }

  const sensorPublicId = body.sensor_id.trim();
  if (!sensorPublicId) {
    return NextResponse.json({ detail: "sensor_id is required" }, { status: 400 });
  }

  const resolved = await resolveBySensorPublicId(sensorPublicId);

  if (resolved.kind === "not_found") {
    return NextResponse.json({ ok: true, skipped: "sensor_not_found" });
  }

  if (resolved.kind === "unassigned") {
    return NextResponse.json({ ok: true, skipped: "sensor_unassigned" });
  }

  const eventName = toEventName(body.status);

  await db.insert(events).values({
    eventName,
    timestamp: sql`${body.timestamp}::timestamptz`,
    sensorId: resolved.sensorId,
    courtId: resolved.courtId,
    payload: body.sensor_data ?? {},
  });

  await db
    .update(sensors)
    .set({ lastSeenAt: sql`${body.timestamp}::timestamptz` })
    .where(and(eq(sensors.id, resolved.sensorId), eq(sensors.courtId, resolved.courtId)));

  // Persist latest derived court status on the courts table.
  await db
    .update(courts)
    .set({
      status: body.status,
    })
    .where(eq(courts.id, resolved.courtId));

  // Publish public court identifier to clients.
  publishCourtStatusUpdate({
    type: "court_status_update",
    court_id: resolved.courtPublicId,
    status: body.status,
    timestamp: body.timestamp,
    source: "status_api",
  });

  return NextResponse.json({ ok: true });
}
