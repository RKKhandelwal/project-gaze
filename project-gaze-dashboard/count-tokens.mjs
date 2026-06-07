import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const bucket = process.env.R2_BUCKET || "mckenna-pickleball-feed-may-17";
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: "index.json" }));
const raw = await r.Body.transformToString("utf-8");
const index = JSON.parse(raw);

// Match what lib/gemini.ts sends to the model
const compactSegments = index.segments.map((s) => [
  s.fileID, s.start_utc, s.total_frames, s.max_people, Number(s.avg_people.toFixed(2)),
]);

const compactIndex = {
  totals: index.totals,
  daily_summary: index.daily_summary,
  occupancy_minute: index.occupancy_minute,
  segments_schema: ["fileID", "start_utc", "total_frames", "max_people", "avg_people"],
  segments: compactSegments,
};

const fullStr = JSON.stringify(index);
const compactStr = JSON.stringify(compactIndex);

console.log("Raw index.json:");
console.log(`  ${fullStr.length.toLocaleString()} chars`);
console.log(`  ${(fullStr.length / 1024).toFixed(1)} KB`);
console.log(`  ~${Math.round(fullStr.length / 4).toLocaleString()} tokens (4 char/tok heuristic)\n`);

console.log("Compact form (what gets sent to Gemini):");
console.log(`  ${compactStr.length.toLocaleString()} chars`);
console.log(`  ${(compactStr.length / 1024).toFixed(1)} KB`);
console.log(`  ~${Math.round(compactStr.length / 4).toLocaleString()} tokens (heuristic)\n`);

if (process.env.GOOGLE_API_KEY) {
  console.log("Asking Gemini's tokenizer for the exact count …");
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  const res = await ai.models.countTokens({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: compactStr }] }],
  });
  console.log(`  exact: ${res.totalTokens.toLocaleString()} tokens`);
} else {
  console.log("(set GOOGLE_API_KEY for an exact tokenizer count)");
}

console.log("\nBreakdown:");
const occStr = JSON.stringify(index.occupancy_minute);
const segStr = JSON.stringify(compactSegments);
const dayStr = JSON.stringify(index.daily_summary);
console.log(`  occupancy_minute : ${(occStr.length / 1024).toFixed(1)} KB  (${index.occupancy_minute.length} points)`);
console.log(`  segments         : ${(segStr.length / 1024).toFixed(1)} KB  (${compactSegments.length} segments)`);
console.log(`  daily_summary    : ${(dayStr.length / 1024).toFixed(1)} KB  (${Object.keys(index.daily_summary).length} days)`);
