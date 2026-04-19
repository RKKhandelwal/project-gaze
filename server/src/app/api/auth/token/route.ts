import { NextResponse } from "next/server";
import { issueJwtToken } from "@/lib/auth";

export const runtime = "nodejs";

type TokenRequestBody = {
  device_id?: string;
};

function getMobileApiKey(): string {
  const key = process.env.MOBILE_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error("MOBILE_API_KEY is not configured on the server.");
  }
  return key;
}

function verifyMobileApiKey(req: Request): boolean {
  const supplied = req.headers.get("x-mobile-api-key");
  if (!supplied) return false;
  return supplied === getMobileApiKey();
}

export async function POST(req: Request) {
  if (!verifyMobileApiKey(req)) {
    return NextResponse.json(
      { detail: "Invalid mobile API key" },
      { status: 401 },
    );
  }

  let body: TokenRequestBody = {};
  try {
    body = (await req.json()) as TokenRequestBody;
  } catch {
    // Body is optional; ignore parse errors and use defaults.
  }

  const deviceId = body.device_id?.trim() || "mobile-client";

  const token = issueJwtToken({
    sub: deviceId,
    role: "user",
    scope: ["mobile:read", "mobile:stream"],
    ttlSeconds: 60 * 60, // 1 hour
  });

  return NextResponse.json({
    token_type: "Bearer",
    access_token: token,
    expires_in: 60 * 60,
  });
}
