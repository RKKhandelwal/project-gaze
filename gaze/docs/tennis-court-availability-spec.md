# Tennis Court Availability System — Project Specification

## 1. Overview

A real-time tennis court availability system that uses radar sensors installed at individual courts to detect whether each court is occupied or unoccupied. Users interact with the system through a mobile app to search locations, view court status, and browse occupancy history.

---

## 2. Architecture

The system is composed of five major components:

| Component | Technology |
|-----------|------------|
| **Mobile App** (front-end) | SwiftUI (native iOS) |
| **Server** (back-end) | Python + FastAPI (sensor ingestion + occupancy detection) |
| **Database + Auth + Realtime** | Supabase (hosted PostgreSQL, free tier) |
| **Data Pool** | v1: events stored in Supabase. v2: Cloudflare R2 (10GB free) for raw radar archival |
| **Sensors** | HLK-LD1125H 24GHz mmWave radar on Raspberry Pi Zero 2W |

---

## 3. Data Model

### 3.1 Locations

Represents a physical site containing one or more courts (e.g., "Los Altos High School").

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID / PK | Auto-generated |
| `name` | string | Human-readable location name |
| `latitude` | float | GPS latitude |
| `longitude` | float | GPS longitude |

### 3.2 Courts

Each court belongs to exactly one location.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID / PK | Auto-generated |
| `location_id` | FK → Locations | Parent location |
| `name` | string | e.g., "Main Court" |
| `number` | integer | Court number at that location |

**Constraints:**

- `UNIQUE (location_id, number)` — no two courts at the same location may share a number.

### 3.3 Sensors

Each sensor is physically installed at a court and registered to it by an admin.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID / PK | Internal identifier |
| `external_id` | string | Manufacturer or hardware identifier |
| `court_id` | FK → Courts / nullable | Assigned by an admin after registration |

**Lifecycle:**

1. A sensor comes online and registers itself with the server → a row is created in the `sensors` table with `court_id = NULL`.
2. An admin hits an API endpoint to associate the sensor with a specific court.

### 3.4 Users

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID / PK | Auto-generated |
| `email` | string | Unique |
| `password_hash` | string | Encrypted / hashed password |
| `role` | enum | `user` or `admin` |

### 3.5 User Favorite Locations

A join table allowing users to favorite specific locations.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID / PK | Auto-generated |
| `user_id` | FK → Users | |
| `location_id` | FK → Locations | |

**Constraints:**

- `UNIQUE (user_id, location_id)`

### 3.6 Events

Stores occupancy state-change events emitted by the server's processing pipeline.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID / PK | Auto-generated |
| `event_name` | string | e.g., `court_occupied`, `court_unoccupied` |
| `timestamp` | datetime | When the event was determined |
| `sensor_id` | FK → Sensors | Source sensor |
| `court_id` | FK → Courts | Affected court |
| `payload` | JSON | Flexible field for additional event data |

---

## 4. Sensor Data Pipeline

### 4.1 Ingestion

- Each sensor streams radar data to the server at a rate of **1 reading per second**.
- The server persists all raw radar data to the **data pool (S3)** for storage and future analysis.

### 4.2 Occupancy Detection Logic

The server applies the following heuristic to the incoming radar stream for each court:

| Condition | Resulting Event |
|-----------|-----------------|
| Radar readings show **minimal change** (within noise threshold) over a **5-minute window** and the court is currently marked as occupied | Emit `court_unoccupied` event |
| Radar readings show **sufficient activity** within a **1-minute window** and the court is currently marked as unoccupied | Emit `court_occupied` event |

- Events are written to the `events` table in the database.
- The current court status can be derived from the most recent event for that court.

### 4.3 Mock Data Source

For initial development and testing, the system includes a `mock_data.py` CLI script that seeds the database with realistic historical occupancy patterns (configurable duration, per-court variation, daylight-weighted probability curves). The script targets the same database as the production server so the processing pipeline and mobile app can be exercised without live sensors.

The server is designed so the data source is interchangeable — both real sensors and mock sources feed the same processing pipeline.

---

## 5. Mobile App

The primary user interface is a **native iOS app built with SwiftUI**. It communicates directly with the Supabase backend (Auth, Database, Realtime) using the [Supabase Swift SDK](https://github.com/supabase/supabase-swift) via Swift Package Manager.

For development and personal testing, the app is side-loaded to the developer's iPhone via Xcode (free, no Apple Developer Program membership required). App Store distribution requires a $99/year membership (deferred to post-MVP).

### 5.1 Authentication

- Users sign up and log in with email and password via **Supabase Auth**.
- Passwords are hashed and managed by Supabase (never stored in the app or custom server).

### 5.2 User Roles

| Role | Capabilities |
|------|-------------|
| **User** | Search locations, favorite locations, view courts and status, view court history |
| **Admin** | All user capabilities, plus: associate sensors with courts, associate courts with locations, manage sensor registrations |

### 5.3 User Flow

1. **Log in** → lands on a home / search screen.
2. **Search locations** → type-ahead or list-based search for locations (e.g., "Los Altos High School").
3. **Favorite a location** → star/heart a location to pin it for quick access.
4. **Select a location** → view the list of courts at that location.
5. **View court status** → each court shows one of three states:

   | Status | Meaning |
   |--------|---------|
   | **Available** | Sensor is active and the court is unoccupied |
   | **Unavailable** | Sensor is active and the court is occupied |
   | **No Sensor** | No sensor is associated with this court |

6. **View court history** → tap into a court to see a timeline of occupancy events (`occupied` ↔ `unoccupied`) over a user-selected time range.

---

## 6. API Endpoints (High-Level)

### Public (authenticated users)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/signup` | Create a new user account |
| POST | `/auth/login` | Authenticate and receive a token |
| GET | `/locations` | Search / list locations |
| GET | `/locations/:id/courts` | List courts for a location with current status |
| GET | `/courts/:id/history` | Get occupancy event history for a court (with time range params) |
| POST | `/favorites` | Favorite a location |
| DELETE | `/favorites/:location_id` | Remove a favorite |
| GET | `/favorites` | List the current user's favorited locations |

### Admin-only

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/admin/locations` | Create a new location |
| POST | `/admin/courts` | Create a new court at a location |
| PUT | `/admin/sensors/:id/court` | Associate a sensor with a court |
| GET | `/admin/sensors` | List all registered sensors |

### Sensor (machine-to-machine)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/sensors/register` | Sensor self-registers on boot |
| WS / POST | `/sensors/:id/data` | Stream or push radar readings |

---

## 7. Infrastructure & Storage Summary

| Layer | Purpose | Technology | Cost |
|-------|---------|------------|------|
| Relational DB | Locations, courts, sensors, users, favorites, events | Supabase (PostgreSQL, free tier: 500MB) | $0 |
| Auth | User signup/login, JWT tokens, role-based access | Supabase Auth (included) | $0 |
| Realtime | Push court status changes to mobile clients | Supabase Realtime (included) | $0 |
| Data Pool | Raw radar readings (v2, append-only) | Cloudflare R2 (free tier: 10GB) | $0 |
| Server | Sensor data ingestion, occupancy detection pipeline | Python + FastAPI on Fly.io (free tier: 3 VMs) | $0 |
| Mobile App | User-facing interface | SwiftUI (Xcode, free) | $0 |
| **Total** | | | **$0/month** |

---

## 8. Resolved Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Server language** | **Python + FastAPI** | Already built, async, great ecosystem. Handles sensor ingestion and occupancy detection. |
| **Database** | **Supabase** (PostgreSQL) | Relational schema fits perfectly. Free tier (500MB DB, 50k MAU) is ample. Includes Auth + Realtime at no extra cost. |
| **Mobile framework** | **SwiftUI** (native iOS) | Free to develop (Xcode). Side-load for testing without Apple Developer account. iOS-only for v1; $99/year for App Store distribution later. |
| **Radar noise threshold** | **Defer** | Current code uses 5-min debounce timeout (spec says "5-min quiet → unoccupied"). Close enough. Calibrate with real LD1125H sensor data after hardware is wired. |
| **Mock data** | **`mock_data.py` CLI seeder** | Seeds 28 days of realistic daylight-weighted patterns directly into the database. Google Maps API dropped — it doesn't provide court occupancy data. |
| **Real-time push** | **Supabase Realtime** | Broadcasts PostgreSQL row changes via WebSocket. When a `court_occupied` event is written, all connected iOS clients see it instantly. Zero additional infrastructure. |
| **Raw data retention** | **Skip for v1** | Events table stores state changes only (~small). Raw 1Hz radar data archival deferred to v2 (Cloudflare R2, 10GB free). |
