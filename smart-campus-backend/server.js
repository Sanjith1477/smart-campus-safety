const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const { initDatabase, run, all } = require("./db");
const { evaluateIncident } = require("./engines/incidentEngine");
const { dijkstra } = require("./engines/routeEngine");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let latestTelemetry = null;

function now() {
  return new Date().toISOString();
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ONLINE",
    service: "smart-campus-safety-backend",
    time: now()
  });
});

app.get("/api/zones", async (req, res) => {
  try {
    const zones = all("SELECT * FROM zones ORDER BY id");
    res.json(zones);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/telemetry/latest", (req, res) => {
  res.json(latestTelemetry || { message: "No telemetry received yet." });
});

app.get("/api/incidents", async (req, res) => {
  try {
    const rows = all(`
      SELECT incidents.*, zones.name AS zone_name
      FROM incidents
      LEFT JOIN zones ON incidents.zone_id = zones.id
      ORDER BY incidents.id DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telemetry", (req, res) => {
  try {
    const data = req.body;
    const time = now();

    latestTelemetry = {
      ...data,
      receivedAt: time
    };

    const zoneName = data.zone || "LAB";
    const zoneRows = all(
      "SELECT id, name FROM zones WHERE name = ?",
      [zoneName]
    );

    const zoneId = zoneRows[0]?.id || null;

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

    if (result.type !== "NORMAL") {
      run(
        `INSERT INTO incidents
         (zone_id, type, severity, status, recommended_action, timestamp)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?)`,
        [zoneId, result.type, result.severity, result.action, time]
      );
    }

    const blocked = new Set();
    const penalties = {};

    if (result.severity === "CRITICAL") blocked.add(zoneName);
    if (result.crowdLevel === "HIGH") penalties[zoneName] = 10;
    if (result.crowdLevel === "CRITICAL") blocked.add(zoneName);

    const route = dijkstra(
      zoneName,
      "MAIN GATE",
      blocked,
      penalties
    );

    if (route.route.length > 0) {
      run(
        `INSERT INTO route_logs
         (source_zone, destination_zone, route, total_cost, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
        [
          zoneName,
          "MAIN GATE",
          JSON.stringify(route.route),
          route.totalCost,
          time
        ]
      );
    }

    const payload = {
      telemetry: latestTelemetry,
      incident: result,
      route,
      timestamp: time
    };

    io.emit("systemUpdate", payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sos", (req, res) => {
  try {
    const { zone } = req.body;

    const zoneRows = all(
      "SELECT id, name FROM zones WHERE name = ?",
      [zone]
    );

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

    const payload = {
      id: result.lastInsertRowid,
      zone,
      type: "SOS",
      severity: "CRITICAL",
      status: "ACTIVE",
      timestamp: time
    };

    io.emit("sosAlert", payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

io.on("connection", (socket) => {
  console.log("Dashboard connected:", socket.id);

  socket.emit("systemUpdate", {
    telemetry: latestTelemetry,
    message: "Connected to Smart Campus Safety backend."
  });

  socket.on("disconnect", () => {
    console.log("Dashboard disconnected:", socket.id);
  });
});

// node:sqlite DatabaseSync initialization is synchronous.
try {
  initDatabase();

  server.listen(PORT, () => {
    console.log(`Smart Campus backend running on http://localhost:${PORT}`);
  });
} catch (err) {
  console.error("Database initialization failed:", err);
  process.exit(1);
}
