#!/usr/bin/env python3
"""
Project Gaze — Mock Data Seeder

Seeds the Gaze SQLite database with 28 days of realistic mock readings so the
dashboard has something to display before a real sensor is wired up.

Usage (from gaze/server/ with the venv activated):
    python mock_data.py                   # seed 28 days, 8 default courts
    python mock_data.py --reset           # wipe readings table first, then seed
    python mock_data.py --days 14         # override duration
    python mock_data.py --seed 42         # deterministic (reproducible) output

The script creates 1 reading per court per hour over the window — for 8 courts
over 28 days that's 5,376 rows, which inserts in under a second.

Occupancy patterns roughly mimic a real tennis club schedule:
- Weekday evenings (17:00-21:00) are the busiest.
- Weekend mid-day (11:00-16:00) is the weekend peak.
- Overnight (22:00-06:00) is almost always empty.
- Each court has a small popularity bias (±15%) so not all courts look identical.

Note: timestamps are stored in UTC. The dashboard heatmap displays them in UTC
hours, so the patterns above are what you'll see on the chart — a "peak at 18"
cell means "lots of readings with status=occupied at hour 18 UTC".
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Make config.py importable regardless of which directory we're run from.
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import aiosqlite  # noqa: E402

from config import DATABASE_PATH, DEFAULT_COURTS  # noqa: E402


# --- Occupancy patterns -----------------------------------------------------
# Each entry maps an hour (0-23) to the probability [0.0-1.0] that the court
# is occupied at that hour. These are the *base* probabilities before per-court
# variation and per-reading noise.

WEEKDAY_OCCUPANCY: dict[int, float] = {
    # Overnight — almost always empty
    **{h: 0.05 for h in range(0, 6)},
    # Early morning — a few early risers
    **{h: 0.15 for h in range(6, 8)},
    # Morning — light activity
    **{h: 0.25 for h in range(8, 11)},
    # Midday — moderate
    **{h: 0.35 for h in range(11, 16)},
    # Late afternoon — picking up
    16: 0.50,
    # Evening peak — busiest
    **{h: 0.80 for h in range(17, 21)},
    # Late evening — winding down
    21: 0.45,
    **{h: 0.20 for h in range(22, 24)},
}

WEEKEND_OCCUPANCY: dict[int, float] = {
    **{h: 0.05 for h in range(0, 7)},
    **{h: 0.20 for h in range(7, 9)},
    **{h: 0.50 for h in range(9, 11)},
    # Weekend midday is the peak
    **{h: 0.70 for h in range(11, 16)},
    **{h: 0.60 for h in range(16, 19)},
    **{h: 0.40 for h in range(19, 21)},
    **{h: 0.20 for h in range(21, 24)},
}


def occupancy_probability(dow: int, hour: int, court_index: int) -> float:
    """Probability [0.0-1.0] that a given court is occupied at a given hour.

    dow: 0=Mon ... 6=Sun
    hour: 0-23 (UTC)
    court_index: 0-based index into DEFAULT_COURTS — used to give each court
        a slightly different popularity bias so the heatmaps aren't identical.
    """
    base = WEEKEND_OCCUPANCY[hour] if dow >= 5 else WEEKDAY_OCCUPANCY[hour]
    # Popularity bias: courts 0-7 map to roughly -14% .. +14%
    court_bias = (court_index - 3.5) * 0.04
    return max(0.0, min(1.0, base + court_bias))


# --- DB helpers -------------------------------------------------------------


def _resolve_db_path() -> str:
    """Resolve DATABASE_PATH — if it's relative, anchor it to SCRIPT_DIR so the
    script works no matter where it's invoked from."""
    p = Path(DATABASE_PATH)
    if not p.is_absolute():
        p = SCRIPT_DIR / p
    return str(p)


async def _ensure_schema(db: aiosqlite.Connection) -> None:
    """Create tables and seed default courts if missing. Mirrors init_db()."""
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS courts (
            court_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'available',
            last_updated TEXT
        )
        """
    )
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            court_id TEXT NOT NULL,
            status TEXT NOT NULL,
            sensor_data TEXT NOT NULL DEFAULT '{}',
            timestamp TEXT NOT NULL
        )
        """
    )
    await db.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_readings_court_ts
        ON readings (court_id, timestamp)
        """
    )
    for court in DEFAULT_COURTS:
        await db.execute(
            "INSERT OR IGNORE INTO courts (court_id, name, status) "
            "VALUES (?, ?, 'available')",
            (court["court_id"], court["name"]),
        )


async def seed(days: int, reset: bool) -> int:
    """Generate mock readings. Returns the number of rows inserted."""
    db_path = _resolve_db_path()
    async with aiosqlite.connect(db_path) as db:
        await _ensure_schema(db)

        if reset:
            await db.execute("DELETE FROM readings")
            print("Wiped readings table.")

        # Align "now" to the top of the current hour in UTC.
        now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        start = now - timedelta(days=days)

        inserted = 0
        latest_status: dict[str, str] = {}
        latest_ts: dict[str, str] = {}

        for court_index, court in enumerate(DEFAULT_COURTS):
            court_id = court["court_id"]
            t = start
            while t <= now:
                dow = t.weekday()
                hour = t.hour
                prob = occupancy_probability(dow, hour, court_index)
                # Per-reading noise so the heatmap isn't grid-flat
                noisy = prob + random.uniform(-0.1, 0.1)
                status = "occupied" if random.random() < noisy else "available"
                ts_iso = t.isoformat()
                sensor_data = json.dumps({"mock": True})
                await db.execute(
                    "INSERT INTO readings (court_id, status, sensor_data, timestamp) "
                    "VALUES (?, ?, ?, ?)",
                    (court_id, status, sensor_data, ts_iso),
                )
                inserted += 1
                latest_status[court_id] = status
                latest_ts[court_id] = ts_iso
                t += timedelta(hours=1)

        # Update courts.status + courts.last_updated to match the most recent
        # mock reading per court, so the initial dashboard view shows real data
        # instead of "available" defaults.
        for court_id, status in latest_status.items():
            await db.execute(
                "UPDATE courts SET status = ?, last_updated = ? WHERE court_id = ?",
                (status, latest_ts[court_id], court_id),
            )

        await db.commit()

    return inserted


# --- CLI --------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed the Gaze database with realistic mock readings."
    )
    parser.add_argument(
        "--days",
        type=int,
        default=28,
        help="Number of days of history to seed (default: 28).",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Wipe the readings table before seeding (leaves courts table alone).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        metavar="N",
        help="Random seed for reproducibility. Omit for fresh random patterns.",
    )
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    count = asyncio.run(seed(days=args.days, reset=args.reset))
    db_path = _resolve_db_path()
    print(
        f"Seeded {count} readings across {len(DEFAULT_COURTS)} courts "
        f"over {args.days} days."
    )
    print(f"Database: {db_path}")


if __name__ == "__main__":
    main()
