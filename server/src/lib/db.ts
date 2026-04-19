import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

let cachedPool: Pool | null = null;

function getPool(): Pool {
  if (cachedPool) return cachedPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set in the environment.");
  }

  cachedPool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  return cachedPool;
}

/**
 * Shared Drizzle database instance for server routes/services.
 * Use this `db` object across the codebase to avoid creating duplicate pools.
 */
export const db = drizzle(getPool());

/**
 * Backward-compatible helper for modules that still expect a function accessor.
 */
export function getDb() {
  return db;
}

/**
 * Verifies sensor/server API key for protected machine-to-machine endpoints.
 * Preferred env var: SENSOR_API_KEY
 * Backward-compatible fallback: API_KEY
 */
export function verifyApiKey(req: Request): boolean {
  const header = req.headers.get("x-api-key");
  const expected = process.env.SENSOR_API_KEY ?? process.env.API_KEY;
  return Boolean(header && expected && header === expected);
}
