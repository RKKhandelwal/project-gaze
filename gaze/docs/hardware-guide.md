# Project Gaze -- Hardware Wiring Guide (Single Court Unit)

**Author:** Senna (Volt) -- IoT & Embedded Systems Engineer
**Revision:** 2.0
**Date:** 2026-04-08

---

## Table of Contents

1. [Bill of Materials (BOM)](#1-bill-of-materials-bom)
2. [Wiring Diagram](#2-wiring-diagram)
3. [RPi GPIO Pinout Reference](#3-rpi-gpio-pinout-reference)
4. [Power Chain Detail](#4-power-chain-detail)
5. [Sensor Mounting](#5-sensor-mounting)
6. [Enclosure Layout](#6-enclosure-layout)
7. [Assembly Steps](#7-assembly-steps)
8. [Pre-deployment Checklist](#8-pre-deployment-checklist)

---

## 1. Bill of Materials (BOM)

### Core Compute

| # | Component | Specs | Qty | Est. Price (USD) | Source |
|---|-----------|-------|-----|-------------------|--------|
| 1 | Raspberry Pi Zero 2W | BCM2710A1, 512MB RAM, Wi-Fi, BT 4.2 | 1 | $15.00 | RPi official resellers / Amazon |
| 2 | MicroSD Card | 16GB+ Class 10 A1, with adapter | 1 | $5.00 | Amazon |

### Sensors

| # | Component | Specs | Qty | Est. Price (USD) | Source |
|---|-----------|-------|-----|-------------------|--------|
| 3 | HLK-LD1125H mmWave Sensor | 24GHz, UART (115200 baud default), ASCII output, ~12-16m range for humans, detects moving + stationary | 1 | $12.00 | AliExpress (Hi-Link official store) |

> **1 sensor per court.** Mounted behind the baseline on the short side of the court, looking down the court like a server's perspective. Detects presence (moving + stationary) up to ~12-16m, covering the near half of the court plus part of the far half. Connected via the RPi's native UART0 on GPIO pins 8/10 — no USB-UART adapter or OTG cable needed.
>
> **Why LD1125H over LD2412?** The LD2412 only reaches ~6m, which from behind the baseline barely makes it to the service line. The LD1125H's ~12-16m range covers most of the playing area where activity actually happens. Note: the LD1125H uses an **ASCII text protocol** (e.g., `mov, dis=234\n`), not the binary frame protocol of the LD2410/LD2412 family. The existing `gaze/sensor/ld2412.py` driver will need to be replaced with an ASCII parser for this sensor.
### Power System

| # | Component | Specs | Qty | Est. Price (USD) | Source |
|---|-----------|-------|-----|-------------------|--------|
| 4 | Solar Panel | Reolink 6W solar panel, IP65, USB 5V output, waterproof, adjustable mount | 1 | $20.00 | Amazon (Reolink official) |
| 5 | Solar Charge Controller | HiLetgo TP4056 Type-C module with DW01 dual protection (overcharge + overdischarge) | 1 | $2.50 | Amazon / AliExpress (3-pack ~$7.50) |
| 6 | 18650 Battery + Holder | 3.7V 18650 Li-ion cell (button top) + single-cell holder with wires | 1 | $3.00 | Amazon / AliExpress |
| 7 | 5V Boost Converter | MT3608 or SX1308 module, 3.7V in / 5V 2A out, potentiometer pre-adjusted | 1 | $1.50 | AliExpress / Amazon |

> **Power chain:** Reolink USB 5V → TP4056 (charges battery) → 18650 cell → MT3608 boost → 5V to RPi. The Reolink panel outputs regulated 5V via USB, which falls within the TP4056's 4.5-5.5V input range. Cut a USB cable to access the 5V/GND wires.
>
> **Battery capacity warning:** Budget 18650 cells marketed as "9900mAh" typically have 1500-2500mAh actual capacity. Plan runtime estimates around ~2500mAh (conservative) until you can test real capacity.

### Enclosure and Mechanical

| # | Component | Specs | Qty | Est. Price (USD) | Source |
|---|-----------|-------|-----|-------------------|--------|
| 8 | IP65 ABS Enclosure | Sunnyglade ~100x150x71mm (3.9"x5.9"x2.8"), with lock | 1 | $10.00 | Amazon |
| 9 | PG7 Cable Glands | IP68 nylon, 3-6.5mm cable diameter | 3 | $3.00 (pack of 10) | AliExpress / Amazon |
| 10 | M2.5 Brass Standoffs | 11mm female-female + M2.5 screws, for RPi Zero mounting | 4 | $2.00 (assorted kit) | AliExpress / Amazon |
| 11 | M3 Nylon Standoffs | 6mm, for mounting boost converter and charge controller | 4 | (included in kit above) | -- |
| 12 | Silica Gel Desiccant Packs | 3g packs, indicating type (blue->pink) | 3 | $2.00 (pack of 20) | Amazon |
| 13 | Sensor Mini Enclosure | Small ABS box ~60x40x25mm or 3D-printed radome, IP54+ | 1 | $3.00 | AliExpress / 3D print |

> **Enclosure note:** The 100x150x71mm box is smaller than the original BOM spec (200x120x75mm) but fits the slimmed-down 1-sensor build. Do a dry-fit of all components before committing to mounting holes.

### Wiring and Connectors

| # | Component | Specs | Qty | Est. Price (USD) | Source |
|---|-----------|-------|-----|-------------------|--------|
| 14 | Dupont Jumper Wires | Female-female, 20cm, 2.54mm pitch (or breadboard jumpers for prototyping) | 1 pack | $1.50 | AliExpress / Amazon |
| 15 | 22AWG Silicone Wire | Red + Black, 2m each | 1 set | $3.00 | AliExpress / Amazon |
| 16 | 26AWG Shielded Cable | 4-conductor, for sensor UART run to fence (~5-8m) | 10m | $4.00 | AliExpress (search "4-core 26AWG shielded cable") |
| 17 | USB-A Cable (sacrificial) | Any USB-A cable to cut — expose 5V/GND wires for Reolink panel input to TP4056 | 1 | $1.00 | Any spare cable |
| 18 | Heat Shrink Tubing | Assorted 2:1 ratio, 2-5mm diameters | 1 pack | $2.00 | Amazon |
| 19 | Self-Adhesive Cable Clips | Nylon, for routing cable along poles/fences | 20 | $2.00 | Amazon |

### Tools Required (Not Included in BOM)

- Soldering iron (25-40W) + solder (60/40 or lead-free)
- Wire strippers (for 22-26 AWG)
- Multimeter
- Small Phillips screwdriver
- Hot glue gun (for securing connectors inside enclosure)
- Drill with 12mm step bit (for cable gland holes)

### BOM Cost Summary

| Category | Subtotal |
|----------|----------|
| Core Compute | $20.00 |
| Sensors | $12.00 |
| Power System | $27.00 |
| Enclosure & Mechanical | $20.00 |
| Wiring & Connectors | $13.50 |
| **Total per court unit** | **~$92.50** |

> **Note:** Prices are estimates as of early 2026. The LD1125H costs more than the LD2412 (~$12 vs ~$4.50) but more than doubles the detection range, which matters for tennis courts. AliExpress is cheaper but slower (2-4 weeks). Amazon costs ~20-40% more but ships faster.

---

## 2. Wiring Diagram

### 2.1 System Overview (ASCII)

```
                         COURT LAYOUT (top-down view)

    Baseline A (SENSOR HERE)
    +----------------------------------------------------------+
    |  [SENSOR] LD1125H                                        |
    |     |                                                    |
    |     |---> detection zone (looking down the court) ------>|
    |     (behind baseline, like a server's perspective)       |
    |                                                          |
    |               NET                                        |
    |  - - - - - - - - - - - - - - - - - - - - - - - - - - -   |
    |                                                          |
    |                                                          |
    |                                                          |
    |                                                          |
    |                                              Baseline B  |
    +----------------------------------------------------------+
         ||  4-conductor shielded cable (~5-8m)
         ||
         ||             ENCLOSURE (mounted on net post or fence)
         ||   +-----------------------------------------+
         |+===|  PG7 Gland                              |
              |                                         |
              |  +-------+   +--------+    +--------+   |
              |  | RPi   |   | Boost  |    | TP4056 |   |
              |  | Zero  |   | Conv.  |    | Charge |   |
              |  | 2W    |   | 3.7->5V|    | Ctrl   |   |
              |  +---+---+   +---+----+    +----+---+   |
              |      |           |              |       |
              |      |    5V     |    3.7V      |       |
              |      +<----------+<--------+    |       |
              |                            |    |       |
              |                  +---------+----+--+    |
              |                  | 18650 Battery   |    |
              |                  | 3.7V (~2500mAh) |    |
              |                  | in holder       |    |
              |                  +-----------------+    |
              |                                         |
              |  PG7 Gland (solar)    PG7 Gland (spare) |
              +--------||-------------------|-----------+
                       ||
                  +----++----+
                  | Reolink  |
                  | 6W Solar |
                  | Panel    |
                  | (USB 5V) |
                  +----------+
                  (mounted nearby, angled toward sun)
```

### 2.2 Detailed Wiring Diagram (ASCII)

```
=============================================================================
                    COMPLETE WIRING -- PIN-LEVEL DETAIL
=============================================================================

    REOLINK 6W SOLAR PANEL (USB 5V)        TP4056 CHARGE CONTROLLER
    +------------------+                   +------------------------+
    | USB cable (cut)  |                   |                        |
    | RED (+5V) -------|---RED 22AWG------>| IN+ (USB-C pad or VIN) |
    | BLK (GND) -------|---BLK 22AWG------>| IN- (GND)              |
    +------------------+                   |                        |
                                           | BAT+ ----+             |
    Cut the USB-A end of any USB           | BAT- ----|-+           |
    cable. Expose the RED (+5V)            +----------|-|----------+
    and BLACK (GND) wires. The                        | |
    green/white data wires are             RED 22AWG  | |
    not needed -- tape them off.  +-----------------------+
                                  |       BLK 22AWG    |
                                  |  +------------------+
                                  |  |
                                  v  v
              18650 BATTERY IN HOLDER (3.7V, ~2500mAh real capacity)
              +------------------+
              | (+) RED ---------|----+
              | (-) BLK ---------|--+ |
              +------------------+  | |
                                    | |  RED 22AWG
                                    | +-------------+
                                    |               |
                                    | BLK 22AWG     |
                                    +----------+    |
                                               |    |
                                               v    v
                                    BOOST CONVERTER (MT3608/SX1308)
                                    +------------------------+
                                    | VIN-/GND    VIN+       |
                                    |                        |
                                    | VOUT+ (5V)  VOUT-/GND  |
                                    +---+----------------+---+
                                        |                |
                                   RED 22AWG        BLK 22AWG
                                        |                |
                                        v                v
                              RASPBERRY PI ZERO 2W
    Physical pin layout (header, left side facing up):
    +==========================================+
    |  5V  5V  GND  14  15  18  GND  23  24  GND|  (row of even pins)
    |  3V3 SDA SCL  4   GND 17  27  22  3V3 ... |  (row of odd pins)
    | pin2 pin4 pin6 pin8 ...                    |  (physical pin #s)
    | pin1 pin3 pin5 pin7 ...                    |
    +==========================================+


=== SENSOR (Side Fence) -- Direct UART via RPi GPIO (UART0) ===

    HLK-LD1125H Sensor                    RPi Zero 2W GPIO Header
    +------------------+                   (Physical pin numbers)
    | VCC (5V) --------|---RED 26AWG------>| Pin 4  (5V)            |
    | GND -------------|---BLK 26AWG------>| Pin 6  (GND)           |
    | TX  -------------|---YEL 26AWG------>| Pin 10 (GPIO15/RXD0)   |
    | RX  -------------|---GRN 26AWG------>| Pin 8  (GPIO14/TXD0)   |
    +------------------+                   +------------------------+

    Wire: 4-conductor 26AWG shielded cable, length = distance from
          enclosure to sensor behind baseline (~5-8m).
          Shield drain wire tied to GND at RPi end ONLY (single-point ground).


=== POWER CONNECTIONS DETAIL ===

    Reolink USB RED (+5V) ---[RED 22AWG]---> TP4056 IN+
    Reolink USB BLK (GND) ---[BLK 22AWG]---> TP4056 GND

    TP4056 BAT+ ---[RED 22AWG]---> 18650 holder (+) terminal
    TP4056 BAT- ---[BLK 22AWG]---> 18650 holder (-) terminal

    18650 holder (+) ---[RED 22AWG]---> Boost VIN+
    18650 holder (-) ---[BLK 22AWG]---> Boost VIN-

    Boost VOUT+ (5V) ---[RED 22AWG]---> RPi Pin 2 (5V)
    Boost VOUT- (GND) ---[BLK 22AWG]---> RPi Pin 14 (GND)

    NOTE: Powering via GPIO pins 2+14 bypasses the RPi's polyfuse.
          This is intentional (lower voltage drop) but means the boost
          converter MUST be current-limited or fused. The MT3608 is
          inherently limited to ~2A which is safe for the Pi Zero 2W.

    NOTE: The TP4056 charges at up to 1A (set by Rprog resistor on
          the module). The Reolink 6W panel can supply ~1.2A at 5V,
          so it has enough headroom. The TP4056's DW01 protection IC
          handles overdischarge and short-circuit protection for the
          18650 cell.
```

### 2.3 Wire Color Convention

| Color | Function |
|-------|----------|
| **Red** | Power positive (+5V or +3.7V or +6V) |
| **Black** | Ground (GND / power negative) |
| **Yellow** | UART TX (from sensor) -> RX (on receiver) |
| **Green** | UART RX (on sensor) <- TX (from transmitter) |
| **Bare/Drain** | Shield drain wire (grounded at one end only) |

> **Critical:** The sensor's TX connects to the RPi RXD (and vice versa). TX-to-RX, RX-to-TX. The colors above follow the signal from the sensor's perspective.

---

## 3. RPi GPIO Pinout Reference

### 3.1 Raspberry Pi Zero 2W -- 40-Pin Header

```
                    RPi Zero 2W GPIO Header
                    (micro-USB power port at bottom)

             3V3  (1) (2)  5V      <-- Boost VOUT+ (power in)
           GPIO2  (3) (4)  5V      <-- Sensor 1 VCC (5V feed)
           GPIO3  (5) (6)  GND     <-- Sensor 1 GND
           GPIO4  (7) (8)  GPIO14  <-- UART0 TXD (to Sensor 1 RX) 
             GND  (9) (10) GPIO15  <-- UART0 RXD (from Sensor 1 TX)
          GPIO17 (11) (12) GPIO18
          GPIO27 (13) (14) GND     <-- Boost VOUT- (power GND)
          GPIO22 (15) (16) GPIO23
             3V3 (17) (18) GPIO24
          GPIO10 (19) (20) GND
           GPIO9 (21) (22) GPIO25
          GPIO11 (23) (24) GPIO8
             GND (25) (26) GPIO7
           GPIO0 (27) (28) GPIO1
           GPIO5 (29) (30) GND
           GPIO6 (31) (32) GPIO12
          GPIO13 (33) (34) GND
          GPIO19 (35) (36) GPIO16
          GPIO26 (37) (38) GPIO20
             GND (39) (40) GPIO21
```

### 3.2 Pin Assignment Summary

| Physical Pin | GPIO / Function | Connection | Direction |
|--------------|-----------------|------------|-----------|
| Pin 2 | 5V Power | Boost converter VOUT+ | Power IN |
| Pin 4 | 5V Power | Sensor VCC (via wire from Pin 2 rail) | Power OUT |
| Pin 6 | GND | Sensor GND | -- |
| Pin 8 | GPIO14 (UART0 TXD) | Sensor RX pin | RPi -> Sensor |
| Pin 10 | GPIO15 (UART0 RXD) | Sensor TX pin | Sensor -> RPi |
| Pin 14 | GND | Boost converter VOUT- | Power GND |

### 3.3 UART0 Configuration (for Sensor 1)

UART0 on the Pi Zero 2W is shared with the Bluetooth module by default. You **must** disable Bluetooth or remap UART to free up UART0 for the sensor.

Add to `/boot/config.txt`:
```
# Disable Bluetooth to free UART0 for sensor
dtoverlay=disable-bt
```

And disable the BT modem service:
```bash
sudo systemctl disable hciuart
```

After reboot, UART0 is available at `/dev/ttyAMA0` on pins 8 (TXD) and 10 (RXD).

Also disable the serial console so it does not interfere:
```bash
sudo raspi-config
# -> Interface Options -> Serial Port
# -> Login shell over serial: NO
# -> Serial port hardware enabled: YES
```

---

## 4. Power Chain Detail

### 4.1 Power Architecture

```
  [Reolink 6W Solar Panel]    -- Outputs regulated USB 5V (~1.2A max).
         |                       Cut USB cable to access 5V/GND wires.
         v
  [TP4056 Charge Controller]  -- Accepts 4.5-5.5V input. Charges Li-ion
         |                       at up to 1A (CC/CV). DW01 dual protection
         v                       handles overcharge, overdischarge, short.
  [18650 Cell 3.7V ~2500mAh]  -- Stores energy. Voltage range: 3.0-4.2V
         |                       In single-cell holder with wires.
         v                       TP4056 DW01 provides battery protection.
  [Boost Converter 3.7V->5V]  -- MT3608 steps up 3.0-4.2V to stable 5V
         |                       Efficiency ~90% at load point.
         v
  [RPi Zero 2W + Sensor]      -- System load: all components powered.
```

### 4.2 Power Consumption Breakdown

| Component | Voltage | Typical Current | Peak Current | Power (typical) |
|-----------|---------|-----------------|--------------|-----------------|
| RPi Zero 2W (idle, Wi-Fi on) | 5V | 100mA | 300mA (boot/burst) | 0.50W |
| RPi Zero 2W (active, Wi-Fi TX) | 5V | 170mA | 300mA | 0.85W |
| HLK-LD1125H Sensor | 5V | 70mA | 150mA (during TX) | 0.35W |
| Boost converter quiescent | -- | 0.5mA | -- | ~0.002W |
| **System Total** | **5V** | **~340mA** | **~750mA** | **~1.70W** |

### 4.3 Runtime Calculations (No-Sun Periods)

**Battery energy available (conservative estimate with budget 18650):**

- Battery capacity: ~2,500mAh at 3.7V = 9.25 Wh (real-world for budget "9900mAh" cells)
- Usable capacity (to protect battery, discharge to 3.2V only): ~85% = **7.86 Wh**
- Boost converter efficiency: ~90%
- Usable energy at 5V rail: 7.86 x 0.90 = **7.07 Wh**

**Continuous runtime (system always on):**

- System power: ~1.70W typical
- Runtime = 7.07 Wh / 1.70W = **~4.2 hours**

**With power management (sensor duty-cycled):**

If the sensor is polled for 10 seconds every 30 seconds and the RPi enters low-power idle between polls:
- Effective average power: ~1.0W
- Runtime = 7.07 / 1.0 = **~7.1 hours**

**With aggressive sleep (RPi halted between scheduled checks):**

If the system wakes every 5 minutes, checks sensor for 15 seconds, sends data, then halts:
- Active: 15s at 1.70W, idle/halt: 285s at ~0.05W (boost quiescent + leakage)
- Average power: (15/300 x 1.70) + (285/300 x 0.05) = 0.085 + 0.048 = **~0.133W**
- Runtime = 7.07 / 0.133 = **~53 hours (~2.2 days)**

> **Important:** These numbers assume budget 18650 cells with ~2500mAh real capacity. If you test your cells and find higher capacity, runtimes scale proportionally. You can also run 2x 18650 in parallel (both holders wired in parallel to the TP4056 BAT+/BAT-) to double capacity without changing voltage.
>
> **Recommendation for padel courts:** Courts are primarily used during daytime. Keep the system always-on during daylight hours (6am-10pm) and use aggressive sleep at night. With solar charging during the day, the system should run continuously in sunny climates. In overcast conditions, parallel batteries help bridge multi-day cloud cover.

### 4.4 Solar Charging Estimate

- Solar panel: Reolink 6W, outputs regulated USB 5V
- Effective output after USB regulation losses: ~4W usable
- Real-world average yield: ~3-4 hours of effective full sun per day (varies by location and season)
- Daily solar energy: 4W x 3.5h = **14 Wh** (conservative average)
- Daily consumption (always-on 16h + sleep 8h): (1.70 x 16) + (0.133 x 8) = 27.2 + 1.06 = **28.3 Wh**

> **Verdict:** The 6W Reolink panel is marginal for always-on operation (~14 Wh generated vs ~28 Wh consumed). Options:
> 1. **Implement duty-cycling** to reduce average consumption to ~1.0W. Daily need drops to ~16 Wh, which the panel can sustain on sunny days.
> 2. **Run 2x 18650 in parallel** to double battery reserve for bridging cloudy days.
> 3. **Accept overnight drainage** and rely on daytime solar to recharge. With the 1-sensor design's lower power draw, a full battery can last overnight with duty-cycling.

### 4.5 Battery Protection Notes

1. **Over-discharge protection:**
   - The TP4056 module's DW01 protection IC cuts off output below ~2.5V.
   - Additionally, you can configure the RPi to perform a clean shutdown when battery voltage drops below 3.3V (read via ADC if available, or use a low-voltage cutoff module).

2. **Over-charge protection:**
   - The TP4056 handles charge termination at 4.2V with CC/CV charging.
   - The DW01 IC provides a second layer of overcharge protection.

3. **Short-circuit protection:**
   - The TP4056's DW01 IC provides short-circuit cutoff.
   - Keep all wiring inside the enclosure tidy and insulated with heat shrink.

4. **Temperature:**
   - Li-ion 18650 cells should not be charged below 0C or above 45C.
   - The enclosure's light color helps moderate temperature.
   - In extreme climates, consider adding a thermistor-based charge disable.

5. **Wire gauge for power:**
   - Use **22AWG** minimum for all power connections (solar -> charger, battery, boost, RPi).
   - 22AWG handles up to 3A safely, well above our ~750mA max draw.
   - Keep power wire runs short (under 20cm inside the enclosure).

---

## 5. Sensor Mounting

### 5.1 Positioning

A single HLK-LD1125H sensor is mounted behind one baseline (the short side of the court), looking down the length of the court — the same perspective as a player about to serve. This gives the sensor a clear line of sight across the entire court.

```
    PADEL COURT (10m x 20m)

    +-----------------------------------------+
    |                                         |
    |  [SENSOR]  (behind baseline A,          |
    |   looking down the court)               |
    |     |                                   |
    |     +----> detection zone ------------->|
    |                                         |
    |              NET                        |
    |  - - - - - - - - - - - - - - - - - - - |
    |                                         |
    |                                         |
    |                                         |
    |  Baseline B                             |
    +-----------------------------------------+
```

> **Why one sensor?** Presence detection only needs to answer "is anyone on this court?" — not "where exactly are they?" A single mmWave sensor with a 60-degree cone, aimed down the court from behind the baseline, covers most of the playing area. This halves sensor cost, eliminates the USB-UART adapter, and simplifies wiring.

### 5.2 Mounting Height and Angle

- **Height:** Mount the sensor at **2.5-3.0 meters** above ground level on the fence or structure behind the baseline. This gives a downward angle for better court coverage.
- **Angle:** Tilt the sensor **10-15 degrees downward** from horizontal, aimed down the length of the court toward the far baseline.
- **The LD1125H has a detection cone of approximately 60 degrees horizontally and 60 degrees vertically.** Aimed down the court from behind the baseline, the cone fans out to cover the full court width within a few meters. At the LD1125H's max range of ~12-16m, the cone reaches well past the net into the far half of the court — covering most of the area where players actually move during play.

### 5.3 Sensor Mini-Enclosure

The sensor needs a weather-resistant housing:

- Use a small ABS box (~60x40x25mm) or 3D-print a radome.
- The front face (where the radar signal passes through) MUST be **plain ABS or polycarbonate** -- no metal, no metallic paint. mmWave passes through plastic with minimal attenuation.
- Drill a small drain hole (2mm) at the bottom of the sensor enclosure to prevent water pooling.
- Seal the cable entry point with silicone sealant or a small PG7 cable gland.
- Mount with stainless steel screws or UV-resistant zip ties to the fence.

### 5.4 Cable Routing

- Run the 4-conductor shielded cable from the sensor enclosure behind the baseline to the main RPi enclosure (mounted nearby on the fence or structure).
- Route the cable along the fence/structure using adhesive cable clips every 30-40cm.
- Use **UV-resistant cable ties** (black nylon) for outdoor sections.
- Avoid sharp bends (minimum bend radius: 5x cable diameter).
- Where the cable enters the main enclosure, use a PG7 cable gland. Tighten firmly for IP65 seal.
- **Cable length:** With the sensor behind the baseline and the enclosure mounted nearby, the run is typically **5-8m**. Buy 10m to allow for routing overhead.

### 5.5 UART Signal Integrity

UART at 115200 baud over 5-8m of 26AWG shielded cable is well within reliable range. The shorter cable run (vs. the original 10-15m baseline design) significantly improves signal integrity.

1. **Use shielded cable** (already specified in BOM). Connect shield drain wire to GND at the RPi end only.
2. If you experience data corruption, **reduce baud rate** to 57600 or 38400. The LD1125H supports configurable baud rates.
3. At these short distances, termination resistors are typically not needed.

---

## 6. Enclosure Layout

### 6.1 Internal Component Placement

```
    MAIN ENCLOSURE -- INTERIOR VIEW (lid removed, looking down)
    Sunnyglade 100x150x71mm (3.9"x5.9"x2.8")
    +--------------------------------------+
    |                                      |
    |  [PG7]        [PG7]        [PG7]     |
    |  Sensor       Solar        Spare     |
    |  cable in     cable        (sealed)  |
    |                                      |
    |  +----------+   +--------+           |
    |  | RPi Zero |   | TP4056 |           |
    |  | 2W       |   | Charge |           |
    |  | (on M2.5 |   | Ctrl   |           |
    |  | standoffs)|  | (VHB)  |           |
    |  +----------+   +--------+           |
    |                                      |
    |  +-----------+  [Desiccant pack]     |
    |  | Boost     |                       |
    |  | Converter |                       |
    |  | (on M3    |                       |
    |  | standoffs)|                       |
    |  +-----------+                       |
    |                                      |
    |  +------------------+                |
    |  | 18650 Battery    |                |
    |  | in holder        | [Desiccant]    |
    |  | (velcro strap)   |                |
    |  +------------------+                |
    |                                      |
    +--------------------------------------+
```

> **Tight fit:** This enclosure is smaller than the original BOM spec. Do a dry-fit of all components before drilling any holes. The RPi Zero 2W (65x30mm), TP4056 (~25x19mm), MT3608 (~36x17mm), and 18650 holder (~77x20mm) should fit in the 100x150mm footprint if arranged carefully.

### 6.2 Component Mounting Details

| Component | Mounting Method | Notes |
|-----------|----------------|-------|
| RPi Zero 2W | M2.5 brass standoffs (4x), screwed to enclosure floor | Pre-drill 4 holes matching RPi mounting pattern (58x23mm spacing) |
| Boost converter | M3 nylon standoffs (2x) or double-sided VHB tape | Keep close to battery for short power leads |
| TP4056 charge controller | VHB tape or M3 nylon standoffs | Mount near solar cable gland entry point. Small enough for adhesive. |
| 18650 battery + holder | Velcro strap across the holder, anchored to enclosure floor | Battery MUST be secure -- cannot shift during wind/vibration |
| Desiccant packs | Loose, placed in available gaps | Replace every 3-6 months or when indicator turns pink |

### 6.3 Cable Gland Placement

Drill three PG7 holes along one side of the enclosure:

1. **Sensor cable** -- 4-conductor shielded cable to baseline sensor
2. **Solar panel cable** -- USB cable from Reolink panel (5V/GND wires)
3. **Spare** -- keep sealed with a blank gland plug (future use: external antenna, additional sensor)

Drill holes at **12.5mm diameter** for PG7 glands. Drill from outside-in to avoid cracking the ABS. Deburr the hole edges.

### 6.4 Thermal Management

- Use a **white or light grey enclosure** to minimize solar heat absorption.
- Do **NOT** drill ventilation holes -- this compromises the IP65 rating.
- In hot climates (>40C ambient), consider:
  - Mounting the enclosure in shade (e.g., under a roof overhang)
  - Adding an aluminum heat spreader plate to the enclosure interior wall
  - Using a slightly larger enclosure to increase thermal mass and air volume
- The RPi Zero 2W generates very little heat (~1W). The battery is the main thermal concern (do not exceed 45C for charging, 60C for discharge).

### 6.5 Condensation Prevention

- Place **3x 3g silica gel desiccant packs** inside the enclosure.
- Use **indicating type** (blue/orange when dry, pink/clear when saturated).
- Replace on a maintenance schedule (every 3-6 months depending on climate).
- Ensure all cable glands are properly tightened. Apply a thin bead of **silicone sealant** around each gland nut on the outside for extra protection.
- If condensation is severe, consider using a conformal coating spray (e.g., MG Chemicals 419D) on the RPi PCB and charge controller to protect against moisture shorts.

---

## 7. Assembly Steps

### Phase 1: Prepare Components (Bench Work)

**Step 1: Configure the RPi Zero 2W**
- Flash the microSD card with Raspberry Pi OS Lite (32-bit).
- Boot the RPi on a bench (powered via micro-USB power port temporarily).
- Connect to Wi-Fi and enable SSH.
- Disable Bluetooth and configure UART0 per Section 3.3.
- Install the Gaze server software and test it.
- Shut down and remove power.

**Step 2: Pre-adjust the Boost Converter**
- Connect the boost converter input to a 3.7V bench supply (or a charged LiPo).
- Use a multimeter on the output.
- Turn the potentiometer on the MT3608/SX1308 until the output reads **5.10-5.20V** (slightly above 5V to account for voltage drop under load).
- Mark the potentiometer position with a dot of nail polish or paint to prevent accidental adjustment.

**Step 3: Prepare the TP4056 Charge Controller**
- The TP4056 module comes pre-configured for 4.2V Li-ion charging at 1A (default Rprog resistor).
- Cut a USB cable (any spare USB-A cable). Strip the insulation to expose the 4 inner wires. You only need **RED (+5V)** and **BLACK (GND)**. Tape off the green and white data wires.
- Solder the red wire to TP4056 IN+ and black wire to TP4056 GND. This is how the Reolink solar panel's USB output connects to the charger.
- Test: plug the USB cable into the Reolink panel in sunlight. The TP4056 charge LED should light up.

**Step 4: Prepare the Sensor Cable**
- Cut one length of 4-conductor shielded cable (measure distance from enclosure to sensor location behind baseline + 2m slack, typically ~7-10m total).
- Strip and tin one end (the "enclosure end"):
  - Red wire: sensor VCC
  - Black wire: sensor GND
  - Yellow wire: sensor TX
  - Green wire: sensor RX
  - Shield drain: leave 3cm stripped, will connect to GND at enclosure
- On the other end (the "sensor end"), strip and tin similarly.
- If using Dupont connectors, crimp female Dupont terminals onto the enclosure end for easy connection to RPi header pins.

**Step 5: Solder Power Wiring**
- Solder 22AWG red wire: Boost VOUT+ to a female Dupont pin (for RPi header Pin 2).
- Solder 22AWG black wire: Boost VOUT- to a female Dupont pin (for RPi header Pin 14).
- Solder 22AWG wires between TP4056 BAT+/BAT- and the 18650 holder's red(+)/black(-) wires.
- Solder 22AWG wires between 18650 holder output and Boost VIN+/VIN-.
- The solar panel input was already connected in Step 3 (USB cable to TP4056).
- Apply heat shrink to every solder joint.

> **What needs soldering vs. Dupont connectors:**
>
> | Connection | Method |
> |------------|--------|
> | USB cable to TP4056 IN+/GND | Solder (permanent) |
> | TP4056 BAT to 18650 holder | Solder (permanent; swap battery by removing from holder) |
> | 18650 holder to boost converter | Solder (permanent) |
> | Boost converter to RPi | Dupont female pins onto RPi header (removable) |
> | Sensor cable to RPi GPIO | Dupont female pins (removable) |
> | Sensor cable to LD1125H | Solder or Dupont depending on the module's pinout variant |

### Phase 2: Test on Bench (Before Enclosure)

**Step 6: Test the Power Chain**
- Connect the Reolink solar panel USB cable to the TP4056 (or use any USB 5V source for bench testing).
- Insert a charged 18650 cell into the holder. Connect holder to TP4056 BAT+/BAT-.
- Verify the charge LED on the TP4056 is active (battery is charging).
- Connect 18650 holder output to boost converter input.
- Verify boost output reads 5.1-5.2V on multimeter.
- Connect boost output to RPi (Pin 2 and Pin 14).
- RPi should boot. Verify via SSH.

**Step 7: Test the Sensor (UART0)**
- With RPi running, connect sensor cable to RPi pins 4 (5V), 6 (GND), 8 (TXD), 10 (RXD).
- Verify the sensor powers up (red LED on the LD1125H module).
- On the RPi, test the UART:
  ```bash
  # Check that /dev/ttyAMA0 exists
  ls -la /dev/ttyAMA0

  # Quick read test (wave hand in front of sensor) — LD1125H outputs ASCII text
  cat /dev/ttyAMA0
  # Expect lines like:
  #   mov, dis=234
  #   occ, dis=156
  ```
- If you see `mov,` or `occ,` lines flowing, UART0 is working.

**Step 8: Test the Full Software Stack**
- Run the Gaze sensor application.
- Verify the sensor is reporting presence data.
- Verify Wi-Fi connectivity and data upload to the server.
- Let it run for 30 minutes. Check for UART errors, crashes, or power issues.

### Phase 3: Enclosure Assembly

**Step 9: Prepare the Enclosure**
- Do a dry-fit of all components to verify they fit in the 100x150x71mm box.
- Drill three PG7 cable gland holes (12.5mm each) in the enclosure walls.
- Install the PG7 cable glands (finger-tight plus 1/4 turn with pliers).
- Drill RPi mounting holes (M2.5, use the RPi as a template).
- Install M2.5 brass standoffs in the enclosure floor.
- Install M3 nylon standoffs for the boost converter.

**Step 10: Mount Components**
- Mount RPi Zero 2W on standoffs. Secure with M2.5 screws.
- Mount boost converter on standoffs or VHB tape.
- Attach TP4056 with VHB tape near the solar cable gland.
- Place the 18650 holder in position. Secure with velcro strap.

**Step 11: Route Internal Wiring**
- Connect power chain wiring (per schematic in Section 2).
- Route sensor cable through its PG7 gland. Tighten gland firmly around cable.
- Connect sensor cable to RPi GPIO header (Pins 4, 6, 8, 10).
- Route solar USB cable through its PG7 gland.
- Tidy all wires. Use small zip ties or adhesive cable clips inside the enclosure.
- Apply silicone sealant around each PG7 gland on the outside.

**Step 12: Final Bench Test (In Enclosure)**
- Power on the system inside the enclosure (lid open).
- Verify the sensor responds.
- Verify RPi boots and connects to Wi-Fi.
- Let it run for 15 minutes.
- If everything works, place desiccant packs inside.
- Close and seal the enclosure lid.

### Phase 4: Field Deployment

**Step 13: Mount the Enclosure**
- Mount the enclosure on the fence or net post using the enclosure lock/mounting hardware and stainless steel screws or hose clamps.
- The enclosure should be at a height accessible for maintenance (~1.5-2m) but protected from direct ball impacts.

**Step 14: Mount the Sensor**
- Mount the sensor mini-enclosure on the fence/structure behind the baseline, looking down the court.
- Height: 2.5-3.0m. Angle: 10-15 degrees downward, aimed toward the far baseline.
- Route and secure the cable along the fence/structure.

**Step 15: Mount Solar Panel**
- Mount the Reolink solar panel on a nearby surface angled toward the sun. It has its own adjustable mount.
- Angle: match your latitude for optimal year-round performance (e.g., ~35-40 degrees from horizontal at latitude 35-40N).
- Ensure the panel is not shaded by the court structure during peak sun hours (10am-3pm).
- Route the USB cable to the enclosure.

**Step 16: Final Power-On**
- Open enclosure, verify all connections are secure.
- Insert the 18650 battery.
- Power on the system.
- Monitor via SSH for 30 minutes to ensure stable operation.
- Close and seal the enclosure.

---

## 8. Pre-deployment Checklist

Use this checklist before declaring a court unit ready for unattended operation.

### Power System
- [ ] Reolink solar panel receives direct sunlight for at least 3 hours/day in its mounted position
- [ ] 18650 battery is fully charged (4.15-4.2V measured at holder terminals)
- [ ] Boost converter output reads 5.10-5.25V under load (RPi running)
- [ ] TP4056 charge LED indicates charging when solar panel is in sunlight
- [ ] All power wire solder joints are solid and heat-shrinked
- [ ] 18650 holder is securely strapped and cannot shift

### Compute
- [ ] RPi boots successfully and connects to Wi-Fi within 60 seconds
- [ ] SSH access confirmed from monitoring device/server
- [ ] UART0 is configured correctly (`/dev/ttyAMA0` exists, Bluetooth disabled)
- [ ] Gaze sensor software starts on boot (systemd service enabled)
- [ ] MicroSD card has log rotation configured (minimize write cycles)

### Sensor
- [ ] Sensor responds on `/dev/ttyAMA0` at configured baud rate
- [ ] Sensor detects motion correctly (walk in front of sensor and verify)
- [ ] Sensor cable is secured along the fence with cable clips every 30-40cm
- [ ] Sensor mini-enclosure is sealed (drain hole at bottom only)
- [ ] Cable shield drain wire is grounded at the enclosure end only

### Enclosure
- [ ] All three PG7 cable glands are tight (cables do not slide)
- [ ] Silicone sealant applied to exterior of each cable gland
- [ ] Enclosure gasket is seated correctly and undamaged
- [ ] Enclosure lid screws are all present and tight
- [ ] 3x desiccant packs placed inside
- [ ] No loose wires or components that could shift
- [ ] Enclosure is mounted securely (mounting screws/clamps tight)
- [ ] Enclosure is oriented with cable glands facing downward or sideways (never upward, to prevent water ingress)

### Software
- [ ] System time is synchronized (NTP configured for Wi-Fi network)
- [ ] Watchdog timer enabled (`dtparam=watchdog=on` in `/boot/config.txt`)
- [ ] Automatic restart configured for Gaze server service
- [ ] Log rotation configured (prevent SD card fill-up)
- [ ] Data upload tested successfully to remote server

### Physical
- [ ] Sensors are not in the path of ball impacts
- [ ] Enclosure is not in the path of ball impacts
- [ ] Solar panel is angled correctly and unshaded
- [ ] All outdoor cable runs use UV-resistant ties/clips
- [ ] Nothing rattles when the enclosure is shaken gently

---

## Appendix A: LD1125H Sensor Pinout Reference

The HLK-LD1125H module typically has a 4-pin or 5-pin header:

```
    LD1125H MODULE (top view, antenna side up)
    +----------------------+
    |   [antenna pattern]  |
    |                      |
    |  Pin 1: VCC (5V)     |
    |  Pin 2: GND          |
    |  Pin 3: UART TX      |  --> connects to RPi RXD (Pin 10, GPIO15)
    |  Pin 4: UART RX      |  <-- connects to RPi TXD (Pin 8, GPIO14)
    |  Pin 5: OUT (GPIO)   |  (optional, digital presence output)
    +-------[|||||]--------+
             pins
```

> **Verify your specific module's pinout** against the datasheet before wiring. Hi-Link variants sometimes differ in pin order. The silkscreen on the PCB is authoritative.

### LD1125H Protocol (ASCII)

Unlike the LD2410/LD2412 which use a binary frame protocol, the LD1125H outputs **ASCII text** over UART at 115200 baud. Each detection event is sent as a newline-terminated line:

```
mov, dis=234       <-- moving target detected at 234 cm
occ, dis=156       <-- stationary (occupied) target detected at 156 cm
```

When no target is present, the sensor sends nothing.

**Configuration commands** (also ASCII, terminated with newline):

| Command | Effect |
|---------|--------|
| `rmax=12` | Set max detection range to 12 meters |
| `mth1_mov=80` | Set moving target threshold for gate 1 |
| `mth1_occ=80` | Set stationary target threshold for gate 1 |
| `save` | Persist configuration to flash |
| `get_all` | Print current settings |

**Driver implication:** The existing `gaze/sensor/ld2412.py` (binary parser) is NOT compatible with the LD1125H. A new ASCII line-parser driver needs to be written before deployment. See the TODO note in `gaze/sensor/config.py`.

## Appendix B: Troubleshooting Common Issues

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| RPi does not boot | Boost converter not outputting 5V | Check boost VOUT with multimeter. Re-adjust pot. Check 18650 voltage (below 3.0V = dead). |
| Sensor not detected | UART0 still assigned to Bluetooth | Verify `dtoverlay=disable-bt` in `/boot/config.txt`. Reboot. |
| Sensor returns garbage / no readable text | Baud rate mismatch or wrong driver | Default LD1125H baud is 115200. Confirm you're using the ASCII parser driver, not the LD2412 binary parser. |
| LD1125H detection range less than expected | Default range/sensitivity too conservative | Send config commands via UART: `rmax=12` (12m max), then tune `mth*_mov` / `mth*_occ` thresholds, then `save`. |
| LD1125H reports false positives outdoors | Wind, leaves, or reflections from court fence | Increase the `mth*_mov` (moving) threshold values to be less sensitive. |
| Battery drains overnight | System power draw exceeds expectation | Measure actual current with multimeter in series. Implement duty cycling. Consider 2x 18650 in parallel. |
| TP4056 not charging from Reolink panel | USB cable issue or insufficient sunlight | Check USB cable continuity with multimeter (5V on red, GND on black). Verify panel output voltage under load. Ensure red/black wires are correct (not data wires). |
| TP4056 charge LED flickers | Marginal input voltage from panel | Shorten USB cable run. Ensure good solder joints. In low light, the panel may not output enough current. |
| Condensation inside enclosure | Cable gland leak or depleted desiccant | Re-seal glands with silicone. Replace desiccant packs. |
| UART data corruption | Signal degradation on cable run | Reduce baud rate to 57600. Verify shield grounding at RPi end only. Cable run should be under 10m. |
| RPi freezes randomly | Undervoltage (5V dipping below 4.63V) | Check boost output under load. May need a larger/better boost converter (e.g., Pololu U3V70F5). Check 18650 charge level. |

## Appendix C: Maintenance Schedule

| Interval | Task |
|----------|------|
| Monthly | Check system is online and reporting data (remote check) |
| Quarterly | Visually inspect enclosure, cables, and sensor housings for damage |
| Quarterly | Check desiccant packs; replace if saturated |
| Biannually | Clean solar panel surface (dust, bird droppings) |
| Annually | Check battery health (measure capacity or voltage recovery after full charge/discharge cycle) |
| Annually | Check all cable gland seals and reapply silicone if degraded |
| 2-3 years | Replace 18650 battery (degradation reduces capacity below 70%) |
| 3-5 years | Replace desiccant packs proactively; inspect for corrosion on PCBs |
