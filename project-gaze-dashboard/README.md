# Project Gaze — Pickleball Court Occupancy Dashboard

Next.js (App Router) dashboard for McKenzie Park pickleball court occupancy
data stored in a private Cloudflare R2 bucket. All R2 access is server-side:
the browser talks to two API routes, never directly to R2.

## Setup

```bash
npm install
cp .env.local.example .env.local
# fill in R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY
npm run dev
```

## Environment variables

| Var | Description |
|-----|-------------|
| `R2_ENDPOINT` | R2 S3-compatible endpoint, e.g. `https://<account>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET` | Bucket name (defaults to `mckenna-pickleball-feed-may-17`) |

## Deploy to Vercel

```bash
vercel deploy
```

Set the env vars above in the Vercel project dashboard. No public R2 access is
required.

## API surface

- `GET /api/index` — fetches `index.json` from R2 and returns it. Edge-cached
  for 60s.
- `GET /api/video?fileID=<id>` — returns `{ url, expiresAt }` where `url` is a
  presigned GET URL for `overlays/<id>.mp4`, valid for 1 hour. `fileID` is
  validated against `^[A-Za-z0-9_-]{1,128}$`.
