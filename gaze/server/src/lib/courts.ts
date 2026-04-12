import { getDb } from "./supabase";

export async function resolveCourtId(friendlyId: string): Promise<string | null> {
  const db = getDb();

  const nameGuess = friendlyId
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const byName = await db
    .from("courts")
    .select("id")
    .eq("name", nameGuess)
    .limit(1);
  if (byName.data && byName.data.length > 0) return byName.data[0].id as string;

  const numStr = friendlyId.replace(/^court-/, "");
  if (/^\d+$/.test(numStr)) {
    const byNumber = await db
      .from("courts")
      .select("id")
      .eq("number", Number(numStr))
      .limit(1);
    if (byNumber.data && byNumber.data.length > 0) return byNumber.data[0].id as string;
  }

  return null;
}
