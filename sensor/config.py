"""
Project Gaze — Sensor Node Configuration

Loads from environment variables with production-safe defaults.
Designed for Raspberry Pi Zero 2W with 1x HLK-LD1125H mmWave sensor.

The LD1125H uses an ASCII text protocol (e.g., "mov, dis=234", "occ, dis=156")
driven by gaze/sensor/ld1125h.py.
See gaze/docs/hardware-guide.md Appendix A for protocol details.
"""

import os
from dataclasses import dataclass, field


def _env(key: str, default: str) -> str:
    return os.environ.get(key, default)


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, str(default)))
    except (ValueError, TypeError):
        return default


def _env_float(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, str(default)))
    except (ValueError, TypeError):
        return default


@dataclass(frozen=True)
class SensorConfig:
    """Configuration for the HLK-LD1125H sensor.

    The LD1125H is configured via ASCII commands sent over UART:
      rmax=N         set max detection range in meters (1-16)
      mth1_mov=N     moving target threshold for gate 1
      mth1_occ=N     stationary target threshold for gate 1
      save           persist config to flash

    The max_moving_gate / max_stationary_gate fields below predate the
    LD1125H driver and are kept so court_monitor.py can pass them through
    to LD1125H.configure_gates() without code changes. The driver converts
    them to LD1125H's native `rmax` (meters) via a gate-size heuristic.
    """
    uart_port: str
    baud_rate: int = 115200
    timeout_s: float = 2.0
    # LD1125H: max detection range in meters (supports up to ~16m)
    max_range_m: int = 12
    # Per-gate detection thresholds (0–100).
    # Tune against real hardware during bench testing.
    moving_sensitivity: int = 60
    stationary_sensitivity: int = 60
    # Legacy "gate index" fields consumed by LD1125H.configure_gates().
    # Each gate ≈ 0.75 m; 12 gates ≈ 9 m reach (well under LD1125H's 16m cap).
    max_moving_gate: int = 16  # → rmax ≈ 12m after gate→meter conversion
    max_stationary_gate: int = 16


@dataclass(frozen=True)
class Config:
    """Top-level configuration for the Gaze sensor node."""

    # --- Identity ---
    court_id: str = field(
        default_factory=lambda: _env("GAZE_COURT_ID", "court-01")
    )
    sensor_id: str = field(
        default_factory=lambda: _env("GAZE_SENSOR_ID", "sensor-01")
    )
    node_id: str = field(
        default_factory=lambda: _env("GAZE_NODE_ID", "node-01")
    )

    # --- Backend API ---
    api_url: str = field(
        default_factory=lambda: _env(
            "GAZE_API_URL", "http://localhost:8000/api/status"
        )
    )
    api_key: str = field(
        default_factory=lambda: _env("GAZE_API_KEY", "")
    )

    # --- Timing ---
    poll_interval_s: float = field(
        default_factory=lambda: _env_float("GAZE_POLL_INTERVAL", 5.0)
    )
    heartbeat_interval_s: float = field(
        default_factory=lambda: _env_float("GAZE_HEARTBEAT_INTERVAL", 60.0)
    )

    # --- Debounce ---
    # Seconds of no presence before marking court available (5 minutes)
    debounce_timeout_s: float = field(
        default_factory=lambda: _env_float("GAZE_DEBOUNCE_TIMEOUT", 300.0)
    )

    # --- Network / Retry ---
    retry_max_attempts: int = field(
        default_factory=lambda: _env_int("GAZE_RETRY_MAX", 5)
    )
    retry_base_delay_s: float = field(
        default_factory=lambda: _env_float("GAZE_RETRY_BASE_DELAY", 2.0)
    )
    retry_max_delay_s: float = field(
        default_factory=lambda: _env_float("GAZE_RETRY_MAX_DELAY", 60.0)
    )
    request_timeout_s: float = field(
        default_factory=lambda: _env_float("GAZE_REQUEST_TIMEOUT", 10.0)
    )

    # --- Local buffer ---
    db_path: str = field(
        default_factory=lambda: _env(
            "GAZE_DB_PATH", "/var/lib/gaze/buffer.db"
        )
    )

    # --- Logging ---
    log_level: str = field(
        default_factory=lambda: _env("GAZE_LOG_LEVEL", "INFO")
    )
    log_file: str = field(
        default_factory=lambda: _env(
            "GAZE_LOG_FILE", "/var/log/gaze/sensor.log"
        )
    )
    log_max_bytes: int = field(
        default_factory=lambda: _env_int("GAZE_LOG_MAX_BYTES", 5_000_000)
    )
    log_backup_count: int = field(
        default_factory=lambda: _env_int("GAZE_LOG_BACKUP_COUNT", 3)
    )

    # --- Sensor ---
    sensor: SensorConfig = field(default=None)  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.sensor is None:
            object.__setattr__(self, "sensor", SensorConfig(
                uart_port=_env("GAZE_SENSOR_PORT", "/dev/ttyS0"),
                baud_rate=_env_int("GAZE_SENSOR_BAUD", 115200),
                timeout_s=_env_float("GAZE_SENSOR_TIMEOUT", 2.0),
            ))
