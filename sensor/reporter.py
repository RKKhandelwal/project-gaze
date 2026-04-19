"""
Project Gaze — Status Reporter

HTTP client that POSTs court status to the FastAPI backend.
Includes retry with exponential backoff and a local SQLite buffer
for offline resilience.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

import requests

from .config import Config

logger = logging.getLogger("gaze.reporter")

# SQLite schema for the offline buffer
_BUFFER_SCHEMA = """
CREATE TABLE IF NOT EXISTS pending_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    payload     TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0
);
"""


class Reporter:
    """
    Sends court status updates to the backend API.

    Features:
        - Retry with exponential backoff on transient failures.
        - SQLite buffer: queues reports when the server is unreachable
          and flushes them when connectivity is restored.
        - Thread-safe buffer access.
    """

    def __init__(self, config: Config) -> None:
        self.config = config
        self._session = requests.Session()
        if config.api_key:
            self._session.headers["x-api-key"] = config.api_key
        self._session.headers["Content-Type"] = "application/json"
        self._session.headers["User-Agent"] = (
            f"gaze-sensor/{config.node_id}"
        )
        self._db: Optional[sqlite3.Connection] = None
        self._db_lock = threading.Lock()
        self._init_db()

    # --- SQLite buffer ---

    def _init_db(self) -> None:
        """Initialize the local SQLite buffer database."""
        db_path = self.config.db_path
        db_dir = os.path.dirname(db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        try:
            self._db = sqlite3.connect(db_path, check_same_thread=False)
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("PRAGMA synchronous=NORMAL")
            self._db.execute(_BUFFER_SCHEMA)
            self._db.commit()
            logger.info("SQLite buffer initialized at %s", db_path)
        except sqlite3.Error as exc:
            logger.error("Failed to initialize SQLite buffer: %s", exc)
            self._db = None

    def _buffer_payload(self, payload: dict) -> None:
        """Store a failed payload in the local buffer."""
        if self._db is None:
            logger.warning("No SQLite buffer — dropping payload")
            return
        with self._db_lock:
            try:
                self._db.execute(
                    "INSERT INTO pending_reports (payload, created_at) "
                    "VALUES (?, ?)",
                    (json.dumps(payload), _now_iso()),
                )
                self._db.commit()
                count = self._pending_count_unlocked()
                logger.info("Payload buffered locally (%d pending)", count)
            except sqlite3.Error as exc:
                logger.error("Buffer write failed: %s", exc)

    def _pending_count_unlocked(self) -> int:
        """Count pending reports (caller must hold _db_lock)."""
        if self._db is None:
            return 0
        cur = self._db.execute("SELECT COUNT(*) FROM pending_reports")
        return cur.fetchone()[0]

    def flush_buffer(self) -> int:
        """
        Attempt to send all buffered reports to the backend.
        Returns number of successfully flushed reports.
        """
        if self._db is None:
            return 0

        flushed = 0
        with self._db_lock:
            try:
                rows = self._db.execute(
                    "SELECT id, payload FROM pending_reports "
                    "ORDER BY id ASC LIMIT 50"
                ).fetchall()
            except sqlite3.Error as exc:
                logger.error("Buffer read failed: %s", exc)
                return 0

        for row_id, payload_json in rows:
            try:
                payload = json.loads(payload_json)
            except json.JSONDecodeError:
                self._delete_buffered(row_id)
                continue

            if self._try_send(payload):
                self._delete_buffered(row_id)
                flushed += 1
            else:
                # Server still down — stop flushing to avoid hammering
                break

        if flushed > 0:
            logger.info("Flushed %d buffered reports", flushed)
        return flushed

    def _delete_buffered(self, row_id: int) -> None:
        if self._db is None:
            return
        with self._db_lock:
            try:
                self._db.execute(
                    "DELETE FROM pending_reports WHERE id = ?", (row_id,)
                )
                self._db.commit()
            except sqlite3.Error:
                pass

    # --- HTTP sending ---

    def send_status(
        self,
        sensor_id: str,
        status: str,
        sensor_data: dict[str, Any],
    ) -> bool:
        """
        Send a court status update to the backend.

        On failure, buffers the payload locally for later retry.
        Returns True if the server accepted the report.
        """
        payload = {
            "sensor_id": sensor_id,
            "status": status,
            "sensor_data": sensor_data,
            "timestamp": _now_iso(),
        }

        success = self._try_send(payload)

        if success:
            # Opportunistically flush any buffered reports
            self.flush_buffer()
        else:
            self._buffer_payload(payload)

        return success

    def _try_send(self, payload: dict) -> bool:
        """
        POST the payload with exponential backoff retry.
        Returns True on success (2xx).
        """
        delay = self.config.retry_base_delay_s

        for attempt in range(1, self.config.retry_max_attempts + 1):
            try:
                resp = self._session.post(
                    self.config.api_url,
                    json=payload,
                    timeout=self.config.request_timeout_s,
                )
                if resp.status_code < 300:
                    logger.debug(
                        "Report sent (attempt %d): %d",
                        attempt, resp.status_code,
                    )
                    return True

                # 4xx client errors (except 429) are not retryable
                if 400 <= resp.status_code < 500 and resp.status_code != 429:
                    logger.error(
                        "Server rejected report with %d: %s",
                        resp.status_code,
                        resp.text[:200],
                    )
                    return False

                logger.warning(
                    "Server returned %d (attempt %d/%d)",
                    resp.status_code, attempt, self.config.retry_max_attempts,
                )

            except requests.ConnectionError:
                logger.warning(
                    "Connection failed (attempt %d/%d)",
                    attempt, self.config.retry_max_attempts,
                )
            except requests.Timeout:
                logger.warning(
                    "Request timeout (attempt %d/%d)",
                    attempt, self.config.retry_max_attempts,
                )
            except requests.RequestException as exc:
                logger.warning(
                    "Request error (attempt %d/%d): %s",
                    attempt, self.config.retry_max_attempts, exc,
                )

            if attempt < self.config.retry_max_attempts:
                logger.debug("Retrying in %.1fs", delay)
                time.sleep(delay)
                delay = min(delay * 2, self.config.retry_max_delay_s)

        logger.error(
            "All %d send attempts failed", self.config.retry_max_attempts
        )
        return False

    # --- Cleanup ---

    def close(self) -> None:
        """Close HTTP session and SQLite connection."""
        self._session.close()
        if self._db:
            try:
                self._db.close()
            except Exception:
                pass
        logger.info("Reporter closed")


def _now_iso() -> str:
    """Return current UTC time as ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()
