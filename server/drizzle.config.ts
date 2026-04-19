import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load environment variables from server/.env.local
loadEnv({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. Set it in server/.env.local before running drizzle-kit.",
  );
}

export default defineConfig({
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});
