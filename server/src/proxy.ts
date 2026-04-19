import { NextRequest, NextResponse } from "next/server";

function getAllowedOrigin(request: NextRequest): string {
  const origin = request.headers.get("origin");
  return origin ?? "*";
}

function applyCors(response: NextResponse, request: NextRequest): NextResponse {
  const origin = getAllowedOrigin(request);

  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Vary", "Origin");
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, x-admin-api-key, x-mobile-api-key, x-sensor-api-key",
  );
  response.headers.set("Access-Control-Max-Age", "86400");

  return response;
}

export function proxy(request: NextRequest) {
  if (request.method === "OPTIONS") {
    return applyCors(new NextResponse(null, { status: 204 }), request);
  }

  return applyCors(NextResponse.next(), request);
}

export const config = {
  matcher: ["/api/:path*"],
};
