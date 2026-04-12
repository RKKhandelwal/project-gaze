import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.",
    );
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export function verifyApiKey(req: Request): boolean {
  const header = req.headers.get("x-api-key");
  return !!header && header === process.env.SUPABASE_SERVICE_ROLE_KEY;
}
