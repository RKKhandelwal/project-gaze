import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { courts } from "./schema";

/**
 * Resolves an external court identifier (`courts.public_id`)
 * to the internal numeric court ID (`courts.id`).
 *
 * Returns:
 * - internal numeric ID if found
 * - null if not found / empty input
 */
export async function resolveCourtId(courtPathId: string): Promise<number | null> {
  const db = getDb();

  const publicId = courtPathId.trim();
  if (!publicId) return null;

  const rows = await db
    .select({ id: courts.id })
    .from(courts)
    .where(eq(courts.publicId, publicId))
    .limit(1);

  if (rows.length === 0) return null;
  return rows[0].id;
}
