import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  Activity,
  BellRing,
  CircleAlert,
  Gauge,
  Lock,
  Map,
  Radio,
  Route,
  ShieldCheck,
  ShieldAlert,
  Siren,
  Thermometer,
  Users,
  Wifi,
  WifiOff
} from "lucide-react";

const BACKEND = "http://localhost:3000";

const initialTelemetry = {
  temperatureC: 0,
  humidityPct: 0,
  gasIndex: 0,
  flame: false,
  motion: false,
  night: false,
  occupancy: 0,
  crowdLevel: "LOW",
  sosZone: "NONE",
  accessStatus: "NONE",
  door: "LOCKED",
  fan: false,
  incident: "NORMAL",
  severity: "NORMAL",
  incidentZone: "NONE",
  action: "MONITOR SYSTEM"
};

const zoneLayout = {
  LAB: { x: 6, y: 8 },
  CLASSROOM: { x: 40, y: 8 },
  "SECURITY CENTER": { x: 40, y: 42 },
  CANTEEN: { x: 6, y: 72 },
  PARKING: { x: 72, y: 58 },
  "MAIN GATE": { x: 72, y: 86 }
};

const edges = [
  ["LAB", "CLASSROOM"],
  ["LAB", "SECURITY CENTER"],
  ["CLASSROOM", "SECURITY CENTER"],
  ["SECURITY CENTER", "CANTEEN"],
  ["SECURITY CENTER", "PARKING"],
  ["SECURITY CENTER", "MAIN GATE"],
  ["PARKING", "MAIN GATE"]
];

function severityClass(severity) {
  return {
    NORMAL: "normal",
    WARNING: "warning",
    HIGH: "high",
    CRITICAL: "critical"
  }[severity] || "normal";
}

function App() {
  const [telemetry, setTelemetry] = useState(initialTelemetry);
  const [incident, setIncident] = useState({
    type: "NORMAL",
    severity: "NORMAL",
    action: "Continue monitoring."
  });
  const [route, setRoute] = useState({ route: [], totalCost: null });
  const [zones, setZones] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [backendOnline, setBackendOnline] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [message, setMessage] = useState("");

  const zoneMap = useMemo(
    () => Object.fromEntries(zones.map((z) => [z.name, z])),
    [zones]
  );

  useEffect(() => {
    let socket;

    async function loadInitial() {
      try {
        const [healthRes, zonesRes, latestRes, incidentsRes] = await Promise.all([
          fetch(`${BACKEND}/api/health`),
          fetch(`${BACKEND}/api/zones`),
          fetch(`${BACKEND}/api/telemetry/latest`),
          fetch(`${BACKEND}/api/incidents`)
        ]);

        setBackendOnline(healthRes.ok);

        if (zonesRes.ok) setZones(await zonesRes.json());

        if (latestRes.ok) {
          const latest = await latestRes.json();
          if (latest && !latest.message) setTelemetry((p) => ({ ...p, ...latest }));
        }

        if (incidentsRes.ok) setIncidents(await incidentsRes.json());
      } catch (error) {
        setBackendOnline(false);
        setMessage("Backend not reachable on port 3000.");
      }
    }

    loadInitial();

    socket = io(BACKEND, {
      transports: ["websocket", "polling"]
    });

    socket.on("connect", () => {
      setBackendOnline(true);
      setMessage("Live connection established.");
    });

    socket.on("disconnect", () => {
      setBackendOnline(false);
      setMessage("Live connection lost.");
    });

    socket.on("systemUpdate", (payload) => {
      if (payload.telemetry) {
        setTelemetry((p) => ({ ...p, ...payload.telemetry }));
      }
      if (payload.incident) setIncident(payload.incident);
      if (payload.route) setRoute(payload.route);
      if (payload.timestamp) setLastUpdate(payload.timestamp);
      setBackendOnline(true);
    });

    socket.on("sosAlert", (payload) => {
      setMessage(`SOS received from ${payload.zone}.`);
    });

    return () => socket?.disconnect();
  }, []);

  async function triggerSos(zone) {
    try {
      const response = await fetch(`${BACKEND}/api/sos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "SOS request failed");
      }

      setMessage(`SOS activated: ${zone}`);
      setIncident({
        type: "SOS",
        severity: "CRITICAL",
        action: `Security response required in ${zone}.`
      });
    } catch (error) {
      setMessage(error.message);
    }
  }

  const activeZone = telemetry.incidentZone !== "NONE"
    ? telemetry.incidentZone
    : telemetry.sosZone !== "NONE"
      ? telemetry.sosZone
      : "LAB";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">IoT SAFETY PLATFORM</div>
          <h1>Smart Campus Safety Command Center</h1>
          <p>Detect • Assess • Respond • Guide • Record</p>
        </div>

        <div className="system-pill">
          {backendOnline ? <Wifi size={17} /> : <WifiOff size={17} />}
          <span>{backendOnline ? "BACKEND ONLINE" : "BACKEND OFFLINE"}</span>
          <span className="dot" />
          <span>{telemetry.night ? "NIGHT MODE" : "DAY MODE"}</span>
        </div>
      </header>

      <main className="dashboard">
        {message && <div className="toast">{message}</div>}

        <section className="stats-grid">
          <StatCard icon={<Thermometer />} label="Temperature" value={`${Number(telemetry.temperatureC).toFixed(1)} °C`} />
          <StatCard icon={<Gauge />} label="Gas Index" value={telemetry.gasIndex ?? "—"} />
          <StatCard icon={<Users />} label="Occupancy" value={telemetry.occupancy ?? 0} />
          <StatCard icon={<Radio />} label="Motion" value={telemetry.motion ? "DETECTED" : "CLEAR"} />
          <StatCard icon={<Activity />} label="Flame" value={telemetry.flame ? "DETECTED" : "CLEAR"} />
          <StatCard icon={<ShieldCheck />} label="Door" value={telemetry.door || "LOCKED"} />
        </section>

        <section className="content-grid">
          <div className="panel map-panel">
            <PanelTitle icon={<Map />} title="Campus Risk Map" subtitle="Live zone status and evacuation route" />

            <div className="campus-map">
              <svg className="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
                {edges.map(([a, b]) => {
                  const p1 = zoneLayout[a];
                  const p2 = zoneLayout[b];
                  return (
                    <line
                      key={`${a}-${b}`}
                      x1={p1.x + 10}
                      y1={p1.y + 7}
                      x2={p2.x + 10}
                      y2={p2.y + 7}
                    />
                  );
                })}

                {route.route?.map((name, index) => {
                  if (index === route.route.length - 1) return null;
                  const p1 = zoneLayout[name];
                  const p2 = zoneLayout[route.route[index + 1]];
                  return (
                    <line
                      key={`route-${name}-${index}`}
                      className="route-line"
                      x1={p1.x + 10}
                      y1={p1.y + 7}
                      x2={p2.x + 10}
                      y2={p2.y + 7}
                    />
                  );
                })}
              </svg>

              {Object.entries(zoneLayout).map(([name, pos]) => {
                const zone = zoneMap[name];
                const isActive = name === activeZone;
                const status = zone?.status || "NORMAL";

                return (
                  <div
                    key={name}
                    className={`zone ${severityClass(status === "BLOCKED" ? "CRITICAL" : status)} ${isActive ? "active-zone" : ""}`}
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  >
                    <div className="zone-name">{name}</div>
                    <div className="zone-status">{status}</div>
                    <div className="zone-crowd">
                      {zone?.occupancy ?? 0} people
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel incident-panel">
            <PanelTitle icon={<CircleAlert />} title="Current Incident" subtitle="Rule-based assessment" />

            <div className={`incident-card ${severityClass(incident.severity)}`}>
              <div className="incident-head">
                <div>
                  <div className="mini-label">INCIDENT</div>
                  <h2>{incident.type || "NORMAL"}</h2>
                </div>
                <div className="severity-badge">{incident.severity}</div>
              </div>

              <div className="incident-details">
                <Row label="Zone" value={telemetry.incidentZone || telemetry.sosZone || "NONE"} />
                <Row label="Action" value={incident.action || telemetry.action || "Continue monitoring."} />
                <Row label="Crowd" value={telemetry.crowdLevel || "LOW"} />
                <Row label="Fan" value={telemetry.fan ? "ON" : "OFF"} />
              </div>
            </div>

            <div className="route-card">
              <div className="route-title">
                <Route size={18} />
                <span>Recommended Safe Route</span>
              </div>
              <div className="route-path">
                {route.route?.length
                  ? route.route.map((name, i) => (
                      <span key={`${name}-${i}`}>
                        <b>{name}</b>
                        {i < route.route.length - 1 && <span className="arrow">→</span>}
                      </span>
                    ))
                  : "No route available"}
              </div>
              <div className="route-cost">
                Total route cost: <strong>{route.totalCost ?? "—"}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="content-grid lower">
          <div className="panel">
            <PanelTitle icon={<Siren />} title="Emergency SOS" subtitle="Zone-aware emergency alerts" />
            <div className="sos-grid">
              {["LAB", "CANTEEN", "PARKING"].map((zone) => (
                <button key={zone} className="sos-button" onClick={() => triggerSos(zone)}>
                  <BellRing size={18} />
                  <span>{zone} SOS</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel">
            <PanelTitle icon={<ShieldAlert />} title="Device & Sensor Health" subtitle="Virtual ESP32 status" />
            <div className="health-list">
              {Object.entries(telemetry.health || {
                dht: true,
                mq2: true,
                pir: true,
                ir: true,
                ldr: true,
                fingerprint: true
              }).map(([name, online]) => (
                <div className="health-row" key={name}>
                  <span>{name.toUpperCase()}</span>
                  <span className={online ? "online" : "offline"}>
                    {online ? "ONLINE" : "OFFLINE"}
                  </span>
                </div>
              ))}
              <div className="health-row">
                <span>Last update</span>
                <span>{lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : "—"}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="panel history-panel">
          <PanelTitle icon={<Activity />} title="Incident History" subtitle="Latest events recorded in SQLite" />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Zone</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {incidents.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="empty">No incidents recorded yet.</td>
                  </tr>
                ) : (
                  incidents.slice(0, 10).map((item) => (
                    <tr key={item.id}>
                      <td>{new Date(item.timestamp).toLocaleTimeString()}</td>
                      <td>{item.zone_name || "—"}</td>
                      <td>{item.type}</td>
                      <td><span className={`table-severity ${severityClass(item.severity)}`}>{item.severity}</span></td>
                      <td>{item.status}</td>
                      <td>{item.recommended_action || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  );
}

function PanelTitle({ icon, title, subtitle }) {
  return (
    <div className="panel-title">
      <div className="panel-icon">{icon}</div>
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;
