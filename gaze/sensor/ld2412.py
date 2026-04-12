"""
Project Gaze — HLK-LD2412 mmWave Radar Driver

Binary UART protocol driver for the HLK-LD2412 24 GHz presence sensor.
Handles frame parsing, partial reads, timeouts, and malformed data.

Frame format (reporting mode):
  Header:  0xF4 0xF3 0xF2 0xF1
  Length:   2 bytes (little-endian, payload length)
  Payload:  variable
  Footer:  0xF8 0xF7 0xF6 0xF5

Command frame format:
  Header:  0xFD 0xFC 0xFB 0xFA
  Length:   2 bytes (little-endian)
  Payload:  variable
  Footer:  0x04 0x03 0x02 0x01
"""

from __future__ import annotations

import logging
import struct
import time
from dataclasses import dataclass
from enum import IntEnum
from typing import Optional

import serial

logger = logging.getLogger("gaze.ld2412")

# --- Protocol constants ---

REPORT_HEADER = bytes([0xF4, 0xF3, 0xF2, 0xF1])
REPORT_FOOTER = bytes([0xF8, 0xF7, 0xF6, 0xF5])

CMD_HEADER = bytes([0xFD, 0xFC, 0xFB, 0xFA])
CMD_FOOTER = bytes([0x04, 0x03, 0x02, 0x01])

# Command words
CMD_ENABLE_CONFIG = 0x00FF
CMD_END_CONFIG = 0x00FE
CMD_SET_GATE_SENSITIVITY = 0x0064
CMD_SET_MAX_GATE = 0x0060

# Max frame size we'll accept (guard against garbage)
MAX_FRAME_LEN = 512


class TargetState(IntEnum):
    NONE = 0x00
    MOVING = 0x01
    STATIONARY = 0x02
    BOTH = 0x03


@dataclass
class SensorReading:
    """Parsed result from one LD2412 report frame."""
    target_state: TargetState
    moving_distance_cm: int
    moving_energy: int
    stationary_distance_cm: int
    stationary_energy: int
    detection_distance_cm: int
    timestamp: float

    @property
    def is_present(self) -> bool:
        return self.target_state != TargetState.NONE


class LD2412:
    """
    Driver for a single HLK-LD2412 mmWave sensor over UART.

    Usage:
        sensor = LD2412("/dev/ttyS0")
        sensor.connect()
        reading = sensor.read_frame()
        if reading and reading.is_present:
            print(f"Target at {reading.moving_distance_cm} cm")
        sensor.close()
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
        """Open UART connection and optionally configure the sensor."""
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
            logger.info("Sensor %s connected on %s @ %d baud",
                        self.label, self.port, self.baud_rate)
            # Allow sensor to stabilize after power-on
            time.sleep(0.5)
            # Drain any stale data
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

    # --- Configuration commands ---

    def _build_command(self, cmd_word: int, data: bytes = b"") -> bytes:
        """Build a command frame."""
        payload = struct.pack("<H", cmd_word) + data
        length = struct.pack("<H", len(payload))
        return CMD_HEADER + length + payload + CMD_FOOTER

    def _send_command(self, cmd_word: int, data: bytes = b"") -> bool:
        """Send a command and wait for ACK. Returns True on success."""
        if not self.connected:
            return False
        frame = self._build_command(cmd_word, data)
        try:
            self._ser.write(frame)  # type: ignore[union-attr]
            self._ser.flush()  # type: ignore[union-attr]
            # Wait for ACK — read up to 64 bytes within timeout
            time.sleep(0.1)
            ack = self._ser.read(64)  # type: ignore[union-attr]
            if CMD_HEADER in ack:
                logger.debug("Command 0x%04X ACK received", cmd_word)
                return True
            logger.warning("No ACK for command 0x%04X", cmd_word)
            return False
        except serial.SerialException as exc:
            logger.error("Command send failed: %s", exc)
            return False

    def enable_config_mode(self) -> bool:
        """Enter configuration mode."""
        # Protocol requires 0x0001 + 0x0000 as data for enable
        return self._send_command(CMD_ENABLE_CONFIG, b"\x01\x00")

    def end_config_mode(self) -> bool:
        """Exit configuration mode."""
        return self._send_command(CMD_END_CONFIG)

    def configure_gates(
        self,
        max_moving_gate: int = 8,
        max_stationary_gate: int = 8,
        moving_sensitivity: int = 40,
        stationary_sensitivity: int = 40,
    ) -> bool:
        """
        Set detection range gates and sensitivity.
        Each gate ≈ 0.75 m.  Gate range: 0–12.
        Sensitivity: 0–100 (lower = more sensitive).
        """
        if not self.enable_config_mode():
            return False

        # Set max gates
        data = struct.pack("<HH", max_moving_gate, max_stationary_gate)
        # Append unmanned duration (0 = no auto-off)
        data += struct.pack("<H", 0)
        ok = self._send_command(CMD_SET_MAX_GATE, data)
        if not ok:
            self.end_config_mode()
            return False

        # Set per-gate sensitivity for all gates
        for gate in range(max(max_moving_gate, max_stationary_gate) + 1):
            gate_data = struct.pack(
                "<HBB", gate, moving_sensitivity, stationary_sensitivity
            )
            self._send_command(CMD_SET_GATE_SENSITIVITY, gate_data)

        self.end_config_mode()
        logger.info(
            "Sensor %s configured: gates moving=%d stationary=%d, "
            "sensitivity moving=%d stationary=%d",
            self.label, max_moving_gate, max_stationary_gate,
            moving_sensitivity, stationary_sensitivity,
        )
        return True

    # --- Frame reading ---

    def read_frame(self) -> Optional[SensorReading]:
        """
        Read and parse one report frame from the sensor.

        Returns a SensorReading on success, None on timeout or parse failure.
        Handles partial reads and garbage data gracefully.
        """
        if not self.connected:
            return None

        try:
            # Read available bytes into buffer
            waiting = self._ser.in_waiting  # type: ignore[union-attr]
            if waiting > 0:
                chunk = self._ser.read(  # type: ignore[union-attr]
                    min(waiting, 256)
                )
                self._buf.extend(chunk)
            elif len(self._buf) < 10:
                # Nothing waiting and buffer too small — block-read
                chunk = self._ser.read(32)  # type: ignore[union-attr]
                if chunk:
                    self._buf.extend(chunk)
                else:
                    return None  # Timeout, no data

            # Prevent buffer from growing unbounded
            if len(self._buf) > MAX_FRAME_LEN * 4:
                logger.warning(
                    "Sensor %s buffer overflow (%d bytes), trimming",
                    self.label, len(self._buf)
                )
                self._buf = self._buf[-MAX_FRAME_LEN:]

            return self._try_parse_frame()

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

    def _try_parse_frame(self) -> Optional[SensorReading]:
        """
        Attempt to extract a complete report frame from the internal buffer.
        Discards bytes before a valid header.
        """
        while True:
            # Find header
            idx = self._buf.find(REPORT_HEADER)
            if idx == -1:
                # No header found — keep last 3 bytes (partial header match)
                if len(self._buf) > 3:
                    self._buf = self._buf[-3:]
                return None

            # Discard garbage before header
            if idx > 0:
                logger.debug(
                    "Sensor %s: discarding %d bytes before header",
                    self.label, idx,
                )
                self._buf = self._buf[idx:]

            # Need at least header(4) + length(2)
            if len(self._buf) < 6:
                return None

            payload_len = struct.unpack_from("<H", self._buf, 4)[0]

            # Sanity check length
            if payload_len > MAX_FRAME_LEN:
                logger.warning(
                    "Sensor %s: implausible length %d, skipping header",
                    self.label, payload_len,
                )
                self._buf = self._buf[4:]
                continue

            # Total frame: header(4) + length(2) + payload + footer(4)
            frame_len = 4 + 2 + payload_len + 4
            if len(self._buf) < frame_len:
                return None  # Wait for more data

            # Verify footer
            footer_start = 4 + 2 + payload_len
            footer = bytes(self._buf[footer_start : footer_start + 4])
            if footer != REPORT_FOOTER:
                logger.debug(
                    "Sensor %s: bad footer, skipping",
                    self.label,
                )
                self._buf = self._buf[4:]
                continue

            # Extract payload
            payload = bytes(self._buf[6 : 6 + payload_len])
            self._buf = self._buf[frame_len:]
            self._consecutive_errors = 0

            return self._parse_payload(payload)

    def _parse_payload(self, payload: bytes) -> Optional[SensorReading]:
        """
        Parse the report payload.

        Typical target data payload (engineering mode off):
          Byte 0:     0x02 (data type: target)
          Byte 1:     target state (0=none, 1=moving, 2=stationary, 3=both)
          Bytes 2-3:  moving target distance (cm, LE uint16)
          Byte 4:     moving target energy (0–100)
          Bytes 5-6:  stationary target distance (cm, LE uint16)
          Byte 7:     stationary target energy (0–100)
          Bytes 8-9:  detection distance (cm, LE uint16)
        """
        # Minimum payload for target report
        if len(payload) < 10:
            logger.debug(
                "Sensor %s: payload too short (%d bytes)",
                self.label, len(payload),
            )
            return None

        data_type = payload[0]
        if data_type != 0x02:
            # Not a target data frame (could be engineering data, etc.)
            logger.debug(
                "Sensor %s: non-target data type 0x%02X",
                self.label, data_type,
            )
            return None

        try:
            target_state = TargetState(payload[1] & 0x03)
        except ValueError:
            target_state = TargetState.NONE

        moving_dist = struct.unpack_from("<H", payload, 2)[0]
        moving_energy = payload[4]
        stationary_dist = struct.unpack_from("<H", payload, 5)[0]
        stationary_energy = payload[7]
        detection_dist = struct.unpack_from("<H", payload, 8)[0]

        return SensorReading(
            target_state=target_state,
            moving_distance_cm=moving_dist,
            moving_energy=moving_energy,
            stationary_distance_cm=stationary_dist,
            stationary_energy=stationary_energy,
            detection_distance_cm=detection_dist,
            timestamp=time.time(),
        )

    # --- Convenience ---

    def is_present(self) -> bool:
        """Quick poll: is anyone detected?"""
        reading = self.read_frame()
        return reading.is_present if reading else False

    def get_distance(self) -> Optional[int]:
        """Quick poll: detection distance in cm, or None."""
        reading = self.read_frame()
        return reading.detection_distance_cm if reading else None
