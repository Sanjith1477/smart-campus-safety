const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const { initDatabase, run, all } = require("./db");
const { evaluateIncident } = require("./engines/incidentEngine");
const { dijkstra, GRAPH } = require("./engines/routeEngine");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const sensorNames = ["DHT", "MQ2", "PIR", "IR", "LDR", "FINGERPRINT"];

app.use(cors());
app.use(express.json());

let latestTelemetry = null;
let latestTelemetryIncident = null;
let latestTelemetryRoute = { route: [], totalCost: null };
let revision = 0;

function now() {
  return new Date().toISOString();
}

function listIncidents() {
  return all(`
    SELECT incidents.*, zones.name AS zone_name
    FROM incidents
    LEFT JOIN zones ON incidents.zone_id = zones.id
    ORDER BY incidents.id DESC
    LIMIT 100
  `);
}

function listAccessLogs() {
  return all(`
    SELECT access_logs.*, zones.name AS zone_name
    FROM access_logs
    LEFT JOIN zones ON access_logs.zone_id = zones.id
    ORDER BY access_logs.id DESC
    LIMIT 100
  `);
}

function listSensorHealth() {
  return all("SELECT sensor_id, status, last_heartbeat FROM sensor_health ORDER BY sensor_id");
}

function currentSnapshot() {
  const incidents = listIncidents();
  return {
    revision,
    telemetry: latestTelemetry,
    incident: latestTelemetryIncident,
    route: latestTelemetryRoute,
    zones: all("SELECT * FROM zones ORDER BY id"),
    incidents,
    activeIncidents: incidents.filter((incident) => incident.status === "ACTIVE"),
    accessLogs: listAccessLogs(),
    sensorHealth: listSensorHealth(),
    timestamp: latestTelemetry?.receivedAt || null
  };
}

function emitSystemUpdate(extra = {}) {
  revision += 1;
  const payload = { ...currentSnapshot(), ...extra, revision };
  io.emit("systemUpdate", payload);
  return payload;
}

function routeConditions() {
  const blockedZones = [];
  const penalizedZones = [];
  const penalties = {};

  for (const zone of all("SELECT name, status, crowd_level FROM zones ORDER BY id")) {
    const status = String(zone.status || "NORMAL").toUpperCase();
    const crowd = String(zone.crowd_level || "LOW").toUpperCase();

    if (
      status === "BLOCKED" ||
      status === "CRITICAL" ||
      crowd === "CRITICAL"
    ) {
      blockedZones.push(zone.name);
      continue;
    }

    let penalty = 0;
    const reasons = [];

    if (status === "HIGH") {
      penalty += 10;
      reasons.push("high severity");
    } else if (status === "WARNING") {
      penalty += 5;
      reasons.push("warning severity");
    }

    if (crowd === "HIGH") {
      penalty += 10;
      reasons.push("high crowd");
    } else if (crowd === "MEDIUM") {
      penalty += 4;
      reasons.push("medium crowd");
    }

    if (penalty > 0) {
      penalties[zone.name] = penalty;
      penalizedZones.push({ zone: zone.name, penalty, reasons });
    }
  }

  return { blockedZones, penalizedZones, penalties };
}

function storeSensorHealth(health, timestamp) {
  if (!health || typeof health !== "object" || Array.isArray(health)) return;

  for (const name of sensorNames) {
    const value = health[name.toLowerCase()];
    let isOnline;
    if (typeof value === "boolean") {
      isOnline = value;
    } else if (value === 1 || value === 0) {
      isOnline = value === 1;
    } else if (typeof value === "string" && ["ONLINE", "OFFLINE", "ON", "OFF"].includes(value.toUpperCase())) {
      isOnline = ["ONLINE", "ON"].includes(value.toUpperCase());
    } else {
      continue;
    }

    run(
      `INSERT INTO sensor_health (sensor_id, status, last_heartbeat)
       VALUES (?, ?, ?)
       ON CONFLICT(sensor_id) DO UPDATE SET
         status = excluded.status,
         last_heartbeat = excluded.last_heartbeat`,
      [name, isOnline ? "ONLINE" : "OFFLINE", timestamp]
    );
  }
}

function recordAccess(data, zoneId, timestamp) {
  const accessStatus = String(data.accessStatus || "").toUpperCase();
  const recognized = new Set(["GRANTED", "AUTHORIZED", "DENIED", "UNAUTHORIZED"]);
  if (!zoneId || !recognized.has(accessStatus)) return;

  const result = accessStatus === "AUTHORIZED" ? "GRANTED"
    : accessStatus === "UNAUTHORIZED" ? "DENIED"
      : accessStatus;
  const doorState = String(
    data.door || (result === "GRANTED" ? "UNLOCKED" : "LOCKED")
  ).toUpperCase();
  const fingerprint = Number(data.fingerprintId);

  run(
    `INSERT INTO access_logs
     (zone_id, user_name, fingerprint_id, access_status, door_state, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      zoneId,
      data.userName || data.user || null,
      Number.isInteger(fingerprint) && fingerprint >= 0 ? fingerprint : null,
      result,
      doorState,
      timestamp
    ]
  );
}

function calculateRoute(source, destination) {
  const conditions = routeConditions();
  const route = dijkstra(
    source,
    destination,
    new Set(conditions.blockedZones),
    conditions.penalties
  );

  return {
    ...route,
    blockedZones: conditions.blockedZones,
    penalizedZones: conditions.penalizedZones
  };
}

function processTelemetry(data) {
  const time = now();
  const zoneName = data.zone || "LAB";
  const zoneRows = all("SELECT id, name FROM zones WHERE name = ?", [zoneName]);
  const zoneId = zoneRows[0]?.id || null;

  latestTelemetry = { ...data, receivedAt: time };

  run(
    `INSERT INTO sensor_data (sensor_id, zone_id, type, value, timestamp)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.deviceId || "ESP32-SIM",
      zoneId,
      "telemetry",
      Number(data.temperatureC ?? 0),
      time
    ]
  );

  const result = evaluateIncident(data);

  if (zoneId) {
    run(
      `UPDATE zones
       SET status = ?, crowd_level = ?, occupancy = ?
       WHERE id = ?`,
      [
        result.severity === "CRITICAL" ? "BLOCKED" : result.severity,
        result.crowdLevel,
        Number(data.occupancy ?? 0),
        zoneId
      ]
    );
  }

  if (result.type !== "NORMAL") {
    run(
      `INSERT INTO incidents
       (zone_id, type, severity, status, recommended_action, timestamp)
       VALUES (?, ?, ?, 'ACTIVE', ?, ?)`,
      [zoneId, result.type, result.severity, result.action, time]
    );
  }

  storeSensorHealth(data.health, time);
  recordAccess(data, zoneId, time);
  latestTelemetryIncident = result;
  latestTelemetryRoute = calculateRoute(zoneName, "MAIN GATE");

  if (latestTelemetryRoute.route.length > 0) {
    run(
      `INSERT INTO route_logs
       (source_zone, destination_zone, route, total_cost, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      [
        zoneName,
        "MAIN GATE",
        JSON.stringify(latestTelemetryRoute.route),
        latestTelemetryRoute.totalCost,
        time
      ]
    );
  }

  return emitSystemUpdate({ incident: result, route: latestTelemetryRoute, timestamp: time });
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ONLINE",
    service: "smart-campus-safety-backend",
    time: now()
  });
});

app.get("/api/snapshot", (req, res) => {
  try {
    res.json(currentSnapshot());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/zones", (req, res) => {
  try {
    res.json(all("SELECT * FROM zones ORDER BY id"));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/telemetry/latest", (req, res) => {
  res.json(latestTelemetry || { message: "No telemetry received yet." });
});

app.get("/api/incidents", (req, res) => {
  try {
    res.json(listIncidents());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/access-logs", (req, res) => {
  try {
    res.json(listAccessLogs());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telemetry", (req, res) => {
  try {
    const payload = processTelemetry(req.body);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/route", (req, res) => {
  try {
    const { source, destination = "MAIN GATE" } = req.body || {};
    const zones = new Set(all("SELECT name FROM zones").map((zone) => zone.name));

    if (!zones.has(source) || !Object.hasOwn(GRAPH, source)) {
      return res.status(400).json({ error: "A valid source campus zone is required." });
    }
    if (!zones.has(destination) || !Object.hasOwn(GRAPH, destination)) {
      return res.status(400).json({ error: "A valid destination campus zone is required." });
    }

    res.json(calculateRoute(source, destination));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sos", (req, res) => {
  try {
    const { zone } = req.body || {};
    const zoneRows = all("SELECT id, name FROM zones WHERE name = ?", [zone]);
    const zoneId = zoneRows[0]?.id;

    if (!zoneId) {
      return res.status(400).json({ error: "Unknown zone" });
    }

    const time = now();
    const result = run(
      `INSERT INTO sos_alerts (zone_id, status, timestamp)
       VALUES (?, 'ACTIVE', ?)`,
      [zoneId, time]
    );

    run(
      `INSERT INTO incidents
       (zone_id, type, severity, status, recommended_action, timestamp)
       VALUES (?, 'SOS', 'CRITICAL', 'ACTIVE', ?, ?)`,
      [zoneId, `Security response required in ${zone}.`, time]
    );
    run("UPDATE zones SET status = 'BLOCKED' WHERE id = ?", [zoneId]);
    latestTelemetryIncident = {
      type: "SOS",
      severity: "CRITICAL",
      action: `Security response required in ${zone}.`
    };
    latestTelemetryRoute = calculateRoute(latestTelemetry?.zone || zone, "MAIN GATE");

    const payload = {
      id: result.lastInsertRowid,
      zone,
      type: "SOS",
      severity: "CRITICAL",
      status: "ACTIVE",
      timestamp: time
    };

    revision += 1;
    io.emit("sosAlert", payload);
    io.emit("systemUpdate", { ...currentSnapshot(), revision });
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

io.on("connection", (socket) => {
  console.log("Dashboard connected:", socket.id);
  socket.emit("systemUpdate", {
    ...currentSnapshot(),
    message: "Connected to Smart Campus Safety backend."
  });

  socket.on("disconnect", () => {
    console.log("Dashboard disconnected:", socket.id);
  });
});

try {
  initDatabase();

  server.listen(PORT, () => {
    console.log(`Smart Campus backend running on http://localhost:${PORT}`);
  });
} catch (err) {
  console.error("Database initialization failed:", err);
  process.exit(1);
}
