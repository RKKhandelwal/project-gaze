import { NextResponse } from "next/server";
import { getDb, verifyApiKey } from "@/lib/supabase";

export const runtime = "nodejs";

type StatusBody = {
  court_id: string;
  status: string;
  sensor_data?: Record<string, unknown>;
  timestamp: string;
};

export async function POST(req: Request) {
  if (!verifyApiKey(req)) {
    return NextResponse.json({ detail: "Invalid API key" }, { status: 401 });
  }

  const body = (await req.json()) as StatusBody;
  if (body.status !== "occupied" && body.status !== "available") {
    return NextResponse.json(
      { detail: "status must be 'occupied' or 'available'" },
      { status: 400 },
    );
  }

  const db = getDb();

  let courtResult = await db
    .from("courts")
    .select("id")
    .eq("name", body.court_id)
    .limit(1);

  if (!courtResult.data || courtResult.data.length === 0) {
    const num = body.court_id.replace(/^court-/, "");
    const n = /^\d+$/.test(num) ? Number(num) : 0;
    courtResult = await db.from("courts").select("id").eq("number", n).limit(1);
  }

  const courtUuid = courtResult.data?.[0]?.id as string | undefined;
  if (!courtUuid) return NextResponse.json({ ok: true, skipped: "court_not_found" });

  const eventName = body.status === "occupied" ? "court_occupied" : "court_unoccupied";

  const sensorResult = await db
    .from("sensors")
    .select("id")
    .eq("court_id", courtUuid)
    .limit(1);
  const sensorUuid = sensorResult.data?.[0]?.id as string | undefined;

  if (sensorUuid) {
    await db.from("events").insert({
      event_name: eventName,
      timestamp: body.timestamp,
      sensor_id: sensorUuid,
      court_id: courtUuid,
      payload: body.sensor_data ?? {},
    });
    await db.from("sensors").update({ last_seen_at: body.timestamp }).eq("id", sensorUuid);
  }

  return NextResponse.json({ ok: true });
}
