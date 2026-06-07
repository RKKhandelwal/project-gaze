import { NextResponse } from "next/server";
import { fetchIndexJson } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchIndexJson();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name ?? "";
    const message = err instanceof Error ? err.message : "unknown error";
    const isNotFound =
      name === "NoSuchKey" ||
      name === "NotFound" ||
      /NoSuchKey|NotFound|does not exist|404/i.test(message);
    return NextResponse.json(
      { error: isNotFound ? "index.json not found" : message },
      { status: isNotFound ? 404 : 500 },
    );
  }
}
