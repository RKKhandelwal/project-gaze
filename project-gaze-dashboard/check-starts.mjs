import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const BUCKET = process.env.R2_BUCKET || "mckenna-pickleball-feed-may-17";
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function listAll(prefix) {
  const out = [];
  let token;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const o of r.Contents || []) out.push(o);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function getText(key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return r.Body.transformToString("utf-8");
}

const annots = await listAll("annotations/");
console.log(`scanning ${annots.length} annotation files…\n`);

let nullCount = 0;
let setCount = 0;
const sampleSet = [];
const sampleNull = [];

let done = 0;
const CONC = 16;
let idx = 0;

await new Promise((resolve) => {
  const next = () => {
    if (idx >= annots.length) {
      if (done === annots.length) resolve();
      return;
    }
    const o = annots[idx++];
    getText(o.Key)
      .then((txt) => {
        try {
          const j = JSON.parse(txt.trim().split("\n")[0]);
          if (j.segment_start_utc == null) {
            nullCount++;
            if (sampleNull.length < 3) sampleNull.push({ key: o.Key, j });
          } else {
            setCount++;
            if (sampleSet.length < 3) sampleSet.push({ key: o.Key, j });
          }
        } catch {
          nullCount++;
        }
        done++;
        next();
      })
      .catch(() => {
        done++;
        next();
      });
  };
  for (let i = 0; i < Math.min(CONC, annots.length); i++) next();
});

console.log(`segment_start_utc populated : ${setCount}`);
console.log(`segment_start_utc null      : ${nullCount}\n`);

if (sampleSet.length) {
  console.log("--- example with timestamp ---");
  for (const s of sampleSet) console.log(s.key, "→", JSON.stringify(s.j));
}
if (sampleNull.length) {
  console.log("\n--- example with null timestamp ---");
  for (const s of sampleNull) console.log(s.key, "→", JSON.stringify(s.j));
}
