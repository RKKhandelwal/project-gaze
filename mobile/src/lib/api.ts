import type {
  Court,
  Location,
  CourtStatusUpdateEvent,
  StreamConnectedEvent,
  StreamPingEvent,
  StreamMessage,
  StatusPostResponse,
} from "@gaze/types";

/**
 * Server-sent message models for live updates.
 */

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

type EventSourceLikeEvent = {
  data: string;
};

type EventSourceLike = {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener(event: string, cb: (event: EventSourceLikeEvent) => void): void;
  close(): void;
};

type EventSourceFactory = (url: string) => EventSourceLike;

type JwtTokenResponse = {
  token_type: "Bearer";
  access_token: string;
  expires_in: number;
};

// StreamConnectedEvent, StreamPingEvent, and StreamMessage are imported
// from the shared types package.

export class ApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface ApiClientOptions {
  /**
   * API base URL, e.g. "http://localhost:3000"
   */
  baseUrl?: string;
  /**
   * Mobile API key used once to mint short-lived JWTs.
   * Expected to map to server-side MOBILE_API_KEY validation.
   */
  mobileApiKey?: string;
  /**
   * Device identifier used as JWT subject claim.
   */
  deviceId?: string;
  /**
   * Custom fetch implementation (tests/mocks).
   */
  fetchImpl?: FetchFn;
  /**
   * Optional EventSource implementation for non-browser runtimes.
   */
  eventSourceFactory?: EventSourceFactory;
}

export interface StreamSubscriptionOptions {
  onMessage: (message: StreamMessage) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
}

/**
 * Internal auth cache for JWT lifecycle.
 */
type AuthState = {
  token: string | null;
  tokenExpiresAtMs: number;
  inflightMintPromise: Promise<string> | null;
};

function required(value: string | undefined, key: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`[api] Missing required config "${key}".`);
  }
  return value;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function resolveBaseUrl(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) {
    return trimTrailingSlash(explicit);
  }

  const envBase =
    typeof process !== "undefined" ? process.env.EXPO_PUBLIC_API_BASE_URL : undefined;

  return trimTrailingSlash(required(envBase, "EXPO_PUBLIC_API_BASE_URL"));
}

function resolveMobileApiKey(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }

  const envKey =
    typeof process !== "undefined" ? process.env.EXPO_PUBLIC_MOBILE_API_KEY : undefined;

  return required(envKey, "EXPO_PUBLIC_MOBILE_API_KEY").trim();
}

function resolveDeviceId(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) return explicit.trim();

  const envDeviceId =
    typeof process !== "undefined" ? process.env.EXPO_PUBLIC_DEVICE_ID : undefined;

  // Not strictly required; default keeps token minting deterministic.
  return envDeviceId?.trim() || "mobile-client";
}

function defaultFetch(): FetchFn {
  return (input, init) => globalThis.fetch(input, init);
}

function getGlobalEventSourceFactory(): EventSourceFactory | null {
  const maybeGlobal = globalThis as unknown as {
    EventSource?: new (url: string) => EventSourceLike;
  };

  if (typeof maybeGlobal.EventSource === "function") {
    return (url: string) => new maybeGlobal.EventSource!(url);
  }

  return null;
}

async function parseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function isCourt(value: unknown): value is Court {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const validStatus =
    v.status === "unknown" || v.status === "available" || v.status === "occupied";

  return (
    typeof v.court_id === "string" &&
    typeof v.name === "string" &&
    validStatus &&
    (typeof v.last_updated === "string" || v.last_updated === null)
  );
}

function assertCourts(payload: unknown): Court[] {
  if (!Array.isArray(payload) || !payload.every(isCourt)) {
    throw new Error("Invalid courts response shape.");
  }
  return payload;
}

function isLocation(value: unknown): value is Location {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.latitude === "number" &&
    typeof v.longitude === "number"
  );
}

function assertLocations(payload: unknown): Location[] {
  if (!Array.isArray(payload) || !payload.every(isLocation)) {
    throw new Error("Invalid locations response shape.");
  }
  return payload;
}

function parseStreamMessage(raw: unknown): StreamMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  if (value.type === "court_status_update") {
    if (
      typeof value.court_id === "string" &&
      (value.status === "unknown" ||
        value.status === "available" ||
        value.status === "occupied") &&
      typeof value.timestamp === "string"
    ) {
      return {
        type: "court_status_update",
        court_id: value.court_id,
        status: value.status,
        timestamp: value.timestamp,
        source:
          value.source === "status_api" ||
          value.source === "db_write" ||
          value.source === "manual"
            ? value.source
            : undefined,
      } as CourtStatusUpdateEvent;
    }
    return null;
  }

  if (
    value.type === "connected" &&
    value.transport === "sse" &&
    typeof value.timestamp === "string"
  ) {
    return {
      type: "connected",
      transport: "sse",
      timestamp: value.timestamp,
    };
  }

  if (
    value.type === "ping" &&
    typeof value.timestamp === "string" &&
    typeof value.listeners === "number"
  ) {
    return {
      type: "ping",
      timestamp: value.timestamp,
      listeners: value.listeners,
    };
  }

  return null;
}

function safeParseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly mobileApiKey: string;
  private readonly deviceId: string;
  private readonly fetchImpl: FetchFn;
  private readonly eventSourceFactory: EventSourceFactory | null;

  private readonly authState: AuthState = {
    token: null,
    tokenExpiresAtMs: 0,
    inflightMintPromise: null,
  };

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = resolveBaseUrl(options.baseUrl);
    this.mobileApiKey = resolveMobileApiKey(options.mobileApiKey);
    this.deviceId = resolveDeviceId(options.deviceId);
    this.fetchImpl = options.fetchImpl ?? defaultFetch();
    this.eventSourceFactory =
      options.eventSourceFactory ?? getGlobalEventSourceFactory();
  }

  private isTokenFresh(): boolean {
    if (!this.authState.token) return false;
    // refresh 30s early to avoid edge-of-expiry failures
    return Date.now() < this.authState.tokenExpiresAtMs - 30_000;
  }

  private async mintJwtToken(): Promise<string> {
    const url = `${this.baseUrl}/api/auth/token`;

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-mobile-api-key": this.mobileApiKey,
      },
      body: JSON.stringify({ device_id: this.deviceId }),
    });

    const body = (await parseBody(response)) as unknown;

    if (!response.ok) {
      throw new ApiError(
        `Failed to mint JWT token (HTTP ${response.status}).`,
        response.status,
        body,
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      (body as Record<string, unknown>).token_type !== "Bearer" ||
      typeof (body as Record<string, unknown>).access_token !== "string" ||
      typeof (body as Record<string, unknown>).expires_in !== "number"
    ) {
      throw new Error("Invalid token response shape.");
    }

    const tokenBody = body as JwtTokenResponse;
    this.authState.token = tokenBody.access_token;
    this.authState.tokenExpiresAtMs = Date.now() + tokenBody.expires_in * 1000;

    return tokenBody.access_token;
  }

  private async getAccessToken(): Promise<string> {
    if (this.isTokenFresh()) {
      return this.authState.token as string;
    }

    if (this.authState.inflightMintPromise) {
      return this.authState.inflightMintPromise;
    }

    this.authState.inflightMintPromise = this.mintJwtToken().finally(() => {
      this.authState.inflightMintPromise = null;
    });

    return this.authState.inflightMintPromise;
  }

  private async authedRequest(
    path: string,
    init?: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
  ): Promise<Response> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    };

    return this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
  }

  async fetchCourts(signal?: AbortSignal): Promise<Court[]> {
    const response = await this.authedRequest("/api/courts", {
      method: "GET",
      signal,
    });

    const body = await parseBody(response);

    if (!response.ok) {
      throw new ApiError(
        `Failed to fetch courts (HTTP ${response.status}).`,
        response.status,
        body,
      );
    }

    return assertCourts(body);
  }

  async fetchLocations(signal?: AbortSignal): Promise<Location[]> {
    const response = await this.authedRequest("/api/locations", {
      method: "GET",
      signal,
    });

    const body = await parseBody(response);

    if (!response.ok) {
      throw new ApiError(
        `Failed to fetch locations (HTTP ${response.status}).`,
        response.status,
        body,
      );
    }

    return assertLocations(body);
  }

  async fetchCourtsByLocation(
    locationId: string,
    signal?: AbortSignal,
  ): Promise<Court[]> {
    const encodedLocationId = encodeURIComponent(locationId);

    const response = await this.authedRequest(
      `/api/locations/${encodedLocationId}/courts`,
      {
        method: "GET",
        signal,
      },
    );

    const body = await parseBody(response);

    if (!response.ok) {
      throw new ApiError(
        `Failed to fetch courts for location ${locationId} (HTTP ${response.status}).`,
        response.status,
        body,
      );
    }

    return assertCourts(body);
  }

  subscribeToCourtUpdates(options: StreamSubscriptionOptions): () => void {
    const { onMessage, onError, onOpen } = options;

    if (!this.eventSourceFactory) {
      onError?.(
        new Error(
          "EventSource is not available in this runtime. Provide eventSourceFactory in ApiClient options.",
        ),
      );
      return () => {};
    }

    // Fire-and-forget bootstrap:
    // obtain token first, then open SSE with access_token query.
    let eventSource: EventSourceLike | null = null;
    let cancelled = false;

    void this.getAccessToken()
      .then((token) => {
        if (cancelled) return;
        const streamUrl = `${this.baseUrl}/api/stream?access_token=${encodeURIComponent(
          token,
        )}`;
        eventSource = this.eventSourceFactory!(streamUrl);

        const forwardEvent = (event: EventSourceLikeEvent) => {
          const parsed = safeParseJson(event.data);
          const message = parseStreamMessage(parsed);
          if (message) onMessage(message);
        };

        eventSource.onopen = () => {
          onOpen?.();
        };

        eventSource.onerror = () => {
          onError?.(new Error("SSE stream disconnected."));
        };

        eventSource.addEventListener("message", (event) => {
          try {
            forwardEvent(event);
          } catch (err) {
            onError?.(
              err instanceof Error
                ? err
                : new Error("Invalid SSE message payload."),
            );
          }
        });

        eventSource.addEventListener("connected", (event) => {
          try {
            forwardEvent(event);
          } catch (err) {
            onError?.(
              err instanceof Error
                ? err
                : new Error("Invalid SSE connected payload."),
            );
          }
        });

        eventSource.addEventListener("ping", (event) => {
          try {
            forwardEvent(event);
          } catch (err) {
            onError?.(
              err instanceof Error ? err : new Error("Invalid SSE ping payload."),
            );
          }
        });
      })
      .catch((err) => {
        onError?.(err instanceof Error ? err : new Error("Failed to open SSE stream."));
      });

    return () => {
      cancelled = true;
      if (eventSource) {
        eventSource.close();
      }
    };
  }

  /**
   * Optional helper for posting sensor status with shared contract typing.
   * Not currently used by the mobile app UI flow.
   */
  async postSensorStatus(
    payload: {
      sensor_id: string;
      status: "occupied" | "available";
      timestamp: string;
      sensor_data?: Record<string, unknown>;
    },
    signal?: AbortSignal,
  ): Promise<StatusPostResponse> {
    const response = await this.authedRequest("/api/status", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await parseBody(response);

    if (!response.ok) {
      throw new ApiError(
        `Failed to post sensor status (HTTP ${response.status}).`,
        response.status,
        body,
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).ok !== "boolean"
    ) {
      throw new Error("Invalid /api/status response shape.");
    }

    return body as StatusPostResponse;
  }
}
