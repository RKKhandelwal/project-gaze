"""
Project Gaze — Sensor Node Entry Point

Initializes sensor, starts the monitoring loop, and handles
graceful shutdown via SIGTERM/SIGINT.

Designed to run unattended as a systemd service on a
Raspberry Pi Zero 2W, solar-powered outdoors.
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import signal
import sys
import time
from types import FrameType
from typing import Optional

from .config import Config
from .court_monitor import CourtMonitor
from .reporter import Reporter

logger = logging.getLogger("gaze")


def setup_logging(config: Config) -> None:
    """Configure rotating file logger + stdout."""
    root = logging.getLogger("gaze")
    root.setLevel(getattr(logging, config.log_level.upper(), logging.INFO))

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Stdout handler
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setFormatter(fmt)
    root.addHandler(stdout_handler)

    # Rotating file handler
    log_dir = os.path.dirname(config.log_file)
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
    try:
        file_handler = logging.handlers.RotatingFileHandler(
            config.log_file,
            maxBytes=config.log_max_bytes,
            backupCount=config.log_backup_count,
        )
        file_handler.setFormatter(fmt)
        root.addHandler(file_handler)
    except (OSError, PermissionError) as exc:
        root.warning("Cannot open log file %s: %s", config.log_file, exc)


class GazeSensorNode:
    """Top-level controller for the sensor node."""

    def __init__(self) -> None:
        self._running = False
        self._config = Config()
        self._monitor: Optional[CourtMonitor] = None
        self._reporter: Optional[Reporter] = None

    def run(self) -> None:
        """Main entry point — blocks until shutdown signal."""
        setup_logging(self._config)

        logger.info(
            "=== Gaze Sensor Node starting === "
            "sensor_id=%s node=%s",
            self._config.sensor_id,
            self._config.node_id,
        )
        logger.info(
            "Poll interval: %.1fs, Heartbeat interval: %.1fs, "
            "Debounce timeout: %.0fs",
            self._config.poll_interval_s,
            self._config.heartbeat_interval_s,
            self._config.debounce_timeout_s,
        )
        logger.info(
            "Sensor: %s",
            self._config.sensor.uart_port,
        )
        logger.info("API endpoint: %s", self._config.api_url)
        logger.info(
            "Status reporting identity: sensor_id=%s (court resolved server-side)",
            self._config.sensor_id,
        )

        # Install signal handlers
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

        # Initialize components
        self._monitor = CourtMonitor(self._config)
        self._reporter = Reporter(self._config)

        try:
            self._monitor.start()
        except Exception as exc:
            logger.error("Failed to start monitor: %s", exc)

        self._running = True
        logger.info("Entering main loop")

        try:
            self._main_loop()
        except Exception as exc:
            logger.exception("Fatal error in main loop: %s", exc)
        finally:
            self._shutdown()

    def _main_loop(self) -> None:
        """Poll sensor, report state changes and heartbeats."""
        while self._running:
            loop_start = time.monotonic()

            try:
                state, changed, heartbeat_due = self._monitor.poll()  # type: ignore[union-attr]

                if changed or heartbeat_due:
                    reason = "state_change" if changed else "heartbeat"
                    logger.debug(
                        "Reporting: %s (status=%s)",
                        reason, state.status.value,
                    )
                    sensor_data = self._monitor.get_sensor_data()  # type: ignore[union-attr]
                    self._reporter.send_status(  # type: ignore[union-attr]
                        sensor_id=self._config.sensor_id,
                        status=state.status.value,
                        sensor_data=sensor_data,
                    )

                # Notify systemd watchdog (if configured)
                _sd_notify("WATCHDOG=1")

            except Exception as exc:
                logger.error("Poll cycle error: %s", exc, exc_info=True)

            # Sleep for remainder of poll interval
            elapsed = time.monotonic() - loop_start
            sleep_time = max(0, self._config.poll_interval_s - elapsed)
            if sleep_time > 0 and self._running:
                time.sleep(sleep_time)

    def _handle_signal(
        self, signum: int, frame: Optional[FrameType]
    ) -> None:
        sig_name = signal.Signals(signum).name
        logger.info("Received %s — initiating shutdown", sig_name)
        self._running = False

    def _shutdown(self) -> None:
        """Clean up all resources."""
        logger.info("Shutting down sensor node")
        _sd_notify("STOPPING=1")

        if self._monitor:
            try:
                self._monitor.stop()
            except Exception as exc:
                logger.error("Monitor shutdown error: %s", exc)

        if self._reporter:
            try:
                self._reporter.close()
            except Exception as exc:
                logger.error("Reporter shutdown error: %s", exc)

        logger.info("=== Gaze Sensor Node stopped ===")


def _sd_notify(state: str) -> None:
    """Send a systemd notification if NOTIFY_SOCKET is set."""
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr:
        return
    try:
        import socket

        sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        if addr.startswith("@"):
            addr = "\0" + addr[1:]
        sock.sendto(state.encode(), addr)
        sock.close()
    except Exception:
        pass


def main() -> None:
    node = GazeSensorNode()
    node.run()


if __name__ == "__main__":
    main()
