"""
Project Gaze — Database Layer (Supabase)

All queries go through the Supabase Python client, which talks to the
hosted PostgreSQL instance via the REST API. The service_role key is used
for server-side writes (sensor events); the anon key would be used by
clients (but the iOS app uses the Swift SDK directly).
"""

import json
import statistics
from datetime import datetime, timedelta, timezone

from supabase import create_client, Client

from config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

# Use the service_role key so the server bypasses RLS for writes.
_client: Client | None = None


def get_db() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. "
                "Check your .env file or Vercel environment variables."
            )
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _client


# ---------- Init (no-op for Supabase — schema is managed via SQL migrations) ----------

async def init_db():
    """Verify connectivity. Tables are created via supabase_schema.sql, not here."""
    db = get_db()
    # Quick smoke test — fetch locations count.
    try:
        result = db.table("locations").select("id", count="exact").limit(0).execute()
        count = result.count if result.count is not None else 0
        print(f"Supabase connected. Locations: {count}")
    except Exception as e:
        print(f"Warning: Supabase connectivity check failed: {e}")


# ---------- Save a reading (sensor → event) ----------

async def save_reading(court_id: str, status: str, sensor_data: dict, timestamp: str):
    """Write a court status event to the events table.

    Maps the old reading-based interface to the new event-based model.
    For backward compat, court_id is matched to the courts table by name/number
    and sensor_id is optional (uses a default placeholder if no sensor is registered).
    """
    db = get_db()

    # Look up the court UUID from the court name (e.g., "court-1" → Court 1).
    # For the transition period, try matching by name pattern.
    court_result = db.table("courts").select("id").eq("name", court_id).limit(1).execute()

    if not court_result.data:
        # Try matching "Court X" format
        num = court_id.replace("court-", "")
        court_result = db.table("courts").select("id").eq("number", int(num) if num.isdigit() else 0).limit(1).execute()

    court_uuid = court_result.data[0]["id"] if court_result.data else None

    if not court_uuid:
        # Court not found in Supabase — skip (old prototype court IDs)
        return

    # Map status to event name
    event_name = "court_occupied" if status == "occupied" else "court_unoccupied"

    # Find any sensor assigned to this court (or None)
    sensor_result = db.table("sensors").select("id").eq("court_id", court_uuid).limit(1).execute()
    sensor_uuid = sensor_result.data[0]["id"] if sensor_result.data else None

    if sensor_uuid:
        db.table("events").insert({
            "event_name": event_name,
            "timestamp": timestamp,
            "sensor_id": sensor_uuid,
            "court_id": court_uuid,
            "payload": sensor_data or {},
        }).execute()

        # Update sensor last_seen_at
        db.table("sensors").update({"last_seen_at": timestamp}).eq("id", sensor_uuid).execute()


# ---------- Get all courts ----------

async def get_all_courts():
    """Return all courts with their current status derived from the latest event."""
    db = get_db()

    courts = db.table("courts").select("id, name, number, location_id").order("number").execute()

    result = []
    for court in (courts.data or []):
        status = "available"
        last_updated = None

        try:
            event = (
                db.table("events")
                .select("event_name, timestamp")
                .eq("court_id", court["id"])
                .order("timestamp", desc=True)
                .limit(1)
                .execute()
            )
            if event and event.data and len(event.data) > 0:
                status = "occupied" if event.data[0]["event_name"] == "court_occupied" else "available"
                last_updated = event.data[0]["timestamp"]
        except Exception:
            pass

        result.append({
            "court_id": court["name"].lower().replace(" ", "-"),
            "name": court["name"],
            "status": status,
            "last_updated": last_updated,
        })

    return result


# ---------- Court history ----------

async def get_court_history(court_id: str, hours: int = 24):
    """Get recent events for a court."""
    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

    # Resolve court UUID from the friendly ID
    court_uuid = await _resolve_court_id(court_id)
    if not court_uuid:
        return []

    events = (
        db.table("events")
        .select("id, event_name, timestamp, payload")
        .eq("court_id", court_uuid)
        .gte("timestamp", cutoff)
        .order("timestamp", desc=True)
        .limit(500)
        .execute()
    )

    return [
        {
            "id": e["id"],
            "court_id": court_id,
            "status": "occupied" if e["event_name"] == "court_occupied" else "available",
            "sensor_data": e["payload"],
            "timestamp": e["timestamp"],
        }
        for e in events.data
    ]


# ---------- Usage stats (predictions) ----------

async def get_usage_stats(court_id: str, days: int = 28):
    """Get occupancy stats grouped by day-of-week and hour for predictions."""
    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    court_uuid = await _resolve_court_id(court_id)
    if not court_uuid:
        return None

    events = (
        db.table("events")
        .select("event_name, timestamp")
        .eq("court_id", court_uuid)
        .gte("timestamp", cutoff)
        .order("timestamp")
        .execute()
    )

    rows = events.data
    if not rows:
        return None

    # Build occupancy ratio per (day_of_week, hour) bucket
    buckets = [[{"occupied": 0, "total": 0} for _ in range(24)] for _ in range(7)]

    for row in rows:
        try:
            ts = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue
        dow = ts.weekday()
        hour = ts.hour
        buckets[dow][hour]["total"] += 1
        if row["event_name"] == "court_occupied":
            buckets[dow][hour]["occupied"] += 1

    # Heatmap
    heatmap = []
    for dow in range(7):
        row_data = []
        for hour in range(24):
            b = buckets[dow][hour]
            pct = round(b["occupied"] / b["total"] * 100) if b["total"] > 0 else None
            row_data.append(pct)
        heatmap.append(row_data)

    # Peak hours
    hour_avg = []
    for hour in range(24):
        vals = [buckets[dow][hour] for dow in range(7)]
        total_occ = sum(v["occupied"] for v in vals)
        total_all = sum(v["total"] for v in vals)
        avg = round(total_occ / total_all * 100) if total_all > 0 else 0
        hour_avg.append({"hour": hour, "occupancy_pct": avg})

    hour_avg_sorted = sorted(hour_avg, key=lambda x: x["occupancy_pct"], reverse=True)
    peak_hours = [h for h in hour_avg_sorted[:3] if h["occupancy_pct"] > 0]

    # Best times (daytime only 7-22)
    daytime = [h for h in hour_avg if 7 <= h["hour"] <= 22]
    daytime_sorted = sorted(daytime, key=lambda x: x["occupancy_pct"])
    best_times = daytime_sorted[:3]

    # Current hour prediction
    now = datetime.now(timezone.utc)
    current_dow = now.weekday()
    current_hour = now.hour
    cb = buckets[current_dow][current_hour]
    current_pct = round(cb["occupied"] / cb["total"] * 100) if cb["total"] > 0 else None

    # Next 6 hours
    next_hours = []
    for offset in range(1, 7):
        future = now + timedelta(hours=offset)
        fb = buckets[future.weekday()][future.hour]
        pct = round(fb["occupied"] / fb["total"] * 100) if fb["total"] > 0 else None
        next_hours.append({"hour": future.hour, "occupancy_pct": pct})

    return {
        "heatmap": heatmap,
        "peak_hours": peak_hours,
        "best_times": best_times,
        "current_prediction": current_pct,
        "next_hours": next_hours,
        "data_days": days,
        "total_readings": sum(buckets[d][h]["total"] for d in range(7) for h in range(24)),
    }


# ---------- Daylight predictions ----------

async def get_daylight_predictions(court_id: str, days: int = 28, daylight_start: int = 6, daylight_end: int = 20):
    """Daylight-only predictions + session analysis."""
    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    court_uuid = await _resolve_court_id(court_id)
    if not court_uuid:
        return None

    events = (
        db.table("events")
        .select("event_name, timestamp")
        .eq("court_id", court_uuid)
        .gte("timestamp", cutoff)
        .order("timestamp")
        .execute()
    )

    if not events.data:
        return None

    parsed = []
    for row in events.data:
        try:
            ts = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue
        status = "occupied" if row["event_name"] == "court_occupied" else "available"
        parsed.append({"ts": ts, "status": status})

    # Daylight-filtered heatmap
    daylight_hours = list(range(daylight_start, daylight_end))
    buckets = [[{"occupied": 0, "total": 0} for _ in daylight_hours] for _ in range(7)]

    for p in parsed:
        if p["ts"].hour < daylight_start or p["ts"].hour >= daylight_end:
            continue
        dow = p["ts"].weekday()
        col = p["ts"].hour - daylight_start
        buckets[dow][col]["total"] += 1
        if p["status"] == "occupied":
            buckets[dow][col]["occupied"] += 1

    daylight_heatmap = []
    for dow in range(7):
        row_data = []
        for col in range(len(daylight_hours)):
            b = buckets[dow][col]
            pct = round(b["occupied"] / b["total"] * 100) if b["total"] > 0 else None
            row_data.append(pct)
        daylight_heatmap.append(row_data)

    # Hour averages
    hour_avg = []
    for col, hour in enumerate(daylight_hours):
        vals = [buckets[dow][col] for dow in range(7)]
        total_occ = sum(v["occupied"] for v in vals)
        total_all = sum(v["total"] for v in vals)
        avg = round(total_occ / total_all * 100) if total_all > 0 else 0
        hour_avg.append({"hour": hour, "occupancy_pct": avg})

    peak = sorted(hour_avg, key=lambda x: x["occupancy_pct"], reverse=True)
    peak_daylight = [h for h in peak[:3] if h["occupancy_pct"] > 0]
    best = sorted(hour_avg, key=lambda x: x["occupancy_pct"])
    best_daylight = best[:3]

    # Session analysis
    sessions = []
    session_start = None
    for p in parsed:
        is_daylight = daylight_start <= p["ts"].hour < daylight_end
        if p["status"] == "occupied" and session_start is None and is_daylight:
            session_start = p["ts"]
        elif session_start is not None:
            if p["status"] != "occupied" or not is_daylight:
                duration = (p["ts"] - session_start).total_seconds() / 60
                if duration > 0:
                    sessions.append(duration)
                session_start = None

    current_session = None
    now = datetime.now(timezone.utc)
    if parsed and parsed[-1]["status"] == "occupied":
        run_start = parsed[-1]["ts"]
        for i in range(len(parsed) - 2, -1, -1):
            if parsed[i]["status"] != "occupied":
                run_start = parsed[i + 1]["ts"]
                break
            if i == 0:
                run_start = parsed[0]["ts"]

        duration_min = (now - run_start).total_seconds() / 60
        median_dur = statistics.median(sessions) if sessions else 60
        est_remaining = max(0, round(median_dur - duration_min))
        current_session = {
            "started_at": run_start.isoformat(),
            "duration_min": round(duration_min),
            "est_remaining_min": est_remaining,
            "based_on_median_min": round(median_dur),
        }

    avg_session = round(statistics.mean(sessions)) if sessions else None
    median_session = round(statistics.median(sessions)) if sessions else None

    return {
        "daylight_heatmap": daylight_heatmap,
        "daylight_hours": daylight_hours,
        "peak_daylight_hours": peak_daylight,
        "best_daylight_times": best_daylight,
        "avg_session_min": avg_session,
        "median_session_min": median_session,
        "session_count": len(sessions),
        "current_session": current_session,
        "daylight_range": {"start": daylight_start, "end": daylight_end},
        "data_days": days,
        "total_daylight_readings": sum(
            buckets[d][c]["total"]
            for d in range(7)
            for c in range(len(daylight_hours))
        ),
    }


# ---------- Helpers ----------

async def _resolve_court_id(friendly_id: str) -> str | None:
    """Convert a friendly court ID like 'court-1' to a Supabase UUID."""
    db = get_db()

    # Try direct name match (e.g., "Court 1")
    name_guess = friendly_id.replace("-", " ").title()
    result = db.table("courts").select("id").eq("name", name_guess).limit(1).execute()
    if result.data:
        return result.data[0]["id"]

    # Try number match
    num = friendly_id.replace("court-", "")
    if num.isdigit():
        result = db.table("courts").select("id").eq("number", int(num)).limit(1).execute()
        if result.data:
            return result.data[0]["id"]

    return None
