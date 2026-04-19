#!/usr/bin/env bash
# Project Gaze — Sensor Node Installation Script
# Target: Raspberry Pi Zero 2W running Raspberry Pi OS (Bookworm)
#
# Usage:
#   sudo bash install.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="gaze-sensor"
INSTALL_DIR="/opt/gaze/sensor"
VENV_DIR="/opt/gaze/venv"
DATA_DIR="/var/lib/gaze"
LOG_DIR="/var/log/gaze"
RUN_USER="gaze"

echo "=== Project Gaze Sensor Node Installer ==="

# --- Check root ---
if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script must be run as root (sudo)."
    exit 1
fi

# --- System packages ---
echo "[1/7] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip

# --- UART configuration ---
echo "[2/7] Configuring UART..."

# Enable UART on Pi Zero 2W
# The Pi Zero 2W has mini UART on GPIO 14/15 by default.
# For reliable sensor comms, we want the PL011 UART.
if ! grep -q "^enable_uart=1" /boot/firmware/config.txt 2>/dev/null; then
    echo "enable_uart=1" >> /boot/firmware/config.txt
    echo "  Added enable_uart=1 to config.txt"
fi

# Swap mini UART and PL011 so sensors get the full UART
if ! grep -q "^dtoverlay=miniuart-bt" /boot/firmware/config.txt 2>/dev/null; then
    echo "dtoverlay=miniuart-bt" >> /boot/firmware/config.txt
    echo "  Added miniuart-bt overlay (BT uses mini UART, sensors get PL011)"
fi

# Disable serial console so UART is free for sensor data
if grep -q "console=serial0" /boot/firmware/cmdline.txt 2>/dev/null; then
    sed -i 's/console=serial0,[0-9]* //g' /boot/firmware/cmdline.txt
    echo "  Removed serial console from cmdline.txt"
fi

systemctl disable serial-getty@ttyS0.service 2>/dev/null || true
systemctl stop serial-getty@ttyS0.service 2>/dev/null || true
systemctl disable serial-getty@ttyAMA0.service 2>/dev/null || true
systemctl stop serial-getty@ttyAMA0.service 2>/dev/null || true

# --- Create service user ---
echo "[3/7] Creating service user..."
if ! id "$RUN_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$RUN_USER"
    echo "  Created user: $RUN_USER"
fi
# Add to dialout group for UART access
usermod -aG dialout "$RUN_USER"

# --- Create directories ---
echo "[4/7] Creating directories..."
mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$LOG_DIR"
chown "$RUN_USER:$RUN_USER" "$DATA_DIR" "$LOG_DIR"

# --- Install Python environment ---
echo "[5/7] Setting up Python virtual environment..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "$SCRIPT_DIR/requirements.txt"

# --- Copy application code ---
echo "[6/7] Installing application..."
cp -r "$SCRIPT_DIR"/*.py "$INSTALL_DIR/"
cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/"
chown -R "$RUN_USER:$RUN_USER" "$INSTALL_DIR"

# --- Install systemd service ---
echo "[7/7] Installing systemd service..."
cp "$SCRIPT_DIR/gaze-sensor.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "  1. Configure environment variables in /etc/gaze/env (create if needed):"
echo "       GAZE_COURT_ID=court-01"
echo "       GAZE_API_URL=https://your-api.example.com/api/v1/status"
echo "       GAZE_API_KEY=your-api-key"
echo "       GAZE_SENSOR_PORT=/dev/ttyAMA0"
echo ""
echo "  2. Create the env file:"
echo "       sudo mkdir -p /etc/gaze"
echo "       sudo touch /etc/gaze/env"
echo "       sudo chmod 600 /etc/gaze/env"
echo ""
echo "  3. Start the service:"
echo "       sudo systemctl start $SERVICE_NAME"
echo "       sudo journalctl -u $SERVICE_NAME -f"
echo ""
echo "  4. Reboot to apply UART changes:"
echo "       sudo reboot"
echo ""

# --- Overlay filesystem (read-only root) ---
# For long-term outdoor deployment, consider enabling overlay-fs to
# protect the SD card from write wear.  This makes the root filesystem
# read-only with a tmpfs overlay.
#
# WARNING: After enabling overlay-fs, the filesystem is read-only on
# next boot.  Disable it before making system changes.
#
# To enable:
#   sudo raspi-config nonint do_overlayfs 0
#
# To disable:
#   sudo raspi-config nonint do_overlayfs 1
#
# Make sure /var/lib/gaze and /var/log/gaze are on a writable partition
# (e.g., a separate partition or tmpfs) if overlay-fs is enabled.
# You can add to /etc/fstab:
#   tmpfs /var/lib/gaze tmpfs defaults,size=10M 0 0
#   tmpfs /var/log/gaze tmpfs defaults,size=10M 0 0
