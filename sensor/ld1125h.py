"""
Project Gaze — HLK-LD1125H mmWave Radar Driver

ASCII UART protocol driver for the HLK-LD1125H 24 GHz presence sensor.
Handles line-based reading, partial reads, timeouts, and malformed data.

Unlike the LD2412 (binary frame protocol), the LD1125H streams ASCII text
over UART at 115200 baud when a target is detected. When no target is
present, the sensor sends nothing.

Output format:
  mov, dis=NNNN\\n       # moving target at NNNN cm
  occ, dis=NNNN\\n       # stationary (occupied) target at NNNN cm

Configuration commands (ASCII, newline-terminated):
  rmax=N           set max detection range in meters (1-16)
  mth1_mov=N       moving threshold, gate 1 (0-2.8m)   (lower = more sensitive)
  mth2_mov=N       moving threshold, gate 2 (2.8-8m)
  mth3_mov=N       moving threshold, gate 3 (8-16m)
  mth1_occ=N       stationary threshold, gate 1
  mth2_occ=N       stationary threshold, gate 2
  mth3_occ=N       stationary threshold, gate 3
  save             persist config to flash
  get_all          dump current config

NOTE: Threshold direction and gate boundaries are based on published
specs. Validate against real hardware during bench testing and adjust
defaults in gaze/sensor/config.py if needed.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from enum import IntEnum
from typing import Optional

import serial

logger = logging.getLogger("gaze.ld1125h")

# --- Protocol constants ---

# Matches "mov, dis=234" or "occ, dis=156" with tolerant whitespace
LINE_PATTERN = re.compile(r"(mov|occ)\s*,\s*dis\s*=\s*(\d+)", re.IGNORECASE)

# Guard against garbage / runaway lines
MAX_LINE_LEN = 128
MAX_BUFFER_LEN = 4096


class TargetState(IntEnum):
    NONE = 0x00
    MOVING = 0x01
    STATIONARY = 0x02
    BOTH = 0x03


@dataclass
class SensorReading:
    """Parsed result from one LD1125H output line.

    Field layout matches the legacy LD2412 SensorReading so downstream
    code (court_monitor.py, models, etc.) works without changes. The
    LD1125H does not report energy levels, so those fields are always 0.
    """
    target_state: TargetState
    moving_distance_cm: int
    moving_energy: int           # Not reported by LD1125H; always 0
    stationary_distance_cm: int
    stationary_energy: int       # Not reported by LD1125H; always 0
    detection_distance_cm: int
    timestamp: float

    @property
    def is_present(self) -> bool:
        return self.target_state != TargetState.NONE


class LD1125H:
    """
    Driver for a single HLK-LD1125H mmWave sensor over UART.

    Usage:
        sensor = LD1125H("/dev/ttyAMA0")
        sensor.connect()
        sensor.configure_gates(moving_sensitivity=60, stationary_sensitivity=60)
        reading = sensor.read_frame()
        if reading and reading.is_present:
            print(f"Target at {reading.detection_distance_cm} cm")
        sensor.close()

    IMPORTANT: The LD1125H only transmits when a target is present.
    A None return from read_frame() does not necessarily mean "no target" —
    it may simply mean "no data received in this poll window". The caller
    should use timestamp-based debounce to infer empty-court state.
    """

    def __init__(
        self,
        port: str,
        baud_rate: int = 115200,
        timeout_s: float = 2.0,
        label: str = "",
    ) -> None:
        self.port = port
        self.baud_rate = baud_rate
        self.timeout_s = timeout_s
        self.label = label or port
        self._ser: Optional[serial.Serial] = None
        self._buf = bytearray()
        self._connected = False
        self._consecutive_errors = 0
        self._max_consecutive_errors = 10

    # --- Lifecycle ---

    def connect(self) -> None:
        """Open UART connection."""
        try:
            self._ser = serial.Serial(
                port=self.port,
                baudrate=self.baud_rate,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=self.timeout_s,
            )
            self._connected = True
            self._buf.clear()
            self._consecutive_errors = 0
            logger.info(
                "Sensor %s connected on %s @ %d baud",
                self.label, self.port, self.baud_rate,
            )
            # Allow sensor to stabilize after power-on
            time.sleep(0.5)
            self._ser.reset_input_buffer()
        except serial.SerialException as exc:
            self._connected = False
            logger.error("Failed to connect sensor %s: %s", self.label, exc)
            raise

    def close(self) -> None:
        """Close UART connection."""
        if self._ser and self._ser.is_open:
            try:
                self._ser.close()
            except Exception:
                pass
        self._connected = False
        self._buf.clear()
        logger.info("Sensor %s closed", self.label)

    @property
    def connected(self) -> bool:
        return self._connected and self._ser is not None and self._ser.is_open

    def reconnect(self) -> bool:
        """Attempt to reconnect after a failure. Returns True on success."""
        logger.warning("Attempting reconnect for sensor %s", self.label)
        self.close()
        try:
            time.sleep(1.0)
            self.connect()
            return True
        except serial.SerialException:
            return False

    # --- Configuration ---

    def _send_command(self, cmd: str) -> bool:
        """Send an ASCII command line to the sensor."""
        if not self.connected:
            return False
        try:
            payload = f"{cmd}\r\n".encode("ascii")
            self._ser.write(payload)  # type: ignore[union-attr]
            self._ser.flush()  # type: ignore[union-attr]
            logger.debug("Sensor %s: sent command '%s'", self.label, cmd)
            # The LD1125H does not formally ACK config commands; give it
            # a short moment to process before sending the next one.
            time.sleep(0.05)
            return True
        except serial.SerialException as exc:
            logger.error("Command send failed for %s: %s", self.label, exc)
            return False

    def configure_gates(
        self,
        max_moving_gate: int = 12,
        max_stationary_gate: int = 12,
        moving_sensitivity: int = 60,
        stationary_sensitivity: int = 60,
    ) -> bool:
        """
        Configure the LD1125H detection range and thresholds.

        This signature matches the legacy LD2412 driver so court_monitor.py
        can call it unchanged. Mapping to LD1125H semantics:

          - max_moving_gate / max_stationary_gate: interpreted as legacy
            gate indices (each ~0.75 m). Converted to LD1125H `rmax` in
            meters, capped at the sensor's 16m max.
          - moving_sensitivity, stationary_sensitivity: applied uniformly
            to all 3 LD1125H gates as `mth{1,2,3}_mov` / `mth{1,2,3}_occ`.
            Values are 0-100 style; lower values should produce more
            sensitive detection. Validate against hardware.

        The sensor is saved with the `save` command so settings persist
        across reboots.
        """
        if not self.connected:
            return False

        # Convert gate index -> meters. LD2412 gates are ~0.75m each.
        gate_max = max(max_moving_gate, max_stationary_gate)
        rmax_m = min(int(round(gate_max * 0.75)), 16)
        rmax_m = max(rmax_m, 1)

        # Clamp thresholds to reasonable range
        mov_th = max(0, min(100, moving_sensitivity))
        occ_th = max(0, min(100, stationary_sensitivity))

        # Drain any streaming target data before issuing config
        try:
            self._ser.reset_input_buffer()  # type: ignore[union-attr]
        except Exception:
            pass

        ok = True
        ok &= self._send_command(f"rmax={rmax_m}")
        for gate in (1, 2, 3):
            ok &= self._send_command(f"mth{gate}_mov={mov_th}")
            ok &= self._send_command(f"mth{gate}_occ={occ_th}")
        ok &= self._send_command("save")

        logger.info(
            "Sensor %s configured: rmax=%dm, mov_th=%d, occ_th=%d",
            self.label, rmax_m, mov_th, occ_th,
        )
        return ok

    # --- Frame reading ---

    def read_frame(self) -> Optional[SensorReading]:
        """
        Read and parse one output line from the sensor.

        Returns a SensorReading if a valid line was parsed, None if no
        data was available within the timeout or the line was malformed.

        The LD1125H only transmits when it sees a target, so None does
        NOT mean "court empty" — use timestamp-based debounce in the
        caller to distinguish.
        """
        if not self.connected:
            return None

        try:
            # Read any available bytes into buffer
            waiting = self._ser.in_waiting  # type: ignore[union-attr]
            if waiting > 0:
                chunk = self._ser.read(  # type: ignore[union-attr]
                    min(waiting, 256)
                )
                self._buf.extend(chunk)
            elif not self._has_line():
                # Nothing waiting and no buffered line — block-read
                chunk = self._ser.read(32)  # type: ignore[union-attr]
                if chunk:
                    self._buf.extend(chunk)
                else:
                    return None  # Timeout, no data

            # Prevent runaway buffer growth
            if len(self._buf) > MAX_BUFFER_LEN:
                logger.warning(
                    "Sensor %s buffer overflow (%d bytes), trimming",
                    self.label, len(self._buf),
                )
                self._buf = self._buf[-MAX_LINE_LEN * 4:]

            return self._try_parse_line()

        except serial.SerialException as exc:
            self._consecutive_errors += 1
            logger.error(
                "Sensor %s read error (%d consecutive): %s",
                self.label, self._consecutive_errors, exc,
            )
            if self._consecutive_errors >= self._max_consecutive_errors:
                logger.error(
                    "Sensor %s too many errors, marking disconnected",
                    self.label,
                )
                self._connected = False
            return None

    def _has_line(self) -> bool:
        """Does the buffer contain at least one complete line?"""
        return b"\n" in self._buf

    def _try_parse_line(self) -> Optional[SensorReading]:
        """Extract the oldest complete line from the buffer and parse it."""
        newline_idx = self._buf.find(b"\n")
        if newline_idx == -1:
            return None

        raw_line = bytes(self._buf[:newline_idx])
        self._buf = self._buf[newline_idx + 1:]

        # Strip CR + trailing whitespace, decode to ASCII
        line = raw_line.strip(b"\r\n \t").decode("ascii", errors="ignore")
        if not line:
            return None

        if len(line) > MAX_LINE_LEN:
            logger.debug(
                "Sensor %s: dropping oversized line (%d bytes)",
                self.label, len(line),
            )
            return None

        return self._parse_line(line)

    def _parse_line(self, line: str) -> Optional[SensorReading]:
        """
        Parse a single LD1125H output line.

        Expected formats:
            mov, dis=234
            occ, dis=156

        Lines that don't match the regex are silently ignored (they may
        be config-command echoes, boot banners, or garbage).
        """
        match = LINE_PATTERN.search(line)
        if not match:
            logger.debug("Sensor %s: unparseable line %r", self.label, line)
            return None

        kind = match.group(1).lower()
        try:
            distance_cm = int(match.group(2))
        except ValueError:
            return None

        self._consecutive_errors = 0
        now = time.time()

        if kind == "mov":
            return SensorReading(
                target_state=TargetState.MOVING,
                moving_distance_cm=distance_cm,
                moving_energy=0,
                stationary_distance_cm=0,
                stationary_energy=0,
                detection_distance_cm=distance_cm,
                timestamp=now,
            )
        # kind == "occ"
        return SensorReading(
            target_state=TargetState.STATIONARY,
            moving_distance_cm=0,
            moving_energy=0,
            stationary_distance_cm=distance_cm,
            stationary_energy=0,
            detection_distance_cm=distance_cm,
            timestamp=now,
        )

    # --- Convenience ---

    def is_present(self) -> bool:
        """Quick poll: is anyone detected in this read cycle?"""
        reading = self.read_frame()
        return reading.is_present if reading else False

    def get_distance(self) -> Optional[int]:
        """Quick poll: detection distance in cm, or None."""
        reading = self.read_frame()
        return reading.detection_distance_cm if reading else None
