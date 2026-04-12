import { NextResponse } from "next/server";
import { getDb } from "@/lib/supabase";
import { resolveCourtId } from "@/lib/courts";
import { buildUsageStats } from "@/lib/stats";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ courtId: string }> },
) {
  const { courtId } = await params;
  const days = Number(new URL(req.url).searchParams.get("days") ?? 28);

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

  const stats = buildUsageStats(events.data ?? [], days);
  if (!stats)
    return NextResponse.json({ error: "No data available", court_id: courtId });

  return NextResponse.json({ court_id: courtId, ...stats });
}
