import React, { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  Activity,
  Command,
  HeartPulse,
  Map,
  Menu,
  Radio,
  Route,
  Shield,
  ShieldAlert,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import {
  AccessControlPage,
  DemoPage,
  IncidentsPage,
  OverviewPage,
  SafeRoutePage,
  SystemHealthPage
} from "./pages";

const BACKEND = "http://localhost:3000";
const CAMPUS_ZONES = ["LAB", "CLASSROOM", "SECURITY CENTER", "CANTEEN", "PARKING", "MAIN GATE"];
const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: Map },
  { id: "routes", label: "Safe Route", icon: Route },
  { id: "incidents", label: "Incidents", icon: ShieldAlert },
  { id: "access", label: "Access Control", icon: Shield },
  { id: "health", label: "System Health", icon: HeartPulse },
  { id: "demo", label: "Demo / Simulation", icon: Command }
];
const EMPTY_HEALTH = ["DHT", "MQ2", "PIR", "IR", "LDR", "FINGERPRINT"];
const BASE_TELEMETRY = {
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

function App() {
  const [page, setPage] = useState("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [telemetry, setTelemetry] = useState(BASE_TELEMETRY);
  const [incident, setIncident] = useState(null);
  const [route, setRoute] = useState({ route: [], totalCost: null });
  const [zones, setZones] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [activeIncidents, setActiveIncidents] = useState([]);
  const [accessLogs, setAccessLogs] = useState([]);
  const [sensorHealth, setSensorHealth] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState("RECONNECTING");
  const [lastUpdate, setLastUpdate] = useState(null);
  const [conditionsRevision, setConditionsRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [pendingScenario, setPendingScenario] = useState("");
  const [scenarioMessage, setScenarioMessage] = useState("");
  const latestRevision = useRef(-1);
  const latestConditionSignature = useRef(null);
  const connectionGeneration = useRef(0);

  const applySnapshot = useCallback((snapshot) => {
    if (!snapshot || typeof snapshot !== "object") return;
    const incomingRevision = Number(snapshot.revision);
    if (Number.isFinite(incomingRevision) && incomingRevision < latestRevision.current) return;
    if (Number.isFinite(incomingRevision)) latestRevision.current = incomingRevision;

    if ("telemetry" in snapshot) {
      setTelemetry(snapshot.telemetry
        ? (previous) => ({ ...previous, ...snapshot.telemetry })
        : BASE_TELEMETRY);
    }
    if ("incident" in snapshot) setIncident(snapshot.incident);
    if (snapshot.route) setRoute(snapshot.route);
    if (Array.isArray(snapshot.zones)) {
      setZones(snapshot.zones);
      const signature = snapshot.zones
        .map((zone) => `${zone.name}:${zone.status}:${zone.crowd_level}:${zone.occupancy}`)
        .join("|");
      if (latestConditionSignature.current === null) {
        latestConditionSignature.current = signature;
      } else if (latestConditionSignature.current !== signature) {
        latestConditionSignature.current = signature;
        setConditionsRevision((current) => current + 1);
      }
    }
    if (Array.isArray(snapshot.incidents)) setIncidents(snapshot.incidents);
    if (Array.isArray(snapshot.activeIncidents)) setActiveIncidents(snapshot.activeIncidents);
    if (Array.isArray(snapshot.accessLogs)) setAccessLogs(snapshot.accessLogs);
    if (Array.isArray(snapshot.sensorHealth)) setSensorHealth(snapshot.sensorHealth);
    if ("timestamp" in snapshot) setLastUpdate(snapshot.timestamp || snapshot.telemetry?.receivedAt || null);
  }, []);

  const fetchSnapshot = useCallback(async (generation = connectionGeneration.current) => {
    const response = await fetch(`${BACKEND}/api/snapshot`);
    if (!response.ok) throw new Error(`Snapshot request failed (${response.status}).`);
    const snapshot = await response.json();
    if (generation === connectionGeneration.current) applySnapshot(snapshot);
  }, [applySnapshot]);

  useEffect(() => {
    let offlineTimer;
    const socket = io(BACKEND, {
      transports: ["websocket", "polling"],
      reconnection: true,
      autoConnect: false
    });

    const clearOfflineTimer = () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      offlineTimer = undefined;
    };
    const markReconnecting = () => {
      setConnectionStatus("RECONNECTING");
      clearOfflineTimer();
      offlineTimer = setTimeout(() => {
        if (!socket.connected) setConnectionStatus("OFFLINE");
      }, 10000);
    };
    const onConnect = () => {
      clearOfflineTimer();
      setConnectionStatus("LIVE");
      setNotice((current) => current?.startsWith("Snapshot synchronization failed:")
        ? ""
        : current);
      latestRevision.current = -1;
      connectionGeneration.current += 1;
      fetchSnapshot(connectionGeneration.current).catch((error) => {
        setNotice(`Snapshot synchronization failed: ${error.message}`);
      });
    };
    const onDisconnect = () => {
      connectionGeneration.current += 1;
      markReconnecting();
    };
    const onConnectError = () => markReconnecting();
    const onSystemUpdate = (snapshot) => {
      applySnapshot(snapshot);
      setConnectionStatus(socket.connected ? "LIVE" : "RECONNECTING");
      setNotice((current) => current?.startsWith("Snapshot synchronization failed:")
        ? ""
        : current);
    };
    const onSosAlert = (payload) => {
      setNotice(`SOS received from ${payload.zone}.`);
    };
    const onReconnectAttempt = () => markReconnecting();
    const connectTimer = setTimeout(() => socket.connect(), 0);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("systemUpdate", onSystemUpdate);
    socket.on("sosAlert", onSosAlert);
    socket.io.on("reconnect_attempt", onReconnectAttempt);

    return () => {
      clearTimeout(connectTimer);
      clearOfflineTimer();
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("systemUpdate", onSystemUpdate);
      socket.off("sosAlert", onSosAlert);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      socket.disconnect();
    };
  }, [applySnapshot, fetchSnapshot]);

  useEffect(() => {
    if (connectionStatus === "LIVE") return undefined;

    let cancelled = false;
    const syncWhileDisconnected = () => {
      fetchSnapshot().then(() => {
        if (!cancelled) {
          setNotice((current) => current?.startsWith("Snapshot synchronization failed:")
            ? ""
            : current);
        }
      }).catch((error) => {
        if (!cancelled) {
          setConnectionStatus("OFFLINE");
          setNotice((current) => current?.startsWith("Snapshot synchronization failed:")
            ? current
            : `Snapshot synchronization failed: ${error.message}`);
        }
      });
    };
    syncWhileDisconnected();
    const interval = setInterval(syncWhileDisconnected, 7000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connectionStatus, fetchSnapshot]);

  async function triggerSos(zone) {
    try {
      const response = await fetch(`${BACKEND}/api/sos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "SOS request failed.");
      setNotice(`SOS activated for ${zone}.`);
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function runScenario(scenario) {
    setPendingScenario(scenario);
    setScenarioMessage("");
    setNotice("");

    const baseline = {
      deviceId: "ESP32-SIM",
      zone: "LAB",
      temperatureC: 25,
      humidityPct: 45,
      gasIndex: 100,
      flame: false,
      motion: false,
      night: false,
      occupancy: 5,
      accessStatus: "NONE",
      door: "LOCKED",
      fan: false,
      health: Object.fromEntries(EMPTY_HEALTH.map((sensor) => [sensor.toLowerCase(), true]))
    };
    const sensorScenarios = {
      fire: { zone: "LAB", flame: true, temperatureC: 70 },
      gas: { zone: "CANTEEN", gasIndex: 800 },
      overheating: { zone: "LAB", temperatureC: 70 },
      "high-crowd": { zone: "SECURITY CENTER", occupancy: 30 },
      "critical-crowd": { zone: "SECURITY CENTER", occupancy: 45 },
      "authorized-access": { zone: "SECURITY CENTER", accessStatus: "GRANTED", userName: "Demo Operator", fingerprintId: 1, door: "UNLOCKED" },
      "unauthorized-access": { zone: "SECURITY CENTER", accessStatus: "DENIED", userName: "Demo Operator", fingerprintId: 999, door: "LOCKED" },
      "night-mode": { zone: "LAB", night: true },
      "night-intrusion": { zone: "LAB", night: true, motion: true },
      "sensor-failure": { zone: "LAB", health: Object.fromEntries(EMPTY_HEALTH.map((sensor) => [sensor.toLowerCase(), false])) },
      "restore-sensors": { zone: "LAB" }
    };
    const sosZones = {
      "sos-lab": "LAB",
      "sos-canteen": "CANTEEN",
      "sos-parking": "PARKING"
    };

    try {
      if (sosZones[scenario]) {
        const response = await fetch(`${BACKEND}/api/sos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zone: sosZones[scenario] })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "SOS request failed.");
        setScenarioMessage(`SOS recorded for ${sosZones[scenario]}.`);
      } else if (scenario === "reset-system") {
        for (const zone of CAMPUS_ZONES) {
          const response = await fetch(`${BACKEND}/api/telemetry`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...baseline, zone, occupancy: 0 })
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || `Reset telemetry failed for ${zone}.`);
        }
        setScenarioMessage("Normal telemetry sent to all six zones. Sensor state was restored; incident and access history was retained.");
      } else {
        const response = await fetch(`${BACKEND}/api/telemetry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...baseline, ...sensorScenarios[scenario] })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Simulation telemetry request failed.");
        setScenarioMessage(
          `${scenario.replaceAll("-", " ")} telemetry sent and recorded.`
        );
      }
    } catch (error) {
      setScenarioMessage(`Action failed: ${error.message}`);
      setNotice(error.message);
    } finally {
      setPendingScenario("");
    }
  }

  function openPage(nextPage) {
    setPage(nextPage);
    setMobileNavOpen(false);
  }

  const selectedPage = NAV_ITEMS.find((item) => item.id === page) || NAV_ITEMS[0];
  const StatusIcon = connectionStatus === "LIVE" ? Wifi : WifiOff;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
          {mobileNavOpen ? <X /> : <Menu />}
        </button>
        <div className="brand-lockup">
          <div className="brand-mark"><Activity size={20} /></div>
          <div><strong>Campus Safety</strong><span>Operations Center</span></div>
        </div>
        <div className="topbar-page">
          <span className="topbar-page-icon"><selectedPage.icon size={17} /></span>
          <span>{selectedPage.label}</span>
        </div>
        <div className="topbar-status">
          <div className="mode-state">
            {telemetry.receivedAt ? (telemetry.night ? "NIGHT MODE" : "DAY MODE") : "MODE UNKNOWN"}
          </div>
          <div className={`connection-indicator ${connectionStatus.toLowerCase()}`} aria-live="polite">
            <span className="connection-light" />
            <span>{connectionStatus}</span>
          </div>
          <div className="update-time"><StatusIcon size={14} /> Updated {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : "waiting for telemetry"}</div>
        </div>
      </header>

      <div className="app-body">
        <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
          <div className="sidebar-label">CAMPUS OPERATIONS</div>
          <nav aria-label="Main navigation">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button key={id} className={`nav-item ${page === id ? "selected" : ""}`} onClick={() => openPage(id)}>
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
                {id === "incidents" && activeIncidents.length > 0 && <span className="nav-count">{activeIncidents.length}</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span className="sidebar-footer-icon"><Radio size={16} /></span>
            <div><strong>Live monitoring</strong><span>ESP32 telemetry link</span></div>
          </div>
        </aside>

        <main className="main-content">
          {notice && <div className="notice-bar" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={15} /></button></div>}
          <div hidden={page !== "overview"}>
            <OverviewPage
              zones={zones}
              telemetry={telemetry}
              activeIncidents={activeIncidents}
              incident={incident}
              sensorHealth={sensorHealth}
              connectionStatus={connectionStatus}
              lastUpdate={lastUpdate}
              onSos={triggerSos}
            />
          </div>
          <div hidden={page !== "routes"}>
            <SafeRoutePage
              zones={zones}
              conditionsRevision={conditionsRevision}
              onError={setNotice}
            />
          </div>
          <div hidden={page !== "incidents"}>
            <IncidentsPage incidents={incidents} activeIncidents={activeIncidents} />
          </div>
          <div hidden={page !== "access"}>
            <AccessControlPage accessLogs={accessLogs} />
          </div>
          <div hidden={page !== "health"}>
            <SystemHealthPage sensorHealth={sensorHealth} telemetry={telemetry} lastUpdate={lastUpdate} />
          </div>
          <div hidden={page !== "demo"}>
            <DemoPage
              onRunScenario={runScenario}
              pendingScenario={pendingScenario}
              resultMessage={scenarioMessage}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
