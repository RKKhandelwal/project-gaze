#!/usr/bin/env node

/**
 * Project Gaze Admin CLI
 *
 * Supports:
 *  - register location
 *  - register court
 *  - register sensor
 *  - post sensor status
 *
 * Auth:
 *  - Admin endpoints require x-admin-api-key
 *  - Status endpoint can use x-api-key (sensor key), admin key, or JWT
 *
 * Usage examples:
 *
 *   node scripts/gaze-admin-cli.mjs register-location \
 *     --api http://localhost:3000 \
 *     --admin-key "$ADMIN_API_KEY" \
 *     --public-id loc-los-altos-high \
 *     --name "Los Altos High School" \
 *     --lat 37.3782 --lng -122.1180
 *
 *   node scripts/gaze-admin-cli.mjs register-court \
 *     --api http://localhost:3000 \
 *     --admin-key "$ADMIN_API_KEY" \
 *     --location-id loc-los-altos-high \
 *     --name "Court 1" \
 *     --number 1 \
 *     --public-id court-loc-los-altos-high-1
 *
 *   node scripts/gaze-admin-cli.mjs register-sensor \
 *     --api http://localhost:3000 \
 *     --admin-key "$ADMIN_API_KEY" \
 *     --public-id sensor-north-east-1 \
 *     --court-id court-loc-los-altos-high-1
 *
 *   node scripts/gaze-admin-cli.mjs sensor-status \
 *     --api http://localhost:3000 \
 *     --sensor-key "$SENSOR_API_KEY" \
 *     --sensor-id sensor-north-east-1 \
 *     --status occupied
 */

const HELP = `
Project Gaze Admin CLI

Commands:
  register-location   Create a location
  register-court      Create a court under a location
  register-sensor     Create a sensor and optionally assign to court
  sensor-status       Post sensor occupancy status

Global options:
  --api <url>         API base URL (default: http://localhost:3000)
  --json              Print compact JSON only

register-location options:
  --admin-key <key>   Admin API key (or env ADMIN_API_KEY)
  --public-id <id>    Location public_id
  --name <name>       Location display name
  --lat <number>      Latitude
  --lng <number>      Longitude

register-court options:
  --admin-key <key>   Admin API key (or env ADMIN_API_KEY)
  --location-id <id>  Location public_id
  --name <name>       Court display name
  --number <int>      Court number at location
  --public-id <id>    Optional court public_id

register-sensor options:
  --admin-key <key>   Admin API key (or env ADMIN_API_KEY)
  --public-id <id>    Sensor public_id
  --court-id <id>     Court public_id to assign (optional)
  --skip-assign       Only create sensor, don't assign to court

sensor-status options:
  --sensor-key <key>  Sensor API key (or env SENSOR_API_KEY)
  --admin-key <key>   Alternative auth (admin key)
  --jwt <token>       Alternative auth bearer JWT
  --sensor-id <id>    Sensor public_id
  --status <value>    occupied | available
  --timestamp <iso>   Optional ISO timestamp (default: now)
  --sensor-data <json> Optional JSON object string, e.g. '{"activity":0.92}'
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const [k, inline] = t.slice(2).split("=");
      if (inline !== undefined) {
        args[k] = inline;
      } else {
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
          args[k] = true;
        } else {
          args[k] = next;
          i++;
        }
      }
    } else {
      args._.push(t);
    }
  }
  return args;
}

function required(args, key, fallback) {
  const value = args[key] ?? fallback;
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`Missing required option: --${key}`);
  }
  return String(value);
}

function optional(args, key, fallback = undefined) {
  const value = args[key] ?? fallback;
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

function toNumber(value, key) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`--${key} must be a valid number`);
  }
  return n;
}

function toInt(value, key) {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`--${key} must be an integer`);
  }
  return n;
}

function nowIso() {
  return new Date().toISOString();
}

function headersForAuth({ adminKey, sensorKey, jwt }) {
  const h = { "Content-Type": "application/json", Accept: "application/json" };
  if (jwt) {
    h.Authorization = `Bearer ${jwt}`;
    return h;
  }
  if (adminKey) {
    h["x-admin-api-key"] = adminKey;
    return h;
  }
  if (sensorKey) {
    h["x-api-key"] = sensorKey;
    return h;
  }
  throw new Error("Missing auth. Provide --sensor-key, --admin-key, or --jwt.");
}

async function requestJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

function out(data, compact) {
  if (compact) {
    process.stdout.write(`${JSON.stringify(data)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  }
}

async function registerLocation(args) {
  const api = optional(args, "api", "http://localhost:3000");
  const adminKey = required(args, "admin-key", process.env.ADMIN_API_KEY);
  const publicId = required(args, "public-id");
  const name = required(args, "name");
  const lat = toNumber(required(args, "lat"), "lat");
  const lng = toNumber(required(args, "lng"), "lng");

  const payload = {
    public_id: publicId,
    name,
    latitude: lat,
    longitude: lng,
  };

  const { ok, status, body } = await requestJson(
    `${api}/api/admin/locations`,
    {
      method: "POST",
      headers: {
        "x-admin-api-key": adminKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  return { ok, status, request: payload, response: body };
}

async function registerCourt(args) {
  const api = optional(args, "api", "http://localhost:3000");
  const adminKey = required(args, "admin-key", process.env.ADMIN_API_KEY);
  const locationId = required(args, "location-id");
  const name = required(args, "name");
  const number = toInt(required(args, "number"), "number");
  const publicId = optional(args, "public-id");

  const payload = {
    location_id: locationId,
    name,
    number,
    ...(publicId ? { public_id: publicId } : {}),
  };

  const { ok, status, body } = await requestJson(
    `${api}/api/admin/courts`,
    {
      method: "POST",
      headers: {
        "x-admin-api-key": adminKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  return { ok, status, request: payload, response: body };
}

async function registerSensor(args) {
  const api = optional(args, "api", "http://localhost:3000");
  const adminKey = required(args, "admin-key", process.env.ADMIN_API_KEY);
  const sensorPublicId = required(args, "public-id");
  const courtId = optional(args, "court-id");
  const skipAssign = Boolean(args["skip-assign"]);

  // NOTE: current API set in repo has assign endpoint, but sensor-create endpoint
  // may vary by implementation. We use a best-practice pair:
  // 1) create sensor
  // 2) optionally assign to court
  const createPayload = { public_id: sensorPublicId };
  const createRes = await requestJson(`${api}/api/admin/sensors`, {
    method: "POST",
    headers: {
      "x-admin-api-key": adminKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(createPayload),
  });

  let assignRes = null;
  if (!skipAssign && courtId) {
    assignRes = await requestJson(
      `${api}/api/admin/sensors/${encodeURIComponent(sensorPublicId)}/court`,
      {
        method: "PUT",
        headers: {
          "x-admin-api-key": adminKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ court_id: courtId }),
      },
    );
  }

  const ok = createRes.ok && (assignRes ? assignRes.ok : true);
  return {
    ok,
    create: {
      status: createRes.status,
      request: createPayload,
      response: createRes.body,
    },
    assign: assignRes
      ? {
          status: assignRes.status,
          request: { court_id: courtId },
          response: assignRes.body,
        }
      : null,
  };
}

async function postSensorStatus(args) {
  const api = optional(args, "api", "http://localhost:3000");
  const sensorId = required(args, "sensor-id");
  const status = required(args, "status").toLowerCase();
  if (status !== "occupied" && status !== "available") {
    throw new Error('--status must be "occupied" or "available"');
  }

  const timestamp = optional(args, "timestamp", nowIso());
  const sensorDataRaw = optional(args, "sensor-data");
  let sensorData = {};
  if (sensorDataRaw) {
    try {
      sensorData = JSON.parse(sensorDataRaw);
    } catch {
      throw new Error("--sensor-data must be valid JSON object string");
    }
  }

  const authHeaders = headersForAuth({
    adminKey: optional(args, "admin-key", process.env.ADMIN_API_KEY),
    sensorKey: optional(args, "sensor-key", process.env.SENSOR_API_KEY),
    jwt: optional(args, "jwt"),
  });

  const payload = {
    sensor_id: sensorId,
    status,
    timestamp,
    sensor_data: sensorData,
  };

  const { ok, status: code, body } = await requestJson(
    `${api}/api/status`,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(payload),
    },
  );

  return { ok, status: code, request: payload, response: body };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const compact = Boolean(args.json);

  if (!command || command === "help" || command === "--help") {
    process.stdout.write(`${HELP}\n`);
    process.exit(0);
  }

  try {
    let result;
    if (command === "register-location") {
      result = await registerLocation(args);
    } else if (command === "register-court") {
      result = await registerCourt(args);
    } else if (command === "register-sensor") {
      result = await registerSensor(args);
    } else if (command === "sensor-status") {
      result = await postSensorStatus(args);
    } else {
      throw new Error(`Unknown command: ${command}`);
    }

    out(result, compact);
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    out(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      compact,
    );
    process.exit(1);
  }
}

main();
