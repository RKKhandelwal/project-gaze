import { NextResponse } from "next/server";
import type { Location } from "@gaze/types";
import { db } from "@/lib/db";
import { locations } from "@/lib/schema";
import { authorizeJwtOrAdmin, authContextToResponse } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = authorizeJwtOrAdmin(req);
  const authError = authContextToResponse(auth);
  if (authError) return authError;
  const rows = await db
    .select({
      id: locations.publicId,
      name: locations.name,
      latitude: locations.latitude,
      longitude: locations.longitude,
    })
    .from(locations)
    .orderBy(locations.name);

  const result: Location[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
  }));

  return NextResponse.json(result);
}
