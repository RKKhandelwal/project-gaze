-- =============================================================================
-- Project Gaze — Supabase Database Schema
--
-- Run this in the Supabase SQL Editor (https://app.supabase.com → your project
-- → SQL Editor → New query → paste → Run).
--
-- Creates all tables from the tennis-court-availability-spec.md data model,
-- sets up Row Level Security (RLS) policies for user/admin separation, and
-- enables Realtime on the events table so the iOS app receives live pushes.
--
-- Prerequisites:
--   - A Supabase project (free tier is fine)
--   - Supabase Auth enabled (it is by default)
-- =============================================================================


-- =============================================================================
-- 1. PROFILES (extends Supabase Auth) — MUST be created first because every
--    admin RLS policy on other tables references this table.
-- =============================================================================
-- Supabase Auth manages the actual user accounts (email, password hash, JWT).
-- This table adds the `role` field referenced by RLS policies.

CREATE TABLE IF NOT EXISTS profiles (
    id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role    TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile.
CREATE POLICY "profiles_select_own"
    ON profiles FOR SELECT
    TO authenticated
    USING (id = auth.uid());

-- Admins can read all profiles.
CREATE POLICY "profiles_select_admin"
    ON profiles FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND p.role = 'admin'
        )
    );

-- Auto-create a profile row when a new user signs up.
-- This trigger fires on auth.users INSERT.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, role)
    VALUES (NEW.id, 'user');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if it already exists (idempotent).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- 2. LOCATIONS
-- =============================================================================
-- A physical site containing one or more courts (e.g., "Los Altos High School").

CREATE TABLE IF NOT EXISTS locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read locations.
CREATE POLICY "locations_select_authenticated"
    ON locations FOR SELECT
    TO authenticated
    USING (true);

-- Only admins can insert/update/delete locations.
CREATE POLICY "locations_insert_admin"
    ON locations FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'admin'
        )
    );

CREATE POLICY "locations_update_admin"
    ON locations FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'admin'
        )
    );

CREATE POLICY "locations_delete_admin"
    ON locations FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'admin'
        )
    );


-- =============================================================================
-- 3. COURTS
-- =============================================================================
-- Each court belongs to exactly one location.

CREATE TABLE IF NOT EXISTS courts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    number      INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (location_id, number)
);

ALTER TABLE courts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "courts_select_authenticated"
    ON courts FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "courts_insert_admin"
    ON courts FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'admin'
        )
    );

CREATE POLICY "courts_update_admin"
    ON courts FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'admin'
        )
    );


-- =============================================================================
-- 4. SENSORS
-- =============================================================================
-- Each sensor is physically installed at a court. It self-registers on boot
-- (court_id = NULL) and an admin assigns it to a court afterwards.

CREATE TABLE IF NOT EXISTS sensors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT NOT NULL UNIQUE,       -- hardware/manufacturer identifier
    court_id    UUID REFERENCES courts(id) ON DELETE SET NULL,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ                -- updated on each data push
);

ALTER TABLE sensors ENABLE ROW LEVEL SECURITY;

-- Authenticated users can see sensors (needed to show "No Sensor" status).
CREATE POLICY "sensors_select_authenticated"
    ON sensors FOR SELECT
    TO authenticated
    USING (true);

-- The server (service_role key) handles sensor registration — no user-facing
-- insert policy. Admins can update the court assignment.
CREATE POLICY "sensors_update_admin"
    ON sensors FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'admin'
        )
    );

-- Allow the server's service_role to insert sensors (self-registration).
-- The service_role key bypasses RLS by default, so no explicit policy is
-- needed — just don't use the anon key for sensor registration.


-- =============================================================================
-- 5. USER FAVORITE LOCATIONS
-- =============================================================================
-- Join table allowing users to favorite specific locations for quick access.

CREATE TABLE IF NOT EXISTS user_favorite_locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (user_id, location_id)
);

ALTER TABLE user_favorite_locations ENABLE ROW LEVEL SECURITY;

-- Users can only see/manage their own favorites.
CREATE POLICY "favorites_select_own"
    ON user_favorite_locations FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "favorites_insert_own"
    ON user_favorite_locations FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "favorites_delete_own"
    ON user_favorite_locations FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());


-- =============================================================================
-- 6. EVENTS
-- =============================================================================
-- Stores occupancy state-change events emitted by the server's processing
-- pipeline. The current court status is derived from the most recent event.

CREATE TABLE IF NOT EXISTS events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name  TEXT NOT NULL CHECK (event_name IN ('court_occupied', 'court_unoccupied')),
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
    sensor_id   UUID NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    court_id    UUID NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups: "most recent event per court" and time-range queries.
CREATE INDEX IF NOT EXISTS idx_events_court_ts
    ON events (court_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_events_sensor_ts
    ON events (sensor_id, timestamp DESC);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read events (needed for history views).
CREATE POLICY "events_select_authenticated"
    ON events FOR SELECT
    TO authenticated
    USING (true);

-- Only the server (service_role) inserts events. No user-facing insert policy.
-- The service_role key bypasses RLS by default.


-- =============================================================================
-- 7. ENABLE REALTIME
-- =============================================================================
-- Supabase Realtime broadcasts row changes on enabled tables. The iOS app
-- subscribes to the events table to get instant court status updates.

ALTER PUBLICATION supabase_realtime ADD TABLE events;


-- =============================================================================
-- 8. SEED DATA (optional — run once for development)
-- =============================================================================
-- Uncomment and run manually to seed a default location with 8 courts.

-- INSERT INTO locations (name, latitude, longitude)
-- VALUES ('Los Altos High School', 37.3782, -122.1180)
-- ON CONFLICT DO NOTHING;
--
-- DO $$
-- DECLARE
--     loc_id UUID;
-- BEGIN
--     SELECT id INTO loc_id FROM locations WHERE name = 'Los Altos High School';
--     FOR i IN 1..8 LOOP
--         INSERT INTO courts (location_id, name, number)
--         VALUES (loc_id, 'Court ' || i, i)
--         ON CONFLICT (location_id, number) DO NOTHING;
--     END LOOP;
-- END $$;
