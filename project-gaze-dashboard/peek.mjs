import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
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

async function get(key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return r.Body.transformToString("utf-8");
}

const fid = "13476197482";
console.log(`--- annotations/${fid}.jsonl ---`);
console.log(await get(`annotations/${fid}.jsonl`));
console.log(`\n--- frames/${fid}.jsonl (first 3 lines) ---`);
const frames = await get(`frames/${fid}.jsonl`);
console.log(frames.split("\n").slice(0, 3).join("\n"));
console.log(`\n(total frame lines: ${frames.trim().split("\n").length})`);
