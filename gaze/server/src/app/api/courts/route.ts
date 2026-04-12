import { NextResponse } from "next/server";
import { getDb } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  const courts = await db
    .from("courts")
    .select("id, name, number, location_id")
    .order("number");

  const result = [];
  for (const court of courts.data ?? []) {
    let status = "available";
    let lastUpdated: string | null = null;

    const event = await db
      .from("events")
      .select("event_name, timestamp")
      .eq("court_id", court.id)
      .order("timestamp", { ascending: false })
      .limit(1);

    if (event.data && event.data.length > 0) {
      status = event.data[0].event_name === "court_occupied" ? "occupied" : "available";
      lastUpdated = event.data[0].timestamp as string;
    }

    result.push({
      court_id: String(court.name).toLowerCase().replace(/\s+/g, "-"),
      name: court.name,
      status,
      last_updated: lastUpdated,
    });
  }

  return NextResponse.json(result);
}
