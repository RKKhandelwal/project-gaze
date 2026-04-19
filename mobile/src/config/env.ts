function required(value: string | undefined, key: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[config] Missing "${key}". Set it in mobile/.env.local as ${key}=...`,
    );
  }
  return value.trim();
}

function optional(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const env = {
  apiBaseUrl: required(
    typeof process !== "undefined" ? process.env.EXPO_PUBLIC_API_BASE_URL : undefined,
    "EXPO_PUBLIC_API_BASE_URL",
  ).replace(/\/+$/, ""),

  // Used by /api/auth/token to mint short-lived JWTs for the mobile client.
  mobileApiKey: required(
    typeof process !== "undefined" ? process.env.EXPO_PUBLIC_MOBILE_API_KEY : undefined,
    "EXPO_PUBLIC_MOBILE_API_KEY",
  ),

  // JWT subject claim; optional override, defaults in API client if omitted.
  deviceId: optional(
    typeof process !== "undefined" ? process.env.EXPO_PUBLIC_DEVICE_ID : undefined,
  ) ?? "mobile-client",
} as const;

export type Env = typeof env;

export function getApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${env.apiBaseUrl}${normalizedPath}`;
}
