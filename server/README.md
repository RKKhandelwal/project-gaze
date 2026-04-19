# Gaze Server

Next.js 16 (App Router, TypeScript) backend for Project Gaze, using **Drizzle ORM** with **PostgreSQL**.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/status` | Sensor reports status by `sensor_id` (requires `x-api-key` header); server resolves linked `court_id` from DB |
| GET | `/api/courts` | List all courts with current status |
| GET | `/api/courts/[courtId]/history?hours=24` | Recent events for a court |
| GET | `/api/courts/[courtId]/predictions?days=28` | Occupancy heatmap + peak/best times |
| GET | `/api/courts/[courtId]/daylight?days=28&start=6&end=20` | Daylight-filtered predictions + session analysis |

---

## Environment Variables

Create `server/.env.local` and set:

- `DATABASE_URL` — PostgreSQL connection string (Drizzle + node-postgres)
- `SENSOR_API_KEY` — API key required by `POST /api/status` via `x-api-key` header  
  (fallback supported: `API_KEY`)

### Example

```env
DATABASE_URL=postgresql://postgres.jteplcdbfdsiyzhfqkxh:[YOUR-PASSWORD]@aws-1-us-west-1.pooler.supabase.com:6543/postgres
SENSOR_API_KEY=replace-with-a-long-random-secret
```

> Keep `.env.local` out of source control and never expose `SENSOR_API_KEY` in mobile/web clients.

---

## Local Development

From repo root (`project-gaze/`):

```bash
npm install
npm --workspace server run dev
```

Or from `server/` directly:

```bash
npm install
npm run dev
```

Server starts at:

- `http://localhost:3000`

---

## Database Notes (Drizzle + Postgres)

- DB access is configured in `src/lib/db.ts`.
- Table definitions live in `src/lib/schema.ts`.
- Route handlers query Postgres through Drizzle.
- Existing SQL schema is in `db/schema.sql` (apply in your DB once before running API reads/writes).

---

## Quick Health Checks

### 1) CORS preflight

```bash
curl -i -X OPTIONS http://localhost:3000/api/courts \
  -H "Origin: http://localhost:8081" \
  -H "Access-Control-Request-Method: GET"
```

Expected: `204` + `access-control-allow-origin` headers.

### 2) Courts API

```bash
curl -i http://localhost:3000/api/courts
```

Expected: `200` with JSON list of courts (assuming DB has data).

### 3) Status ingest auth check

```bash
curl -i -X POST http://localhost:3000/api/status \
  -H "Content-Type: application/json" \
  -H "x-api-key: wrong-key" \
  -d '{"sensor_id":"8d6d0e6d-8d23-4f44-9705-a78de5f7d781","status":"occupied","timestamp":"2026-01-01T00:00:00Z"}'
```

Expected: `401 Invalid API key`.

### 4) Status ingest contract (sensor-driven)

`POST /api/status` now accepts sensor identity, not court identity.

Request body:

```json
{
  "sensor_id": "8d6d0e6d-8d23-4f44-9705-a78de5f7d781",
  "status": "occupied",
  "timestamp": "2026-04-19T21:20:00Z",
  "sensor_data": {
    "source": "manual-test",
    "activity_score": 0.87
  }
}
```

Server behavior:

1. Verifies `x-api-key` against `SENSOR_API_KEY` (or `API_KEY` fallback).
2. Looks up sensor by `sensors.id = sensor_id`.
3. Uses `sensors.court_id` to determine which court to update.
4. Inserts occupancy event into `events`.
5. Updates `sensors.last_seen_at`.
6. Broadcasts live update to connected SSE clients.

Possible non-error skip responses:

- `{"ok": true, "skipped": "sensor_not_found"}`
- `{"ok": true, "skipped": "sensor_unassigned"}`

Successful response:

- `{"ok": true}`

Example request:

```bash
curl -i -X POST http://localhost:3000/api/status \
  -H "Content-Type: application/json" \
  -H "x-api-key: $SENSOR_API_KEY" \
  -d '{
    "sensor_id":"8d6d0e6d-8d23-4f44-9705-a78de5f7d781",
    "status":"available",
    "timestamp":"2026-04-19T21:25:00Z",
    "sensor_data":{"source":"manual-test","activity_score":0.04}
  }'
```

---

## Troubleshooting

### `DATABASE_URL must be set in the environment`
- Ensure `server/.env.local` exists.
- Restart dev server after editing env vars.

### `Invalid API key` on `/api/status`
- Send `x-api-key` header.
- Ensure it matches `SENSOR_API_KEY` (or `API_KEY` fallback) in `server/.env.local`.

### Browser reports CORS/fetch errors
- Confirm server is actually returning `200` (not `500`) for `/api/courts`.
- Many browser “CORS” messages are caused by backend runtime errors.