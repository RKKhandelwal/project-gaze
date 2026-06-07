import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const BUCKET =
  process.env.R2_BUCKET || "mckenna-pickleball-feed-may-17";

let cachedClient: S3Client | null = null;

export function getS3(): S3Client {
  if (cachedClient) return cachedClient;

  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be set",
    );
  }

  cachedClient = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cachedClient;
}

export async function presignOverlay(
  fileID: string,
  expiresIn = 3600,
): Promise<string> {
  const s3 = getS3();
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: `overlays/${fileID}.mp4`,
    }),
    { expiresIn },
  );
}

export async function fetchIndexJson(): Promise<unknown> {
  const s3 = getS3();
  const res = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: "index.json" }),
  );
  if (!res.Body) {
    throw new Error("index.json has no body");
  }
  const body = await res.Body.transformToString("utf-8");
  return JSON.parse(body);
}
