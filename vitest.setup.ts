import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";

const dir = join(tmpdir(), "anykpi-vitest");
mkdirSync(dir, { recursive: true });
process.env.DATABASE_PATH = join(dir, `anykpi-${process.pid}.db`);

const sqlite = new Database(process.env.DATABASE_PATH);
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    person_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    avatar TEXT,
    emoji TEXT,
    platform TEXT,
    country TEXT,
    income_band TEXT,
    traits TEXT,
    signup_date INTEGER,
    cluster TEXT,
    account_id TEXT,
    workspace_id TEXT NOT NULL DEFAULT 'demo'
  );
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    event_name TEXT NOT NULL,
    event_class TEXT NOT NULL,
    platform TEXT,
    workspace_id TEXT NOT NULL DEFAULT 'demo'
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    hashed_key TEXT NOT NULL,
    name TEXT NOT NULL,
    workspace_id TEXT NOT NULL DEFAULT 'live',
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_name TEXT NOT NULL,
    last_sync INTEGER,
    status TEXT NOT NULL,
    error TEXT,
    workspace_id TEXT NOT NULL DEFAULT 'demo'
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sync_state_workspace_source_uidx
    ON sync_state (workspace_id, source);
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    workspace_id TEXT NOT NULL DEFAULT 'demo'
  );
  CREATE UNIQUE INDEX IF NOT EXISTS config_key_workspace_uidx
    ON config (key, workspace_id);
`);
sqlite.close();
