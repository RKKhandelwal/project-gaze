import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const bucket = process.env.R2_BUCKET || "mckenna-pickleball-feed-may-17";
console.log("bucket:", bucket, "\n");

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function head(key) {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return `OK (${r.ContentLength} bytes)`;
  } catch (e) {
    return `MISSING (${e.name})`;
  }
}

console.log("index.json       :", await head("index.json"));

async function countPrefix(prefix) {
  let token;
  let count = 0;
  let sample;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    count += r.KeyCount ?? 0;
    if (!sample && r.Contents?.[0]) sample = r.Contents[0].Key;
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return { count, sample };
}

for (const p of ["annotations/", "frames/", "overlays/"]) {
  const { count, sample } = await countPrefix(p);
  console.log(`${p.padEnd(17)}: ${count} keys`, sample ? `(e.g. ${sample})` : "");
}
