import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";

const dir = join(tmpdir(), "anykpi-vitest");
mkdirSync(dir, { recursive: true });
process.env.DATABASE_PATH = join(dir, `anykpi-${process.pid}.db`);
process.env.ANYKPI_SECRET ??= "vitest-anykpi-secret";

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
  CREATE TABLE IF NOT EXISTS metric_defs (
    metric_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    section TEXT NOT NULL,
    section_order TEXT NOT NULL,
    owner TEXT NOT NULL,
    type TEXT NOT NULL,
    unit TEXT,
    target REAL,
    good_dir TEXT NOT NULL,
    status TEXT NOT NULL,
    status_reason TEXT,
    workspace_id TEXT NOT NULL DEFAULT 'demo'
  );
  CREATE TABLE IF NOT EXISTS metric_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    value REAL,
    grain TEXT NOT NULL,
    workspace_id TEXT NOT NULL DEFAULT 'demo'
  );
  CREATE TABLE IF NOT EXISTS mrr_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period INTEGER NOT NULL,
    grain TEXT NOT NULL,
    mrr REAL NOT NULL,
    subscriber_count INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'demo',
    workspace_id TEXT NOT NULL DEFAULT 'demo'
  );
  CREATE UNIQUE INDEX IF NOT EXISTS mrr_snapshots_workspace_grain_period_uidx
    ON mrr_snapshots (workspace_id, grain, period);
  CREATE TABLE IF NOT EXISTS subscription_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id TEXT NOT NULL,
    account_id TEXT,
    event_type TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    mrr_delta REAL NOT NULL DEFAULT 0,
    plan TEXT,
    source TEXT NOT NULL DEFAULT 'demo',
    source_event_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL DEFAULT 'demo'
  );
  CREATE UNIQUE INDEX IF NOT EXISTS subscription_events_workspace_source_event_uidx
    ON subscription_events (workspace_id, source, source_event_id);
  CREATE TABLE IF NOT EXISTS person_revenue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id TEXT NOT NULL,
    account_id TEXT,
    status TEXT NOT NULL,
    plan TEXT,
    mrr REAL NOT NULL DEFAULT 0,
    ltv REAL NOT NULL DEFAULT 0,
    first_paid_at INTEGER,
    last_charge_at INTEGER,
    charge_count INTEGER NOT NULL DEFAULT 0,
    last_charge_amount REAL,
    currency TEXT NOT NULL DEFAULT 'usd',
    source TEXT NOT NULL DEFAULT 'demo',
    workspace_id TEXT NOT NULL DEFAULT 'demo'
  );
  CREATE UNIQUE INDEX IF NOT EXISTS person_revenue_workspace_person_uidx
    ON person_revenue (workspace_id, person_id);
  CREATE TABLE IF NOT EXISTS balance_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    as_of INTEGER NOT NULL,
    cash_balance REAL NOT NULL,
    monthly_burn REAL NOT NULL,
    runway_months REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'demo',
    workspace_id TEXT NOT NULL DEFAULT 'demo'
  );
  CREATE UNIQUE INDEX IF NOT EXISTS balance_snapshots_workspace_as_of_uidx
    ON balance_snapshots (workspace_id, as_of);
  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL DEFAULT 'live',
    source TEXT NOT NULL,
    config TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sources_workspace_source_uidx
    ON sources (workspace_id, source);
  CREATE TABLE IF NOT EXISTS cal_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_color TEXT NOT NULL,
    type TEXT NOT NULL,
    emoji TEXT NOT NULL,
    title TEXT NOT NULL,
    badge TEXT NOT NULL,
    event_date INTEGER NOT NULL,
    is_future INTEGER DEFAULT 0,
    workspace_id TEXT NOT NULL DEFAULT 'demo'
  );
`);
sqlite.close();
