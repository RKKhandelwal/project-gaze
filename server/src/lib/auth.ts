import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

type JwtPayload = {
  sub: string;
  role: "user" | "admin";
  iat: number;
  exp: number;
  scope?: string[];
};

type AuthContext =
  | {
      ok: true;
      mode: "admin_api_key";
      role: "admin";
      subject: "admin_api_key" | "sensor_api_key";
      payload: null;
    }
  | {
      ok: true;
      mode: "jwt";
      role: "user" | "admin";
      subject: string;
      payload: JwtPayload;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

const DEFAULT_JWT_TTL_SECONDS = 60 * 60; // 1 hour

function b64urlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, "base64");
}

function signHmacSha256(data: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(data).digest();
  return b64urlEncode(sig);
}

function safeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getAdminApiKey(): string {
  return requiredEnv("ADMIN_API_KEY");
}

export function getJwtSecret(): string {
  return requiredEnv("JWT_SECRET");
}

export function issueJwtToken(input: {
  sub: string;
  role?: "user" | "admin";
  scope?: string[];
  ttlSeconds?: number;
}): string {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? DEFAULT_JWT_TTL_SECONDS;

  const header = { alg: "HS256", typ: "JWT" as const };
  const payload: JwtPayload = {
    sub: input.sub,
    role: input.role ?? "user",
    iat: now,
    exp: now + ttl,
    scope: input.scope,
  };

  const headerPart = b64urlEncode(JSON.stringify(header));
  const payloadPart = b64urlEncode(JSON.stringify(payload));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = signHmacSha256(signingInput, secret);

  return `${signingInput}.${signature}`;
}

export function verifyJwtToken(token: string): JwtPayload | null {
  try {
    const [headerPart, payloadPart, signaturePart] = token.split(".");
    if (!headerPart || !payloadPart || !signaturePart) return null;

    const secret = getJwtSecret();
    const signingInput = `${headerPart}.${payloadPart}`;
    const expectedSig = signHmacSha256(signingInput, secret);

    if (!safeEqualStrings(signaturePart, expectedSig)) return null;

    const headerRaw = b64urlDecode(headerPart).toString("utf8");
    const header = JSON.parse(headerRaw) as { alg?: string; typ?: string };
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;

    const payloadRaw = b64urlDecode(payloadPart).toString("utf8");
    const payload = JSON.parse(payloadRaw) as JwtPayload;

    if (!payload.sub || !payload.role || !payload.iat || !payload.exp) return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

function parseBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

function parseAdminApiKey(req: Request): string | null {
  const key = req.headers.get("x-admin-api-key");
  return key?.trim() || null;
}

export function authorizeAdminOnly(req: Request): AuthContext {
  const supplied = parseAdminApiKey(req);
  if (!supplied) {
    return { ok: false, status: 401, error: "Missing x-admin-api-key" };
  }

  const expected = getAdminApiKey();
  if (!safeEqualStrings(supplied, expected)) {
    return { ok: false, status: 401, error: "Invalid admin API key" };
  }

  return {
    ok: true,
    mode: "admin_api_key",
    role: "admin",
    subject: "admin_api_key",
    payload: null,
  };
}

function parseSensorApiKey(req: Request): string | null {
  const key = req.headers.get("x-api-key");
  return key?.trim() || null;
}

export function getSensorApiKey(): string {
  return requiredEnv("SENSOR_API_KEY");
}

export function authorizeJwtOrAdminOrSensor(req: Request): AuthContext {
  // 1) Admin API key wins if present and valid
  const adminKey = parseAdminApiKey(req);
  if (adminKey) {
    const expected = getAdminApiKey();
    if (!safeEqualStrings(adminKey, expected)) {
      return { ok: false, status: 401, error: "Invalid admin API key" };
    }
    return {
      ok: true,
      mode: "admin_api_key",
      role: "admin",
      subject: "admin_api_key",
      payload: null,
    };
  }

  // 2) Sensor API key is accepted for machine-to-machine endpoints
  const sensorKey = parseSensorApiKey(req);
  if (sensorKey) {
    const expectedSensorKey = getSensorApiKey();
    if (!safeEqualStrings(sensorKey, expectedSensorKey)) {
      return { ok: false, status: 401, error: "Invalid sensor API key" };
    }
    return {
      ok: true,
      mode: "admin_api_key",
      role: "admin",
      subject: "sensor_api_key",
      payload: null,
    };
  }

  // 3) Otherwise require JWT
  const token = parseBearerToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Missing bearer token, admin API key, or sensor API key",
    };
  }

  const payload = verifyJwtToken(token);
  if (!payload) {
    return { ok: false, status: 401, error: "Invalid or expired JWT" };
  }

  return {
    ok: true,
    mode: "jwt",
    role: payload.role,
    subject: payload.sub,
    payload,
  };
}

export function authorizeJwtOrAdmin(req: Request): AuthContext {
  const auth = authorizeJwtOrAdminOrSensor(req);

  // Preserve previous behavior for endpoints that should NOT allow sensor key.
  if (auth.ok && auth.subject === "sensor_api_key") {
    return { ok: false, status: 401, error: "Sensor API key is not allowed for this endpoint" };
  }

  return auth;
}

export function unauthorized(error: string, status = 401) {
  return NextResponse.json({ detail: error }, { status });
}

export function authContextToResponse(auth: AuthContext) {
  if (auth.ok) return null;
  return unauthorized(auth.error, auth.status);
}
