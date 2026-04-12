# Gaze Server

Next.js 16 (App Router, TypeScript) backend for Project Gaze. Deployed on Vercel, backed by Supabase Postgres.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/status` | Sensor reports court status (requires `x-api-key` header) |
| GET | `/api/courts` | List all courts with current status |
| GET | `/api/courts/[courtId]/history?hours=24` | Recent events for a court |
| GET | `/api/courts/[courtId]/predictions?days=28` | Occupancy heatmap + peak/best times |
| GET | `/api/courts/[courtId]/daylight?days=28&start=6&end=20` | Daylight-filtered predictions + session analysis |

## Local dev

```bash
cp .env.example .env.local   # fill in SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

## Environment

- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — server-side key; bypasses RLS and is also accepted as `x-api-key` for sensor POSTs

## Schema

See `db/schema.sql`. Apply via Supabase SQL editor.
