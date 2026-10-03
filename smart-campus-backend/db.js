const sqlite = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const { DatabaseSync } = sqlite;

const dbPath = path.join(__dirname, "smart_campus.db");
const schemaPath = path.join(__dirname, "schema.sql");

const db = new DatabaseSync(dbPath, {
  enableForeignKeyConstraints: true
});

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function initDatabase() {
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);

  const zones = [
    [1, "LAB"],
    [2, "CLASSROOM"],
    [3, "SECURITY CENTER"],
    [4, "CANTEEN"],
    [5, "PARKING"],
    [6, "MAIN GATE"]
  ];

  for (const [id, name] of zones) {
    db.prepare(
      `INSERT OR IGNORE INTO zones (id, name) VALUES (?, ?)`
    ).run(id, name);
  }
}

module.exports = { db, run, all, get, initDatabase };
