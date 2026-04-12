# Project Gaze — Requirements

**Author:** Rui
**Last updated:** 2026-04-11

This document tracks what Project Gaze must, should, and could do. Requirements are grouped by priority using a MoSCoW-style structure. Each item should be concrete enough to verify — if you can't test whether it's met, it's not a requirement yet.

---

## MUST (Super Critical)

These are the non-negotiables. If any of these fail, the project fails.

1. **Player presence detection.** The sensor detects whether one or more players are present on the court and reports that state to the server. Success criterion (draft, refine after bench testing): the system correctly reports "occupied" in ≥95% of normal play conditions.

2. **Removable, repeatable mount.** The enclosure can be detached from the fence by hand (no drill or torque wrench) for tinkering and adjustments, AND when reattached it returns to the same aim angle within a small tolerance. A bracket-and-dovetail or bracket-with-alignment-pin design is the intended pattern.

3. **Long-term aim stability.** Once mounted, the sensor stays aimed down the length of the court without drift. Target: no visible aim drift over at least one season of outdoor deployment.

4. **Data freshness.** The state shown on the dashboard reflects reality within 5 minutes. (Driven by the sensor's 5-minute debounce timeout — stale "occupied" states are acceptable, but the system must not report "available" while players are actively on the court.)

5. **Graceful offline behavior.** When WiFi or power drops temporarily, the sensor buffers readings locally (SQLite) and resyncs to the server when connectivity returns. No silent data loss.

---

## SHOULD (Critical)

Important but not project-breaking if one slips.

1. **WiFi + remote access.** The sensor is WiFi-connected and its data is accessible remotely via the Gaze server (not just on the local network).

2. **Public dashboard.** The server displays court status in a human-readable form that non-technical users can understand at a glance. "Public" in this document means "readable without authentication by anyone on the internet" — if this changes, add auth and rate-limiting requirements.

3. **Survives California outdoor conditions.** The enclosure and electronics survive:
    - UV exposure (intense in CA summers)
    - Temperature range: -5°C to +45°C
    - Winter rain (IP65 or better)
    - Wildfire smoke and PM2.5 infiltration
    - Coastal salt air (only if deployed coastally)

4. **Off-grid power.** The system runs on solar + battery with no grid dependency. Target: indefinite runtime in sunny conditions, at least 2 days of operation through overcast weather.

5. **Multi-court scalable.** The system can be deployed to multiple courts (initial target: 5) without per-court code changes. Each node identifies itself via a config file.

---

## COULD (Nice to have)

Desirable but skippable for v1.

1. **Fall / impact resistance.** Enclosure and mounting hardware survive accidental knocks and falls without damage.

2. **Lightweight.** Total per-court assembly under ~1 kg so a single person can install it without tools.

3. **Remote diagnostics.** SSH access for field troubleshooting without a site visit. Remote log tailing via `journalctl`.

4. **Tamper resistance.** Mounting hardware resists casual theft and vandalism (security screws, locked enclosure, cable-tie backup).

5. **Auto-recovery.** Systemd watchdog restarts the service if it hangs. Already handled by `gaze-sensor.service` (`WatchdogSec=120`).

---

## Out of Scope (Won't, for now)

Called out explicitly so they're not accidentally worked on:

- **Player identification or tracking.** The system reports "is anyone there" — not "who" or "how many."
- **Ball tracking.** Budget mmWave sensors cannot reliably detect tennis balls, and it's not needed for occupancy.
- **Score keeping.** No game-state awareness.
- **Reservation / booking system.** Display-only, not an interactive booking platform.

---

## Open Questions

Things to resolve before they become blockers:

1. **Exact deployment site.** Needed to finalize environmental requirements (coastal vs. inland, typical temperature range, wildfire risk).
2. **"Public" scope.** Is the dashboard public-internet readable, or gated behind a club/org login? Drives all security decisions.
3. **Maintenance interval.** How often are you willing to visit each sensor? Drives battery sizing, SD card endurance strategy, and desiccant choice.
4. **False-positive / false-negative tolerance.** What percentage of wrong readings is acceptable? Drives sensor threshold tuning.

---

## Change Log

- **2026-04-11**: Initial requirements doc created. Converted from an earlier bullet list into tiered MUST/SHOULD/COULD format, tightened vague items, added missing requirements (data freshness, offline behavior, multi-court scalability), and surfaced the mount-detachability vs. aim-stability tension as an explicit design constraint.
