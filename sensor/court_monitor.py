"""
Project Gaze — Court Monitoring Logic

Uses a single HLK-LD1125H sensor to determine court occupancy.
Implements time-based debounce: court stays "occupied" for 5 minutes
after the last presence detection to avoid false vacancy.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from .config import Config
from .ld1125h import LD1125H, SensorReading

logger = logging.getLogger("gaze.monitor")


class CourtStatus(str, Enum):
    OCCUPIED = "occupied"
    AVAILABLE = "available"
    UNKNOWN = "unknown"


@dataclass
class CourtState:
    """Current state of the monitored court."""
    status: CourtStatus = CourtStatus.UNKNOWN
    changed_at: float = field(default_factory=time.time)
    last_reading_at: float = 0.0
    last_presence_at: float = 0.0
    sensor_reading: Optional[SensorReading] = None
    sensor_healthy: bool = False


class CourtMonitor:
    """
    Monitors a single tennis court using one mmWave sensor at the baseline.

    Occupancy rule:
        Sensor reporting presence -> court is occupied.

    Debounce:
        Court stays "occupied" for debounce_timeout_s (default 5 min)
        after the last presence detection. This prevents false "available"
        when players are at the far end of the court beyond sensor range.

    Reports:
        - On every state *change* (occupied <-> available).
        - On periodic heartbeat regardless of change.
    """

    def __init__(self, config: Config) -> None:
        self.config = config
        self._sensor = LD1125H(
            port=config.sensor.uart_port,
            baud_rate=config.sensor.baud_rate,
            timeout_s=config.sensor.timeout_s,
            label="A",
        )
        self._state = CourtState()
        self._last_heartbeat: float = 0.0

    # --- Lifecycle ---

    def start(self) -> None:
        """Connect the sensor and configure detection gates."""
        try:
            self._sensor.connect()
            self._sensor.configure_gates(
                max_moving_gate=self.config.sensor.max_moving_gate,
                max_stationary_gate=self.config.sensor.max_stationary_gate,
                moving_sensitivity=self.config.sensor.moving_sensitivity,
                stationary_sensitivity=self.config.sensor.stationary_sensitivity,
            )
        except Exception as exc:
            logger.error("Sensor init failed: %s", exc)

    def stop(self) -> None:
        """Disconnect the sensor."""
        self._sensor.close()

    # --- Core polling ---

    def poll(self) -> tuple[CourtState, bool, bool]:
        """
        Perform one poll cycle: read sensor, update state.

        Returns:
            (state, state_changed, heartbeat_due)
        """
        reading = self._safe_read()
        now = time.time()

        self._state.sensor_reading = reading
        self._state.sensor_healthy = self._sensor.connected
        self._state.last_reading_at = now

        is_present = reading.is_present if reading else False

        if is_present:
            self._state.last_presence_at = now

        old_status = self._state.status
        state_changed = False

        # Time since last presence detection
        time_since_presence = now - self._state.last_presence_at

        if is_present or (
            self._state.last_presence_at > 0
            and time_since_presence < self.config.debounce_timeout_s
        ):
            # Currently seeing someone, or saw someone within debounce window
            if old_status != CourtStatus.OCCUPIED:
                self._state.status = CourtStatus.OCCUPIED
                self._state.changed_at = now
                state_changed = True
                logger.info(
                    "Court %s -> OCCUPIED",
                    self.config.court_id,
                )
        else:
            # No presence for longer than debounce timeout
            if old_status != CourtStatus.AVAILABLE:
                self._state.status = CourtStatus.AVAILABLE
                self._state.changed_at = now
                state_changed = True
                logger.info(
                    "Court %s -> AVAILABLE (no presence for %.0fs)",
                    self.config.court_id,
                    time_since_presence,
                )

        # Heartbeat check
        heartbeat_due = (
            now - self._last_heartbeat >= self.config.heartbeat_interval_s
        )
        if heartbeat_due:
            self._last_heartbeat = now

        return self._state, state_changed, heartbeat_due

    def _safe_read(self) -> Optional[SensorReading]:
        """Read from the sensor, handling disconnection and reconnection."""
        if not self._sensor.connected:
            if not self._sensor.reconnect():
                return None

        reading = self._sensor.read_frame()
        if reading is None and not self._sensor.connected:
            logger.warning("Sensor disconnected during read")
        return reading

    # --- State accessors ---

    @property
    def state(self) -> CourtState:
        return self._state

    @property
    def status(self) -> CourtStatus:
        return self._state.status

    def get_sensor_data(self) -> dict:
        """Build sensor data dict for the API payload."""
        return {
            "court_id": self.config.court_id,
            "node_id": self.config.node_id,
            "sensor": self._reading_to_dict(
                self._state.sensor_reading, self._state.sensor_healthy
            ),
            "time_since_presence_s": round(
                time.time() - self._state.last_presence_at, 1
            ) if self._state.last_presence_at > 0 else None,
        }

    @staticmethod
    def _reading_to_dict(
        reading: Optional[SensorReading], healthy: bool
    ) -> dict:
        if reading is None:
            return {"healthy": healthy, "present": False}
        return {
            "healthy": healthy,
            "present": reading.is_present,
            "target_state": reading.target_state.name.lower(),
            "moving_distance_cm": reading.moving_distance_cm,
            "moving_energy": reading.moving_energy,
            "stationary_distance_cm": reading.stationary_distance_cm,
            "stationary_energy": reading.stationary_energy,
            "detection_distance_cm": reading.detection_distance_cm,
        }
