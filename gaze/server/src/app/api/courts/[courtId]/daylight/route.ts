import { NextResponse } from "next/server";
import { getDb } from "@/lib/supabase";
import { resolveCourtId } from "@/lib/courts";
import { buildDaylightStats } from "@/lib/stats";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ courtId: string }> },
) {
  const { courtId } = await params;
  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") ?? 28);
  const start = Number(url.searchParams.get("start") ?? 6);
  const end = Number(url.searchParams.get("end") ?? 20);

  const uuid = await resolveCourtId(courtId);
  if (!uuid)
    return NextResponse.json({ error: "No data available", court_id: courtId });

  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const events = await getDb()
    .from("events")
    .select("event_name, timestamp")
    .eq("court_id", uuid)
    .gte("timestamp", cutoff)
    .order("timestamp");

  const stats = buildDaylightStats(events.data ?? [], days, start, end);
  if (!stats)
    return NextResponse.json({ error: "No data available", court_id: courtId });

  return NextResponse.json({ court_id: courtId, ...stats });
}
