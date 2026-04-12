# Project Gaze - Shopping List

Complete bill of materials for the tennis court availability monitoring system.

> **Design: 1 sensor per court**, mounted behind the baseline (short side of the court), looking down the court like a server's perspective. Presence detection only — no need for pinpoint accuracy. Single HLK-LD1125H mmWave sensor (~12-16m range, covers most of the playing area) connected via RPi native UART0.

---

## 0. Rui's Current Inventory

Items already purchased. Check the **Status** column in Section 1 to see what's covered.

| Item | Details | Qty |
|------|---------|-----|
| Raspberry Pi Zero 2 W | Basic kit with header, heatsink, USB cable, HDMI adapter | 1 |
| 16GB MicroSD Cards | Class 10, A1, with adapters | 2 |
| CBJJ 18650 Batteries | 3.7V "9900mAh" button top (real capacity ~2500mAh) | 8 |
| 18650 Battery Holders | Single cell with wires | 10 |
| HiLetgo TP4056 Type-C Modules | Dual protection (DW01), 3-pack | 3 |
| Reolink 6W Solar Panel | IP65, USB 5V output, waterproof, adjustable mount | 1 |
| Sunnyglade IP65 ABS Enclosure | 100x150x71mm (3.9"x5.9"x2.8") | 1 |
| Breadboards + Jumper Wires | 4x 830-point, 1x 400-point, 126 flexible wires | 1 set |
| Amazon Basics 10,000mAh Power Bank | USB, LED display | 1 |

**Returned:** Benewake TF-Luna LiDAR (wrong sensor type for this use case)
**Not suitable for project:** Amazon Basics power bank (auto-shutoff at low current draw; keep as personal charger)

---

## 1. Per-Court Unit

Everything needed to build one sensor node.

| # | Item | Specs / Model | Qty | Est. Price (USD) | Status | Source |
|---|------|---------------|-----|-------------------|--------|--------|
| 1 | Raspberry Pi Zero 2 W | RPi Zero 2 W (RP3A0-AU, 512MB, Wi-Fi/BT) | 1 | $15.00 | **HAVE** | RPi approved resellers, Adafruit, Vilros |
| 2 | Micro SD Card | 16GB+ Class 10 / A1 | 1 | $5.00 | **HAVE (2x)** | Amazon |
| 3 | HLK-LD1125H mmWave Sensor | 24GHz presence/motion, UART ASCII output, ~12-16m range for humans | 1 | $12.00 | **NEED** | AliExpress (Hi-Link official store) |
| 4 | Solar Panel | Reolink 6W, IP65, USB 5V output, adjustable mount | 1 | $20.00 | **HAVE** | Amazon (Reolink official) |
| 5 | 18650 Battery + Holder | 3.7V Li-ion cell (button top) + single-cell holder with wires | 1 | $3.00 | **HAVE (8 cells, 10 holders)** | Amazon / AliExpress |
| 6 | Solar Charge Controller | HiLetgo TP4056 Type-C with DW01 dual protection | 1 | $2.50 | **HAVE (3x)** | Amazon / AliExpress |
| 7 | 5V Boost Converter | MT3608 or SX1308 step-up module, 3.7V in / 5V 2A out | 1 | $1.50 | **NEED** | AliExpress / Amazon |
| 8 | Main Enclosure | IP65 ABS junction box, ~100x150x71mm | 1 | $10.00 | **HAVE** | Amazon |
| 9 | Sensor Enclosure | IP65 ABS box, ~60x40x25mm or 3D-printed radome | 1 | $3.00 | NEED | AliExpress / 3D print |
| 10 | Cable Glands | PG7 nylon cable glands (3-6.5mm), IP68 | 3 | $2.00 (from pack) | NEED | AliExpress (bag of 20) |
| 11 | Dupont Jumper Wires | Female-to-female, 20cm | 1 pack | $2.00 | **HAVE** | AliExpress / Amazon |
| 12 | Signal Wire | 26 AWG 4-conductor shielded cable, ~10m | 1 | $4.00 | NEED | AliExpress / Amazon |
| 13 | Power Wire | 22 AWG stranded, silicone insulated, red+black, ~2m | 1 | $2.50 | NEED | AliExpress / Amazon |
| 14 | USB Cable (sacrificial) | Any USB-A cable — cut to expose 5V/GND for Reolink→TP4056 | 1 | $1.00 | HAVE (any spare) | -- |
| 15 | Silicone Sealant | Clear RTV silicone, outdoor/waterproof, small tube | 1 | $5.00 | NEED | Amazon / hardware store |
| 16 | Desiccant Packs | 1g silica gel sachets (reusable indicator type) | 3 | $0.50 (from bulk pack) | NEED | AliExpress (bag of 50+) |
| 17 | Mounting Hardware | Stainless screws, zip ties (UV-resistant), cable clips | 1 set | $5.00 | NEED | Amazon / hardware store |
| 18 | Mounting Screws & Standoffs | M2.5 + M3 stainless steel screws, nuts, nylon standoffs | 1 set | $2.00 | NEED | AliExpress / Amazon |

### Per-Unit Total: ~$95
### Remaining to Buy (prototype): ~$38 (items marked NEED)

---

## 2. One-Time Tools & Supplies

Items purchased once for assembly, testing, and maintenance.

| Item | Specs / Model | Est. Price (USD) | Source |
|------|---------------|-------------------|--------|
| Soldering Iron Station | Pinecil V2 or FNIRSI HS-01 (USB-C PD, portable) | $30-50 | Amazon / AliExpress |
| Solder | 63/37 tin-lead, 0.8mm rosin core, 100g spool | $6.00 | Amazon |
| Solder Wick / Desoldering Pump | 2.5mm copper braid + manual pump | $5.00 | Amazon |
| Heat Shrink Tubing | Assorted kit, 2:1 ratio, 1-10mm diameters | $6.00 | Amazon |
| Wire Stripper / Crimper | Self-adjusting, for 10-24 AWG | $12.00 | Amazon |
| Digital Multimeter | Aneng AN8008 or UNI-T UT61E (auto-ranging) | $15-30 | Amazon / AliExpress |
| USB Power Meter | Type-A inline (Fnirsi FNB48 or similar), for power profiling | $12.00 | Amazon / AliExpress |
| Hot Glue Gun | Mini, for securing connectors inside enclosure | $8.00 | Amazon |
| Flush Cutters | Hakko CHP-170 or equivalent | $5.00 | Amazon |
| Label Maker | Brother P-Touch PTH110 (for cable/unit labeling) | $25.00 | Amazon |
| Step Drill Bit | 4-20mm, for drilling enclosure holes for cable glands | $8.00 | Amazon |
| JST Connector Kit | JST-PH 2.0mm, 2-pin and 4-pin with crimps | $8.00 | AliExpress / Amazon |
| Helping Hands / PCB Holder | Third-hand tool with magnifier | $10.00 | Amazon |

### One-Time Tools Total: ~$150-180

---

## 3. Five-Court Deployment Cost Estimate

| Category | 1 Unit | 5 Units | 5 Units (Bulk) | Notes |
|----------|--------|---------|----------------|-------|
| Raspberry Pi Zero 2 W | $15 | $75 | $75 | Rarely discounted; buy from authorized resellers |
| Micro SD Cards | $5 | $25 | $20 | 5-packs available on Amazon |
| HLK-LD1125H Sensors (x1 each) | $12 | $60 | $48 | Buy 5+ from AliExpress for ~$9.50/ea |
| Solar Panels (Reolink 6W) | $20 | $100 | $80 | Multi-packs or alternative 6V panels for remaining 4 |
| 18650 Batteries + Holders | $3 | $15 | $12 | Already have 8 cells + 10 holders |
| TP4056 Charge Controllers | $2.50 | $12.50 | $8 | Already have 3; buy 2 more |
| Boost Converters | $1.50 | $7.50 | $5 | Packs of 10 on AliExpress ~$1/ea |
| Main Enclosures | $10 | $50 | $40 | Already have 1; buy 4 more |
| Sensor Enclosures (x1 each) | $3 | $15 | $10 | AliExpress bulk or 3D print |
| Cable Glands, Wire, Misc | $10 | $50 | $30 | Buy in bulk rolls/bags |
| Mounting Hardware | $5 | $25 | $18 | Hardware store or bulk Amazon |
| Silicone Sealant | $5 | $5 | $5 | One tube covers all 5 units |
| Desiccant | $0.50 | $2.50 | $2.50 | One bulk bag |

| | Est. Total |
|---|---|
| **5 units at individual prices** | ~$478 |
| **5 units with bulk savings** | ~$355 |
| **+ One-time tools & supplies** | ~$170 |
| **Grand total (first deployment)** | **~$525** |
| **Cost per court (amortized with tools)** | **~$105** |
| **Cost per court (hardware only, bulk)** | **~$71** |

> **Vs. original 2-sensor LD2412 design:** still ~$65 cheaper for 5 courts (saved on second sensors and CP2102 adapters), while gaining 2-3x the detection range per court with the LD1125H.

---

## 4. Recommended Purchase Order

### Phase 1 -- Prototype (1 unit)

Goal: get a single working node on a bench, then field-test. Rui already has most components.

| Priority | Items | Est. Cost | Status | Where |
|----------|-------|-----------|--------|-------|
| 1 | **HLK-LD1125H mmWave sensor (1x)** | $12.00 | **ORDER NOW** | AliExpress (2-3 week lead time) |
| 2 | **MT3608 boost converter (1x)** | $1.50 | **ORDER NOW** | AliExpress / Amazon |
| 3 | Sensor enclosure, cable glands, desiccant | $5.50 | NEED | AliExpress or Amazon |
| 4 | Signal wire (26AWG shielded, 10m), power wire (22AWG), silicone sealant | $11.50 | NEED | AliExpress / Amazon / hardware store |
| 5 | Mounting hardware (standoffs, screws, zip ties, cable clips) | $7.00 | NEED | Amazon / hardware store |
| 6 | Soldering iron, solder, multimeter, wire stripper (if you don't have these) | $70 | CHECK | Amazon |

**Already have:** RPi Zero 2W, SD cards, 18650 batteries + holders, TP4056 chargers, Reolink solar panel, enclosure, jumper wires.

**Phase 1 remaining cost: ~$38** (hardware only, no tools)
**Phase 1 with tools: ~$108** (if tools are needed)

**Order the HLK-LD1125H from AliExpress immediately** — it's the longest lead-time item (2-3 weeks). Everything else can be bought from Amazon when the sensor arrives.

### Phase 2 -- Full Rollout (remaining 4 units)

After the prototype is validated and software is stable:

| Priority | Items | Est. Cost | Where |
|----------|-------|-----------|-------|
| 1 | 4x Raspberry Pi Zero 2 W | $60 | Authorized resellers (check rpilocator.com for stock) |
| 2 | 4x HLK-LD1125H sensors (+ 1-2 spares) | $55 | AliExpress |
| 3 | 4x Solar panels, 4x boost converters | $70 | AliExpress / Amazon |
| 4 | 4x Main enclosures, 4x sensor enclosures, cable glands, wire | $55 | AliExpress |
| 5 | 2x TP4056 modules (have 2 remaining from 3-pack) | $5 | AliExpress |
| 6 | 4x SD cards, mounting hardware, weatherproofing supplies | $30 | Amazon / hardware store |

**Phase 2 total: ~$275**

> **Note:** You already have enough 18650 batteries (7 remaining) and holders (9 remaining) for Phase 2.

---

## 5. Notes

### Sourcing Strategy

- **AliExpress** -- Best for bulk components (sensors, charge modules, enclosures, cable glands, wire). Prices are 40-60% lower than Amazon. Downside: 2-4 week shipping (use AliExpress Standard or Cainiao for tracking). Order from stores with 95%+ positive rating and 1000+ orders.
- **Amazon** -- Best for fast delivery, tools, and items where quality variance matters (SD cards, batteries from known brands). Use for Phase 1 prototyping when you want parts quickly.
- **Adafruit / SparkFun / Vilros** -- Best for Raspberry Pi boards. Use [rpilocator.com](https://rpilocator.com) to track RPi Zero 2 W stock. These boards have periodic shortages.
- **Local hardware store** -- Mounting hardware, stainless screws, silicone sealant, zip ties.

### Lead Times

| Source | Typical Lead Time |
|--------|-------------------|
| Amazon (Prime) | 1-2 days |
| Adafruit / SparkFun | 3-5 days |
| AliExpress Standard | 14-25 days |
| AliExpress (shipped from local warehouse) | 5-10 days |

### Key Alternatives

| Item | Primary (Current Build) | Alternative | Notes |
|------|-------------------------|-------------|-------|
| mmWave Sensor | Hi-Link LD1125H (~12-16m, ASCII protocol) | HLK-LD2412 / LD2410B (~6m, binary protocol) | LD1125H gives 2-3x range — necessary for tennis court coverage. LD2412 is cheaper but only covers near service box. LD2450 adds X/Y multi-target but only ~6m. |
| Charge Controller | TP4056 + DW01 | CN3791 MPPT module | CN3791 is better with raw 6V solar panels; TP4056 is fine with the Reolink's regulated 5V USB output |
| Boost Converter | MT3608 | Pololu U1V11F5 | Pololu is more efficient but 5x the cost; MT3608 is fine for this |
| RPi Zero 2 W | Raspberry Pi Zero 2 W | ESP32-S3 (if RPi unavailable) | Loses Linux but cuts power draw significantly; requires firmware rewrite |
| Solar Panel | Reolink 6W (USB 5V) | Generic 6V 10W mono panel | Generic panels are cheaper (~$8-14) and provide raw 6V for CN3791; but Reolink is IP65 with mount included |
| Battery | 18650 Li-ion in holder | 3.7V LiPo pouch cell (10Ah) | Pouch cells have higher capacity and flatter form factor, but 18650s are easily replaceable |

### Tips

- **18650 battery capacity**: Budget 18650 cells marketed as "9900mAh" typically have 1500-2500mAh real capacity. Plan runtime estimates conservatively (~2500mAh). Consider running 2 cells in parallel for longer runtime.
- **Battery safety**: The TP4056's DW01 protection IC handles overcharge, overdischarge, and short circuit. Avoid using bare 18650 cells without protection circuitry.
- **Reolink solar panel wiring**: Cut any USB-A cable to expose the 5V (red) and GND (black) wires. Tape off the data wires (green/white). Solder to the TP4056 IN+/GND pads.
- **Waterproofing**: Apply silicone sealant around all cable gland entries and enclosure seams. Use IP68-rated glands where possible. The desiccant packs inside the enclosure handle residual condensation.
- **Wire gauge matters**: Use 22 AWG for power connections (charge controller, battery, boost, RPi). Use 26 AWG shielded cable for the sensor UART signal line.
- **Test before sealing**: Fully bench-test each unit for 48+ hours before mounting and sealing enclosures. It is much harder to debug once everything is weatherproofed.
- **Spare parts**: Order 1-2 extra sensors and boost converter modules. They are cheap and having spares avoids project delays if one arrives DOA.
- **SD card endurance**: Enable log rotation and minimize writes in software. High-endurance cards (SanDisk Industrial, Samsung PRO Endurance) are ideal but your current Class 10 A1 cards will work for prototyping.
- **Dry-fit the enclosure**: The Sunnyglade 100x150x71mm box is smaller than the original design spec. Lay out all components on a 100x150mm rectangle before drilling any holes.
