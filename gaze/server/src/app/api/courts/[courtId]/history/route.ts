import { NextResponse } from "next/server";
import { getDb } from "@/lib/supabase";
import { resolveCourtId } from "@/lib/courts";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ courtId: string }> },
) {
  const { courtId } = await params;
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours") ?? 24);

  const uuid = await resolveCourtId(courtId);
  if (!uuid) return NextResponse.json([]);

  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  const events = await getDb()
    .from("events")
    .select("id, event_name, timestamp, payload")
    .eq("court_id", uuid)
    .gte("timestamp", cutoff)
    .order("timestamp", { ascending: false })
    .limit(500);

  const result = (events.data ?? []).map((e) => ({
    id: e.id,
    court_id: courtId,
    status: e.event_name === "court_occupied" ? "occupied" : "available",
    sensor_data: e.payload,
    timestamp: e.timestamp,
  }));

  return NextResponse.json(result);
}
