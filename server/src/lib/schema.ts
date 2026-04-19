import { sql } from "drizzle-orm";
import {
  pgPolicy,
  pgTable,
  integer,
  text,
  timestamp,
  jsonb,
  unique,
  index,
  doublePrecision,
  pgEnum,
} from "drizzle-orm/pg-core";

/**
 * NOTE:
 * - Internal IDs are now auto-increment integers (`serial`) for core entities.
 * - External API-facing identifiers should use `public_id`.
 * - These tables are declared with .enableRLS() so Drizzle tracks RLS state.
 * - Policies are declared via pgPolicy(...) in the table extra config.
 */

export const courtStatusEnum = pgEnum("court_status", [
  "unknown",
  "occupied",
  "available",
]);

export const locations = pgTable(
  "locations",
  {
    id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
    publicId: text("public_id").notNull().unique(),
    name: text("name").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => ({
    locationsSelectAuthenticated: pgPolicy("locations_select_authenticated", {
      for: "select",
      to: "authenticated",
      using: sql`true`,
    }),
    locationsInsertAdmin: pgPolicy("locations_insert_admin", {
      for: "insert",
      to: "authenticated",
      withCheck: sql`EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
      )`,
    }),
    locationsUpdateAdmin: pgPolicy("locations_update_admin", {
      for: "update",
      to: "authenticated",
      using: sql`EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
      )`,
    }),
    locationsDeleteAdmin: pgPolicy("locations_delete_admin", {
      for: "delete",
      to: "authenticated",
      using: sql`EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
      )`,
    }),
  }),
).enableRLS();

export const courts = pgTable(
  "courts",
  {
    id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
    publicId: text("public_id").notNull().unique(),
    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    number: integer("number").notNull(),
    status: courtStatusEnum("status").notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    locationNumberUnique: unique("courts_location_id_number_key").on(
      table.locationId,
      table.number,
    ),
    courtsSelectAuthenticated: pgPolicy("courts_select_authenticated", {
      for: "select",
      to: "authenticated",
      using: sql`true`,
    }),
    courtsInsertAdmin: pgPolicy("courts_insert_admin", {
      for: "insert",
      to: "authenticated",
      withCheck: sql`EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
      )`,
    }),
    courtsUpdateAdmin: pgPolicy("courts_update_admin", {
      for: "update",
      to: "authenticated",
      using: sql`EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
      )`,
    }),
  }),
).enableRLS();

export const sensors = pgTable(
  "sensors",
  {
    id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
    publicId: text("public_id").notNull().unique(),
    courtId: integer("court_id").references(() => courts.id, { onDelete: "set null" }),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  () => ({
    sensorsSelectAuthenticated: pgPolicy("sensors_select_authenticated", {
      for: "select",
      to: "authenticated",
      using: sql`true`,
    }),
    sensorsUpdateAdmin: pgPolicy("sensors_update_admin", {
      for: "update",
      to: "authenticated",
      using: sql`EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
      )`,
    }),
  }),
).enableRLS();

export const events = pgTable(
  "events",
  {
    id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
    eventName: text("event_name").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    sensorId: integer("sensor_id")
      .notNull()
      .references(() => sensors.id, { onDelete: "cascade" }),
    courtId: integer("court_id")
      .notNull()
      .references(() => courts.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventsCourtTsIdx: index("idx_events_court_ts").on(table.courtId, table.timestamp),
    eventsSensorTsIdx: index("idx_events_sensor_ts").on(table.sensorId, table.timestamp),
    eventsSelectAuthenticated: pgPolicy("events_select_authenticated", {
      for: "select",
      to: "authenticated",
      using: sql`true`,
    }),
  }),
).enableRLS();

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;

export type Court = typeof courts.$inferSelect;
export type NewCourt = typeof courts.$inferInsert;

export type Sensor = typeof sensors.$inferSelect;
export type NewSensor = typeof sensors.$inferInsert;

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
