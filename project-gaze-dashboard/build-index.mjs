// Build index.json from what's already in R2 and upload it.
// Uses overlay LastModified as the segment start when the annotation's
// segment_start_utc is null. Run with: node build-index.mjs

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const BUCKET = process.env.R2_BUCKET || "mckenna-pickleball-feed-may-17";
const OVERLAYS_PREFIX = "overlays/";
const ANNOTATIONS_PREFIX = "annotations/";
const FRAMES_PREFIX = "frames/";
const INDEX_KEY = "index.json";
const CONCURRENCY = 16;
// Filename timestamps (the 14-digit prefix) are UTC, e.g.
//   20260517130105_13491621984.mp4 → 2026-05-17 13:01:05 UTC.
// The frontend's timezone picker is what shifts displayed times to Pacific etc.
const FILEID_TS_RE = /^(\d{14})(?:_|$)/;

function startMsFromFileID(fileID) {
  const m = FILEID_TS_RE.exec(fileID);
  if (!m) return null;
  const s = m[1]; // YYYYMMDDHHMMSS, already UTC
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  const hour = Number(s.slice(8, 10));
  const minute = Number(s.slice(10, 12));
  const second = Number(s.slice(12, 14));
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

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

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.floor((p / 100) * sortedAsc.length),
  );
  return sortedAsc[idx];
}

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  let done = 0;
  await new Promise((resolve, reject) => {
    const next = () => {
      if (idx >= items.length) {
        if (done === items.length) resolve();
        return;
      }
      const my = idx++;
      fn(items[my], my)
        .then((r) => {
          results[my] = r;
          done++;
          if (done % 20 === 0 || done === items.length) {
            process.stderr.write(`  processed ${done}/${items.length}\n`);
          }
          next();
        })
        .catch(reject);
    };
    for (let i = 0; i < Math.min(limit, items.length); i++) next();
  });
  return results;
}

console.log(`bucket: ${BUCKET}`);
console.log("listing overlays/ …");
const overlayObjs = await listAll(OVERLAYS_PREFIX);
console.log(`  found ${overlayObjs.length} overlay objects\n`);

console.log("listing annotations/ …");
const annotKeys = new Set(
  (await listAll(ANNOTATIONS_PREFIX)).map((o) => o.Key),
);
console.log(`  found ${annotKeys.size} annotation objects\n`);

console.log("listing frames/ …");
const frameKeys = new Set(
  (await listAll(FRAMES_PREFIX)).map((o) => o.Key),
);
console.log(`  found ${frameKeys.size} frame objects\n`);

console.log(
  "fetching per-segment data (annotation + frames) — this may take a minute…",
);

let nullStartCount = 0;

const perSegment = await mapConcurrent(overlayObjs, CONCURRENCY, async (o) => {
  const fileID = o.Key.replace(OVERLAYS_PREFIX, "").replace(/\.mp4$/, "");
  const annotKey = `${ANNOTATIONS_PREFIX}${fileID}.jsonl`;
  const framesKey = `${FRAMES_PREFIX}${fileID}.jsonl`;

  let annot = null;
  if (annotKeys.has(annotKey)) {
    try {
      const txt = await getText(annotKey);
      annot = JSON.parse(txt.trim().split("\n")[0]);
    } catch {}
  }

  let frameDetCounts = [];
  if (frameKeys.has(framesKey)) {
    try {
      const txt = await getText(framesKey);
      for (const line of txt.split("\n")) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          frameDetCounts.push({
            t: typeof j.t === "number" ? j.t : 0,
            count: Array.isArray(j.dets) ? j.dets.length : 0,
          });
        } catch {}
      }
    } catch {}
  }

  let startMs;
  let startSource;
  if (annot?.segment_start_utc) {
    startMs = Date.parse(
      annot.segment_start_utc.endsWith("Z")
        ? annot.segment_start_utc
        : annot.segment_start_utc + "Z",
    );
    startSource = "annotation";
  } else {
    const fromID = startMsFromFileID(fileID);
    if (fromID != null) {
      startMs = fromID;
      startSource = "fileID";
    } else {
      nullStartCount++;
      startMs = o.LastModified
        ? new Date(o.LastModified).getTime()
        : Date.now();
      startSource = "lastModified";
    }
  }

  const totalFrames =
    annot?.total_frames ?? frameDetCounts.length;
  const fps = annot?.fps ?? 4.0;
  const maxPeople =
    annot?.max_people_in_frame ??
    frameDetCounts.reduce((m, f) => Math.max(m, f.count), 0);
  const avgPeople =
    annot?.avg_people_per_frame ??
    (frameDetCounts.length
      ? frameDetCounts.reduce((s, f) => s + f.count, 0) /
        frameDetCounts.length
      : 0);

  return {
    fileID,
    startMs,
    startSource,
    totalFrames,
    fps,
    maxPeople,
    avgPeople,
    overlayKey: o.Key,
    frameDetCounts,
  };
});

const sources = perSegment.reduce(
  (acc, s) => ((acc[s.startSource] = (acc[s.startSource] || 0) + 1), acc),
  {},
);
console.log(`\nstart_utc source breakdown:`);
for (const [k, v] of Object.entries(sources)) console.log(`  ${k}: ${v}`);
console.log();

// Bucket per-frame detection counts into per-minute buckets, then p95 per minute.
const minuteBuckets = new Map();
for (const seg of perSegment) {
  for (const fd of seg.frameDetCounts) {
    const frameMs = seg.startMs + Math.round(fd.t * 1000);
    const minMs = Math.floor(frameMs / 60000) * 60000;
    if (!minuteBuckets.has(minMs)) minuteBuckets.set(minMs, []);
    minuteBuckets.get(minMs).push(fd.count);
  }
}

const occupancy_minute = [...minuteBuckets.entries()]
  .map(([ms, counts]) => {
    counts.sort((a, b) => a - b);
    return [ms, percentile(counts, 95)];
  })
  .sort((a, b) => a[0] - b[0]);

const daily_summary = {};
const segByDay = new Map();
for (const seg of perSegment) {
  const k = dayKey(seg.startMs);
  if (!segByDay.has(k)) segByDay.set(k, []);
  segByDay.get(k).push(seg);
}
for (const [k, segs] of segByDay) {
  const dayMinutePoints = occupancy_minute.filter(
    ([ms]) => dayKey(ms) === k,
  );
  const dayMax = dayMinutePoints.reduce((m, p) => Math.max(m, p[1]), 0);
  daily_summary[k] = {
    max: dayMax,
    total_frames: segs.reduce((s, g) => s + g.totalFrames, 0),
    segments: segs.length,
  };
}

const startsMs = perSegment.map((s) => s.startMs);
const earliestMs = Math.min(...startsMs);
const latestMs = Math.max(...startsMs);
const peakOccupancy = occupancy_minute.reduce(
  (m, p) => Math.max(m, p[1]),
  0,
);
const totalFramesAll = perSegment.reduce((s, g) => s + g.totalFrames, 0);

const segments = perSegment
  .sort((a, b) => a.startMs - b.startMs)
  .map((s) => ({
    fileID: s.fileID,
    start_utc: new Date(s.startMs).toISOString(),
    total_frames: s.totalFrames,
    fps: Number(s.fps.toFixed(2)),
    max_people: s.maxPeople,
    avg_people: Number(s.avgPeople.toFixed(2)),
    overlay_key: s.overlayKey,
  }));

const index = {
  generated_at: new Date().toISOString(),
  bucket: BUCKET,
  overlays_prefix: OVERLAYS_PREFIX,
  totals: {
    total_segments: perSegment.length,
    total_frames: totalFramesAll,
    earliest_utc: new Date(earliestMs).toISOString(),
    latest_utc: new Date(latestMs).toISOString(),
    peak_occupancy: peakOccupancy,
  },
  occupancy_minute,
  daily_summary,
  segments,
  _note:
    nullStartCount > 0
      ? `${nullStartCount} segments used R2 LastModified as start_utc (annotation segment_start_utc was null).`
      : undefined,
};

const body = Buffer.from(JSON.stringify(index));
console.log(
  `index.json: ${body.length.toLocaleString()} bytes  (${occupancy_minute.length} minutes, ${segments.length} segments, ${Object.keys(daily_summary).length} days)`,
);
console.log("uploading to r2://" + BUCKET + "/" + INDEX_KEY + " …");
await s3.send(
  new PutObjectCommand({
    Bucket: BUCKET,
    Key: INDEX_KEY,
    Body: body,
    ContentType: "application/json",
    CacheControl: "max-age=60",
  }),
);
console.log("done.");
