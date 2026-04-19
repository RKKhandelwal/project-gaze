import { NextResponse } from "next/server";
import type { CourtStatusUpdateEvent } from "@gaze/types";
import { authorizeJwtOrAdmin, authContextToResponse, verifyJwtToken } from "@/lib/auth";
import { realtimeHub } from "@/lib/realtime/hub";

export const runtime = "nodejs";

function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function getCorsOrigin(req: Request): string {
  return req.headers.get("origin") ?? "*";
}

function parseBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

function authorizeStreamRequest(req: Request) {
  const url = new URL(req.url);
  const tokenFromQuery = url.searchParams.get("access_token")?.trim() ?? "";

  // Support EventSource clients that can't set custom headers by allowing
  // `?access_token=<jwt>` in the stream URL.
  if (tokenFromQuery.length > 0) {
    const payload = verifyJwtToken(tokenFromQuery);
    if (!payload) {
      return { ok: false as const, status: 401, error: "Invalid or expired JWT in access_token" };
    }
    return {
      ok: true as const,
      mode: "jwt_query",
      role: payload.role,
      subject: payload.sub,
      payload,
    };
  }

  // Default centralized auth path: admin API key OR bearer JWT in headers.
  const auth = authorizeJwtOrAdmin(req);
  if (!auth.ok) return auth;

  // Optional fallback: if only Authorization header exists, this branch is
  // still covered by authorizeJwtOrAdmin; kept for explicitness.
  const bearer = parseBearerToken(req);
  if (!bearer && auth.mode !== "admin_api_key") {
    return { ok: false as const, status: 401, error: "Missing bearer token or admin API key" };
  }

  return auth;
}

export async function OPTIONS(req: Request) {
  const origin = getCorsOrigin(req);

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-api-key, x-admin-api-key, x-mobile-api-key",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

export async function GET(req: Request) {
  const auth = authorizeStreamRequest(req);
  if (!auth.ok) {
    const central = authContextToResponse(auth as ReturnType<typeof authorizeJwtOrAdmin>);
    if (central) return central;
    return NextResponse.json({ detail: auth.error }, { status: auth.status });
  }

  const origin = getCorsOrigin(req);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      const hello = {
        type: "connected",
        transport: "sse",
        timestamp: new Date().toISOString(),
      };
      controller.enqueue(encoder.encode(formatSseEvent("connected", hello)));

      const heartbeat = setInterval(() => {
        const ping = {
          type: "ping",
          timestamp: new Date().toISOString(),
          listeners: realtimeHub.listenerCount(),
        };
        controller.enqueue(encoder.encode(formatSseEvent("ping", ping)));
      }, 20_000);

      const unsubscribe = realtimeHub.subscribe((payload) => {
        controller.enqueue(encoder.encode(formatSseEvent("message", payload)));
      });

      const onAbort = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // no-op if already closed
        }
      };

      req.signal.addEventListener("abort", onAbort, { once: true });
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      ...sseHeaders(),
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
    },
  });
}

// Optional helper used by internal callers/tests if needed.
export function emitTestUpdate(
  courtId: string,
  status: CourtStatusUpdateEvent["status"] = "available",
) {
  const event: CourtStatusUpdateEvent = {
    type: "court_status_update",
    court_id: courtId,
    status,
    timestamp: new Date().toISOString(),
    source: "manual",
  };
  realtimeHub.publish(event);
}
