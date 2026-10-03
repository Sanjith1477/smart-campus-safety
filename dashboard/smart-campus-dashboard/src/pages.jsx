import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  BellRing,
  CheckCircle2,
  CircleAlert,
  Clock3,
  DoorOpen,
  Flame,
  Gauge,
  MapPin,
  Radio,
  Route,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Thermometer,
  Users,
  Wifi,
  WifiOff
} from "lucide-react";

const ZONES = ["LAB", "CLASSROOM", "SECURITY CENTER", "CANTEEN", "PARKING", "MAIN GATE"];
const SENSORS = ["DHT", "MQ2", "PIR", "IR", "LDR", "FINGERPRINT"];
const SENSOR_LABELS = {
  DHT: "DHT",
  MQ2: "MQ2",
  PIR: "PIR",
  IR: "IR",
  LDR: "LDR",
  FINGERPRINT: "Fingerprint"
};
const ROUTE_EDGES = [
  ["LAB", "CLASSROOM"],
  ["LAB", "SECURITY CENTER"],
  ["CLASSROOM", "SECURITY CENTER"],
  ["SECURITY CENTER", "CANTEEN"],
  ["SECURITY CENTER", "PARKING"],
  ["SECURITY CENTER", "MAIN GATE"],
  ["PARKING", "MAIN GATE"]
];
const ROUTE_LAYOUT = {
  LAB: { x: 16, y: 22 },
  CLASSROOM: { x: 50, y: 12 },
  "SECURITY CENTER": { x: 50, y: 48 },
  CANTEEN: { x: 16, y: 75 },
  PARKING: { x: 83, y: 60 },
  "MAIN GATE": { x: 83, y: 89 }
};

export function severityClass(value) {
  const normalized = String(value || "NORMAL").toUpperCase();
  return normalized === "BLOCKED" ? "critical" : normalized.toLowerCase();
}

export function formatTime(value) {
  if (!value) return "No update recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No update recorded" : date.toLocaleString();
}

export function SeverityBadge({ value }) {
  return <span className={`severity-badge ${severityClass(value)}`}>{value || "NORMAL"}</span>;
}

export function OverviewPage({
  zones,
  telemetry,
  activeIncidents,
  incident,
  sensorHealth,
  connectionStatus,
  lastUpdate,
  onSos
}) {
  const zoneMap = useMemo(
    () => Object.fromEntries(zones.map((zone) => [zone.name, zone])),
    [zones]
  );
  const activeIncident = activeIncidents[0] || null;

  return (
    <div className="page-content">
      <PageHeading
        title="Campus overview"
        description="Live safety status across all monitored campus zones."
      />
      <section className="overview-summary">
        <Metric icon={<CircleAlert />} label="Active incidents" value={activeIncidents.length} />
        <Metric icon={<Users />} label="Campus occupancy" value={zones.reduce((sum, zone) => sum + Number(zone.occupancy || 0), 0)} />
        <Metric icon={<Radio />} label="Sensors online" value={`${sensorHealth.filter((sensor) => sensor.status === "ONLINE").length}/${SENSORS.length}`} />
        <Metric
          icon={connectionStatus === "LIVE" ? <Wifi /> : <WifiOff />}
          label="Last telemetry update"
          value={lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : "Waiting"}
        />
      </section>

      <section className="overview-grid">
        <div className="panel zone-panel">
          <PanelHeading title="Campus zones" subtitle="Status and occupancy from the live zone register" />
          <div className="zone-grid">
            {ZONES.map((name) => {
              const zone = zoneMap[name];
              const status = zone?.status || "NORMAL";
              return (
                <article className={`zone-tile ${severityClass(status)}`} key={name}>
                  <div className="zone-tile-head">
                    <span className="zone-name">{name}</span>
                    <SeverityBadge value={status} />
                  </div>
                  <div className="zone-occupancy">
                    <Users size={16} />
                    <strong>{zone?.occupancy ?? 0}</strong>
                    <span>people</span>
                  </div>
                  <div className="zone-tile-foot">
                    <span>Crowd level</span>
                    <strong>{zone?.crowd_level || "LOW"}</strong>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="map-note">Zone tiles show live conditions only. Route planning is available in Safe Route.</p>
        </div>

        <div className="overview-side">
          <section className={`panel incident-focus ${activeIncident ? severityClass(activeIncident.severity) : ""}`}>
            <PanelHeading title="Active incident" subtitle={activeIncident ? "Latest active response item" : "No active incident recorded"} />
            {activeIncident ? (
              <div className="incident-focus-body">
                <div className="incident-focus-title">
                  <div>
                    <span className="small-label">{activeIncident.zone_name || "CAMPUS"}</span>
                    <h3>{activeIncident.type}</h3>
                  </div>
                  <SeverityBadge value={activeIncident.severity} />
                </div>
                <p>{activeIncident.recommended_action || "Review the active incident and respond."}</p>
                <span className="muted-text">{formatTime(activeIncident.timestamp)}</span>
              </div>
            ) : (
              <div className="empty-state compact">
                <ShieldCheck size={26} />
                <p>Monitoring normally. Latest assessment: {incident?.type || "NORMAL"}.</p>
              </div>
            )}
          </section>

          <section className="panel sensor-summary">
            <PanelHeading title="Sensor summary" subtitle="Most recent reported hardware health" />
            <SensorGrid sensorHealth={sensorHealth} />
            <div className="last-update"><Clock3 size={14} /> Last system update: {formatTime(lastUpdate)}</div>
          </section>

          <section className="panel sos-panel">
            <PanelHeading title="Emergency SOS" subtitle="Send an alert for a campus zone" />
            <div className="sos-actions">
              {["LAB", "CANTEEN", "PARKING"].map((zone) => (
                <button className="button danger-button" key={zone} onClick={() => onSos(zone)}>
                  <BellRing size={15} /> {zone}
                </button>
              ))}
            </div>
            <span className="muted-text">Current device zone: {telemetry.zone || "Not reported"}</span>
          </section>
        </div>
      </section>
    </div>
  );
}

export function SafeRoutePage({
  zones,
  conditionsRevision,
  onError
}) {
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("MAIN GATE");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [conditionsChanged, setConditionsChanged] = useState(false);
  const generatedRef = useRef(false);
  const appliedRevisionRef = useRef(null);
  const requestIdRef = useRef(0);

  async function generateRoute(isAutomatic = false) {
    if (!source) {
      setRouteError("Select a current location before generating a route.");
      return;
    }

    const requestId = ++requestIdRef.current;
    if (!isAutomatic) setConditionsChanged(false);
    setLoading(true);
    setRouteError("");
    try {
      const response = await fetch("http://localhost:3000/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, destination })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Route calculation failed.");
      if (requestId !== requestIdRef.current) return;
      setResult(payload);
      generatedRef.current = true;
      if (isAutomatic) setConditionsChanged(true);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setRouteError(error.message);
        onError(error.message);
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (appliedRevisionRef.current === null) {
      appliedRevisionRef.current = conditionsRevision;
      return;
    }
    if (appliedRevisionRef.current === conditionsRevision) return;

    appliedRevisionRef.current = conditionsRevision;
    if (generatedRef.current && source) {
      generateRoute(true);
    }
  }, [conditionsRevision]);

  const zoneMap = useMemo(
    () => Object.fromEntries(zones.map((zone) => [zone.name, zone])),
    [zones]
  );

  return (
    <div className="page-content">
      <PageHeading
        title="Safe route"
        description="Calculate a path through the campus using current zone safety and crowd conditions."
      />
      <section className="panel route-controls">
        <div className="form-field">
          <label htmlFor="route-source">Current location</label>
          <select id="route-source" value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">Select a campus zone</option>
            {ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="route-destination">Destination</label>
          <select id="route-destination" value={destination} onChange={(event) => setDestination(event.target.value)}>
            {ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </div>
        <button className="button primary-button route-submit" onClick={() => generateRoute()} disabled={loading}>
          <Route size={17} /> {loading ? "Calculating..." : "Generate safest route"}
        </button>
      </section>
      {routeError && <div className="inline-alert error-alert" role="alert">{routeError}</div>}
      {conditionsChanged && <div className="inline-alert info-alert route-notice" role="status">Campus conditions changed. Route recalculated.</div>}

      <section className="route-result-layout">
        <div className="panel route-graph-panel">
          <PanelHeading title="Campus route graph" subtitle="The route follows the connected campus walkways" />
          <div className="route-graph">
            <svg className="graph-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Campus walkway graph">
              {ROUTE_EDGES.map(([start, end]) => {
                const from = ROUTE_LAYOUT[start];
                const to = ROUTE_LAYOUT[end];
                return <line key={`${start}-${end}`} className="graph-edge" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
              })}
              {result?.route?.slice(0, -1).map((start, index) => {
                const end = result.route[index + 1];
                const from = ROUTE_LAYOUT[start];
                const to = ROUTE_LAYOUT[end];
                return <line key={`active-${start}-${end}`} className="graph-edge active-edge" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
              })}
            </svg>
            {ZONES.map((name) => {
              const pos = ROUTE_LAYOUT[name];
              const zone = zoneMap[name];
              const blocked = result?.blockedZones?.includes(name);
              const inRoute = result?.route?.includes(name);
              return (
                <div
                  className={`graph-node ${severityClass(zone?.status)} ${blocked ? "blocked-node" : ""} ${inRoute ? "route-node" : ""}`}
                  key={name}
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                >
                  <span className="graph-node-name">{name}</span>
                  <span className="graph-node-state">{blocked ? "BLOCKED" : zone?.crowd_level || "LOW"}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel route-details-panel">
          <PanelHeading title="Route assessment" subtitle={result ? "Calculated against the latest zone conditions" : "Select locations to calculate a route"} />
          {result ? (
            <>
              <div className="route-endpoints">
                <div><span>Start</span><strong><MapPin size={15} /> {source}</strong></div>
                <ArrowDown size={16} className="endpoint-arrow" />
                <div><span>Destination</span><strong><MapPin size={15} /> {destination}</strong></div>
              </div>
              {result.route?.length ? (
                <>
                  <div className="route-path-list">
                    {result.route.map((zone, index) => (
                      <React.Fragment key={`${zone}-${index}`}>
                        <span className="route-stop">{zone}</span>
                        {index < result.route.length - 1 && <ArrowRight className="path-arrow" size={15} />}
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="route-cost"><span>Total cost</span><strong>{result.totalCost}</strong></div>
                  <p className="route-explanation">
                    {result.penalizedZones.length
                      ? "This is the lowest-cost available path. Unsafe zones are blocked, and crowded or high-risk zones carry added cost."
                      : "This is the lowest-cost available path under current campus conditions."}
                  </p>
                </>
              ) : (
                <div className="inline-alert error-alert">No safe path is currently available between these locations.</div>
              )}
              <ConditionList title="Blocked zones" items={result.blockedZones.map((zone) => ({ name: zone }))} empty="No zones are blocked." />
              <ConditionList
                title="Penalized / crowded zones"
                items={result.penalizedZones.map((entry) => ({
                  name: entry.zone,
                  detail: `+${entry.penalty} cost · ${entry.reasons.join(", ")}`
                }))}
                empty="No zones currently carry route penalties."
              />
            </>
          ) : (
            <div className="empty-state"><Route size={28} /><p>Route cost and live restrictions will appear here.</p></div>
          )}
        </div>
      </section>
    </div>
  );
}

export function IncidentsPage({ incidents, activeIncidents }) {
  const [filter, setFilter] = useState("ALL");
  const visible = incidents.filter((incident) => filter === "ALL" || incident.severity === filter);

  return (
    <div className="page-content">
      <PageHeading title="Incidents" description="Active response items and incident history recorded in SQLite." />
      <section className="panel">
        <PanelHeading title={`Active incidents (${activeIncidents.length})`} subtitle="Items awaiting response or resolution" />
        <IncidentTable incidents={activeIncidents} empty="No active incidents." />
      </section>
      <section className="panel incidents-history">
        <div className="panel-heading with-control">
          <div><h2>Recent history</h2><p>Latest 100 backend incident records</p></div>
          <div className="form-field compact-field">
            <label htmlFor="incident-severity">Severity</label>
            <select id="incident-severity" value={filter} onChange={(event) => setFilter(event.target.value)}>
              {["ALL", "NORMAL", "WARNING", "HIGH", "CRITICAL"].map((severity) => <option key={severity} value={severity}>{severity}</option>)}
            </select>
          </div>
        </div>
        <IncidentTable incidents={visible} empty="No incidents match this filter." />
      </section>
    </div>
  );
}

export function AccessControlPage({ accessLogs }) {
  return (
    <div className="page-content">
      <PageHeading title="Access control" description="Recent access decisions and recorded door state from backend access logs." />
      <section className="panel">
        <PanelHeading title="Recent access logs" subtitle="Latest 100 access decisions received with telemetry" />
        <div className="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Zone</th><th>Access result</th><th>Door state</th><th>Timestamp</th></tr></thead>
            <tbody>
              {accessLogs.length ? accessLogs.map((log) => (
                <tr key={log.id}>
                  <td>{log.user_name || (log.fingerprint_id != null ? `Fingerprint ${log.fingerprint_id}` : "Unidentified user")}</td>
                  <td>{log.zone_name || "Unknown zone"}</td>
                  <td><span className={`access-result ${log.access_status === "GRANTED" ? "granted" : "denied"}`}>{log.access_status}</span></td>
                  <td><span className="inline-icon"><DoorOpen size={15} /> {log.door_state || "LOCKED"}</span></td>
                  <td>{formatTime(log.timestamp)}</td>
                </tr>
              )) : <EmptyTableRow columns={5} text="No access-control events have been recorded." />}
            </tbody>
          </table>
        </div>
      </section>
      <p className="page-footnote">Access records are created when the backend receives a granted or denied access result with telemetry.</p>
    </div>
  );
}

export function SystemHealthPage({ sensorHealth, telemetry, lastUpdate }) {
  const healthMap = useMemo(
    () => Object.fromEntries(sensorHealth.map((sensor) => [sensor.sensor_id, sensor])),
    [sensorHealth]
  );
  return (
    <div className="page-content">
      <PageHeading title="System health" description="Sensor availability and the time of each reported heartbeat." />
      <section className="health-grid">
        {SENSORS.map((name) => {
          const record = healthMap[name];
          const online = record?.status === "ONLINE";
          return (
            <article className="panel health-card" key={name}>
              <div className="health-card-icon">{online ? <CheckCircle2 /> : <AlertTriangle />}</div>
              <div className="health-card-main">
                <span className="health-sensor-name">{SENSOR_LABELS[name]}</span>
                <strong className={online ? "text-normal" : "text-offline"}>{record?.status || "OFFLINE"}</strong>
              </div>
              <div className="health-card-time">Last update: {formatTime(record?.last_heartbeat)}</div>
            </article>
          );
        })}
      </section>
      <section className="panel health-summary-panel">
        <PanelHeading title="Latest device telemetry" subtitle="Values from the most recently received ESP32 message" />
        {telemetry?.receivedAt ? (
          <div className="telemetry-strip">
            <Metric icon={<Thermometer />} label="Temperature" value={`${Number(telemetry.temperatureC || 0).toFixed(1)} °C`} />
            <Metric icon={<Activity />} label="Humidity" value={`${telemetry.humidityPct ?? "Not reported"}${telemetry.humidityPct == null ? "" : " %"}`} />
            <Metric icon={<Gauge />} label="Gas index" value={telemetry.gasIndex ?? "Not reported"} />
            <Metric icon={<Users />} label="Occupancy" value={telemetry.occupancy ?? 0} />
            <Metric icon={<Activity />} label="Motion" value={telemetry.motion ? "Detected" : "Clear"} />
            <Metric icon={<Flame />} label="Flame" value={telemetry.flame ? "Detected" : "Clear"} />
            <Metric icon={<DoorOpen />} label="Door" value={telemetry.door || "Not reported"} />
            <Metric icon={<Activity />} label="Fan" value={telemetry.fan ? "On" : "Off"} />
            <Metric icon={<Clock3 />} label="Lighting mode" value={telemetry.night ? "Night" : "Day"} />
            <Metric icon={<ShieldCheck />} label="Access result" value={telemetry.accessStatus || "Not reported"} />
            <Metric icon={<Clock3 />} label="Last update" value={formatTime(lastUpdate)} />
          </div>
        ) : <div className="empty-state"><Radio size={26} /><p>Waiting for a telemetry message. Sensor state is not assumed.</p></div>}
      </section>
    </div>
  );
}

const DEMO_SCENARIOS = [
  ["fire", "FIRE · LAB", Flame],
  ["gas", "GAS / SMOKE · CANTEEN", Gauge],
  ["overheating", "OVERHEATING · LAB", Thermometer],
  ["high-crowd", "HIGH CROWD", Users],
  ["critical-crowd", "CRITICAL CROWD", Users],
  ["sos-lab", "LAB SOS", Siren],
  ["sos-canteen", "CANTEEN SOS", Siren],
  ["sos-parking", "PARKING SOS", Siren],
  ["authorized-access", "AUTHORIZED ACCESS", ShieldCheck],
  ["unauthorized-access", "UNAUTHORIZED ACCESS", ShieldAlert],
  ["night-mode", "NIGHT MODE", Clock3],
  ["night-intrusion", "NIGHT INTRUSION", AlertTriangle],
  ["sensor-failure", "SENSOR FAILURE", WifiOff],
  ["restore-sensors", "RESTORE SENSORS", Wifi],
  ["reset-system", "RESET SYSTEM", Activity]
];

export function DemoPage({ onRunScenario, pendingScenario, resultMessage }) {
  return (
    <div className="page-content">
      <PageHeading title="Demo / simulation" description="Send scenario telemetry through the same backend path used by the live dashboard." />
      <section className="panel demo-panel">
        <PanelHeading title="Simulation controls" subtitle="Actions call the telemetry or SOS API and are recorded by the backend" />
        <div className="demo-grid">
          {DEMO_SCENARIOS.map(([id, label, Icon]) => (
            <button
              className="demo-button"
              key={id}
              onClick={() => onRunScenario(id)}
              disabled={Boolean(pendingScenario)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {pendingScenario === id && <span className="button-pending">Sending</span>}
            </button>
          ))}
        </div>
        {resultMessage && <div className="inline-alert info-alert" role="status">{resultMessage}</div>}
        <p className="page-footnote">Reset sends normal telemetry to all six zones and restores sensor flags. Incident and access history remain in SQLite.</p>
      </section>
    </div>
  );
}

function PageHeading({ title, description }) {
  return <header className="page-heading"><h1>{title}</h1><p>{description}</p></header>;
}

function PanelHeading({ title, subtitle }) {
  return <div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>;
}

function Metric({ icon, label, value }) {
  return <div className="metric"><span className="metric-icon">{icon}</span><div><span className="metric-label">{label}</span><strong>{value}</strong></div></div>;
}

function SensorGrid({ sensorHealth }) {
  const healthMap = Object.fromEntries(sensorHealth.map((sensor) => [sensor.sensor_id, sensor.status]));
  return (
    <div className="sensor-grid">
      {SENSORS.map((sensor) => {
        const online = healthMap[sensor] === "ONLINE";
        return <div className="sensor-chip" key={sensor}><span>{sensor}</span><strong className={online ? "text-normal" : "text-offline"}>{online ? "ONLINE" : "OFFLINE"}</strong></div>;
      })}
    </div>
  );
}

function IncidentTable({ incidents, empty }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Timestamp</th><th>Zone</th><th>Type</th><th>Severity</th><th>Status</th><th>Recommended action</th></tr></thead>
        <tbody>
          {incidents.length ? incidents.map((incident) => (
            <tr key={incident.id}>
              <td>{formatTime(incident.timestamp)}</td>
              <td>{incident.zone_name || "Unknown zone"}</td>
              <td>{incident.type}</td>
              <td><SeverityBadge value={incident.severity} /></td>
              <td>{incident.status}</td>
              <td>{incident.recommended_action || "No action recorded"}</td>
            </tr>
          )) : <EmptyTableRow columns={6} text={empty} />}
        </tbody>
      </table>
    </div>
  );
}

function EmptyTableRow({ columns, text }) {
  return <tr><td colSpan={columns} className="empty-cell">{text}</td></tr>;
}

function ConditionList({ title, items, empty }) {
  return (
    <section className="condition-list">
      <h3>{title}</h3>
      {items.length ? items.map((item) => (
        <div className="condition-item" key={item.name}>
          <span>{item.name}</span>
          {item.detail && <small>{item.detail}</small>}
        </div>
      )) : <p className="muted-text">{empty}</p>}
    </section>
  );
}
