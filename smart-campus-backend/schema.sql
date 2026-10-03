PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'NORMAL',
    crowd_level TEXT NOT NULL DEFAULT 'LOW',
    occupancy INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sensor_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id TEXT NOT NULL,
    zone_id INTEGER,
    type TEXT NOT NULL,
    value REAL,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (zone_id) REFERENCES zones(id)
);

CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id INTEGER,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    recommended_action TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (zone_id) REFERENCES zones(id)
);

CREATE TABLE IF NOT EXISTS sos_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    timestamp TEXT NOT NULL,
    FOREIGN KEY (zone_id) REFERENCES zones(id)
);

CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id INTEGER NOT NULL,
    user_name TEXT,
    fingerprint_id INTEGER,
    access_status TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (zone_id) REFERENCES zones(id)
);

CREATE TABLE IF NOT EXISTS sensor_health (
    sensor_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'ONLINE',
    last_heartbeat TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS route_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_zone TEXT NOT NULL,
    destination_zone TEXT NOT NULL,
    route TEXT NOT NULL,
    total_cost REAL NOT NULL,
    timestamp TEXT NOT NULL
);
