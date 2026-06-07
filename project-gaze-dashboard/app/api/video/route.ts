import { NextRequest, NextResponse } from "next/server";
import { presignOverlay } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const EXPIRES_IN_SECONDS = 3600;

export async function GET(req: NextRequest) {
  const fileID = req.nextUrl.searchParams.get("fileID");

  if (!fileID || !FILE_ID_RE.test(fileID)) {
    return NextResponse.json(
      { error: "fileID is required and must be alphanumeric" },
      { status: 400 },
    );
  }

  try {
    const url = await presignOverlay(fileID, EXPIRES_IN_SECONDS);
    const expiresAt = Date.now() + EXPIRES_IN_SECONDS * 1000;
    return NextResponse.json(
      { url, expiresAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
