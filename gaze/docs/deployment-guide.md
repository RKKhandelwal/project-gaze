# Gaze Server Deployment Guide

Three ways to get the Gaze server running on the internet so Raspberry Pi devices can reach it.

---

## Option A: VPS (Recommended)

A $4-6/mo VPS on DigitalOcean or Hetzner. Full control, persistent SQLite, real SSL.

### 1. Get a VPS and domain

- Create an Ubuntu 24.04 droplet/server (1 GB RAM is plenty)
- Point a domain (e.g. `gaze.yourdomain.com`) to the server's IP via an A record in your DNS provider

### 2. SSH in and install Docker

```bash
ssh root@YOUR_SERVER_IP

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose plugin
apt install -y docker-compose-plugin

# Verify
docker compose version
```

### 3. Set up firewall

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

### 4. Deploy the app

```bash
# Clone your repo (or scp the files)
git clone https://github.com/YOUR_USER/gaze.git /opt/gaze
cd /opt/gaze/server

# Create .env from template
cp .env.example .env

# Edit .env with your values
nano .env
```

Set these values in `.env`:

```
GAZE_API_KEY=some-strong-random-key-here
VIRTUAL_HOST=gaze.yourdomain.com
LETSENCRYPT_HOST=gaze.yourdomain.com
LETSENCRYPT_EMAIL=you@yourdomain.com
```

Generate a random API key:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 5. Start everything

```bash
docker compose up -d
```

That's it. Within a minute or two, Let's Encrypt will issue an SSL cert automatically.

### 6. Verify

```bash
# Check containers are running
docker compose ps

# Check logs
docker compose logs -f gaze

# Test the API
curl https://gaze.yourdomain.com/api/courts
```

### Updating

```bash
cd /opt/gaze/server
git pull
docker compose up -d --build
```

---

## Option B: Cloudflare Tunnel (No port forwarding)

Run on any machine at home. Cloudflare handles the public URL and SSL. No ports to open, no static IP needed.

### 1. Prerequisites

- A Cloudflare account (free)
- A domain added to Cloudflare (can be a cheap one)
- A machine that can run Docker (old laptop, home server, etc.)

### 2. Run the Gaze server locally

```bash
cd gaze/server
cp .env.example .env
# Edit .env -- set GAZE_API_KEY, you can ignore the VIRTUAL_HOST/LETSENCRYPT vars

# Run just the gaze container (no nginx needed)
docker build -t gaze .
docker run -d \
  --name gaze-server \
  --restart always \
  --env-file .env \
  -v gaze-data:/data \
  -p 8000:8000 \
  gaze
```

### 3. Install cloudflared

```bash
# Debian/Ubuntu
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared

# macOS
brew install cloudflared
```

### 4. Authenticate and create tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create gaze
```

This gives you a tunnel ID (e.g. `abc123-def456-...`).

### 5. Configure the tunnel

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /home/YOUR_USER/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: gaze.yourdomain.com
    service: http://localhost:8000
  - service: http_status:404
```

### 6. Add DNS record

```bash
cloudflared tunnel route dns gaze gaze.yourdomain.com
```

### 7. Run the tunnel

```bash
# Run once to test
cloudflared tunnel run gaze

# Install as system service for auto-start
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

### 8. Verify

```bash
curl https://gaze.yourdomain.com/api/courts
```

---

## Option C: Railway / Fly.io (Easiest)

One-command deploy. Good for trying things out. Note: both use ephemeral filesystems by default, so your SQLite database will be lost on redeploy unless you configure a persistent volume.

### Fly.io

#### 1. Install the CLI

```bash
# macOS
brew install flyctl

# Linux
curl -L https://fly.io/install.sh | sh
```

#### 2. Sign up and launch

```bash
cd gaze/server
fly auth signup   # or: fly auth login
fly launch        # accept defaults, pick a region close to your Pi devices
```

#### 3. Set your API key secret

```bash
fly secrets set GAZE_API_KEY=your-strong-random-key
fly secrets set GAZE_DB_PATH=/data/gaze.db
```

#### 4. Create a persistent volume for SQLite

```bash
fly volumes create gaze_data --size 1 --region YOUR_REGION
```

#### 5. Deploy

A `fly.toml` is included in the repo. After the volume is created:

```bash
fly deploy
```

#### 6. Verify

```bash
fly status
curl https://YOUR_APP.fly.dev/api/courts
```

### Railway

#### 1. Install CLI and deploy

```bash
npm install -g @railway/cli
cd gaze/server
railway login
railway init
railway up
```

#### 2. Set env vars

Go to the Railway dashboard and set `GAZE_API_KEY`.

#### 3. SQLite warning

Railway has an ephemeral filesystem. Your database resets on every deploy. For production use on Railway, switch to PostgreSQL:

```bash
railway add --plugin postgresql
```

Then update `database.py` to use the `DATABASE_URL` env var with an async PostgreSQL driver (e.g. `asyncpg` + `databases` library) instead of SQLite.

---

## Configuring the Raspberry Pi

Once the server is running at `https://gaze.yourdomain.com`, configure each Pi to POST readings:

```bash
curl -X POST https://gaze.yourdomain.com/api/status \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_API_KEY" \
  -d '{"court_id": "court-1", "status": "occupied", "sensor_data": {}, "timestamp": "2025-01-01T12:00:00Z"}'
```

The dashboard is at `https://gaze.yourdomain.com/`.

---

## Quick Reference

| | VPS | Cloudflare Tunnel | Fly.io / Railway |
|---|---|---|---|
| Cost | $4-6/mo | Free | Free tier available |
| SSL | Auto (Let's Encrypt) | Auto (Cloudflare) | Auto |
| SQLite persistence | Yes | Yes | Needs volume config |
| Setup time | ~20 min | ~15 min | ~5 min |
| Best for | Production | Home server | Quick testing |

---

# Sensor Node Deployment (Raspberry Pi Zero 2W)

Everything above is about the **server** side. This section is about the **sensor** side — getting a freshly-flashed Pi from "boots and SSHes" to "reading live detection data from the HLK-LD1125H".

## Prerequisites

- Pi Zero 2W flashed with Raspberry Pi OS Lite (64-bit)
- WiFi configured during flashing (Raspberry Pi Imager advanced options)
- SSH enabled during flashing
- Pi boots, joins WiFi, and you can `ssh gaze@gaze-court-01.local`
- HLK-LD1125H sensor in hand
- Female-to-female Dupont jumper wires for sensor-to-GPIO connections

## First-Boot Sensor Bring-Up

### Phase A — Deploy the code to the Pi

From your Mac:

```bash
cd /path/to/claudeEXP
scp -r gaze/sensor gaze@gaze-court-01.local:/home/gaze/
```

### Phase B — Run the installer on the Pi

```bash
ssh gaze@gaze-court-01.local
cd /home/gaze/sensor
sudo bash install.sh
```

The installer will:
1. Install Python + venv
2. Enable UART (`enable_uart=1` and `dtoverlay=miniuart-bt` in `/boot/firmware/config.txt`)
3. Disable the serial console
4. Create the `gaze` system user
5. Set up a Python venv at `/opt/gaze/venv`
6. Copy the sensor code to `/opt/gaze/sensor`
7. Install and enable the `gaze-sensor.service` (but not start it yet)

Then power off cleanly so you can wire the sensor safely:

```bash
sudo shutdown now
```

### Phase C — Wire the LD1125H to the Pi GPIO

**Pi powered OFF.** Connect the sensor with jumper wires:

| LD1125H pin | RPi Zero 2W physical pin | Function |
|-------------|--------------------------|----------|
| VCC | Pin 4 | 5V |
| GND | Pin 6 | GND |
| TX  | Pin 10 (GPIO15) | Sensor TX → Pi RXD |
| RX  | Pin 8 (GPIO14)  | Sensor RX → Pi TXD |

**Before powering on, verify:**
- LD1125H silkscreen matches the above pinout (pin order varies by variant)
- Sensor TX is 3.3V logic (typical for Hi-Link 24GHz modules). If the datasheet says 5V TTL, **do not connect** — the Pi GPIO is not 5V-tolerant.
- VCC and GND are not swapped
- TX and RX are crossed (sensor TX → Pi RX, not TX→TX)

### Phase D — Raw UART sanity check

Power the Pi back on and SSH in:

```bash
ssh gaze@gaze-court-01.local

# Verify UART device now exists
ls -la /dev/ttyAMA0 /dev/serial0

# Raw sensor test — should show ASCII lines when you move in front of sensor
cat /dev/ttyAMA0
```

Expect output like:

```
mov, dis=234
occ, dis=156
mov, dis=178
```

Ctrl+C to stop. If you see those lines, the hardware is working. If not, see troubleshooting below.

### Phase E — Create the service environment file

The installer doesn't create `/etc/gaze/env` for you — do it now:

```bash
sudo mkdir -p /etc/gaze
sudo tee /etc/gaze/env > /dev/null << 'EOF'
GAZE_COURT_ID=court-01
GAZE_NODE_ID=node-01
GAZE_SENSOR_PORT=/dev/ttyAMA0
GAZE_API_URL=http://localhost:8000/api/status
GAZE_API_KEY=dev-prototype-key
GAZE_POLL_INTERVAL=5
GAZE_DEBOUNCE_TIMEOUT=300
GAZE_LOG_LEVEL=INFO
EOF
sudo chmod 600 /etc/gaze/env
```

For prototyping without a server, `GAZE_API_URL` can stay at `http://localhost:8000/api/status`. The reporter will fail to POST and buffer locally. That's expected.

### Phase F — Start the service and watch it

```bash
sudo systemctl start gaze-sensor
sudo journalctl -u gaze-sensor -f
```

Expected log lines (in order):

1. `=== Gaze Sensor Node starting ===`
2. `Sensor: /dev/ttyAMA0`
3. `Sensor A connected on /dev/ttyAMA0 @ 115200 baud`
4. `Sensor A configured: rmax=12m, mov_th=60, occ_th=60`
5. `Entering main loop`
6. Walk in front of sensor → `Court court-01 -> OCCUPIED`
7. After 5 min of no motion → `Court court-01 -> AVAILABLE`
8. Periodic `POST failed` warnings — expected, no server running

Ctrl+C exits the log tail; the service keeps running in the background.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `/dev/ttyAMA0` still missing after reboot | UART config didn't apply | `grep enable_uart /boot/firmware/config.txt` — if missing, re-run `install.sh` |
| `cat /dev/ttyAMA0` hangs with no output | Sensor not powered or TX/RX reversed | Check sensor LED is on, verify pinout, swap TX/RX if needed |
| `cat /dev/ttyAMA0` prints garbage | Baud mismatch or 5V TTL sensor | `stty -F /dev/ttyAMA0 115200 raw -echo` then retry. If still garbage, suspect 5V logic — disconnect immediately |
| Service `Permission denied` on `/dev/ttyAMA0` | `DeviceAllow` mismatch in service file | Re-deploy the updated `gaze-sensor.service` then `systemctl daemon-reload && systemctl restart gaze-sensor` |
| Service logs `POST failed` constantly | No server running yet | Expected. Readings buffer locally in `/var/lib/gaze/buffer.db`. Run the Gaze server (see top of this doc) when you're ready. |
| Sensor connects but never detects anyone | Thresholds too conservative or out of range | Try sending `rmax=16` and lower `mth*_mov` / `mth*_occ` values via a direct UART write. Defaults are `rmax=12`, `mth*=60` |

## What's next

Once the sensor is reading data locally, the next step is running the **Gaze server** (see "Option A: VPS" or "Option C: Fly.io" above for production, or just `uvicorn server.main:app --host 0.0.0.0 --port 8000` on your Mac for local development) and updating `GAZE_API_URL` in `/etc/gaze/env` to point at it.
