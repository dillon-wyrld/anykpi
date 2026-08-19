import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import { chmodSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

const dbPath = process.env.DATABASE_PATH || resolve(process.cwd(), "data", "anykpi.db");

// Ensure the parent directory exists before better-sqlite3 opens the file.
// db.ts is imported at build time (page-data collection) and by scripts/init-db
// before it creates its own dir, so a fresh clone or fresh Docker volume would
// otherwise crash with "Cannot open database because the directory does not exist".
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath, { timeout: 5000 });
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("journal_mode = WAL");

function restrictDbFileMode(path: string) {
  try {
    if (existsSync(path)) {
      chmodSync(path, 0o600);
    }
  } catch {
    // Best-effort; some filesystems ignore chmod
  }
}

restrictDbFileMode(dbPath);
restrictDbFileMode(`${dbPath}-wal`);
restrictDbFileMode(`${dbPath}-shm`);

function ensureApiKeyWorkspaceColumn() {
  try {
    const cols = sqlite.prepare("PRAGMA table_info(api_keys)").all() as { name: string }[];
    if (cols.length === 0) return;
    if (!cols.some((c) => c.name === "workspace_id")) {
      sqlite.exec(
        "ALTER TABLE api_keys ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'live'"
      );
    }
    if (!cols.some((c) => c.name === "scope")) {
      sqlite.exec(
        "ALTER TABLE api_keys ADD COLUMN scope TEXT NOT NULL DEFAULT 'write'"
      );
    }
    if (!cols.some((c) => c.name === "legacy")) {
      sqlite.exec(
        "ALTER TABLE api_keys ADD COLUMN legacy INTEGER NOT NULL DEFAULT 1"
      );
    }
  } catch {
    // Table may not exist until db:init / drizzle push
  }
}

function ensureActivityExternalId() {
  try {
    const cols = sqlite.prepare("PRAGMA table_info(activity)").all() as { name: string }[];
    if (cols.length === 0) return;
    if (!cols.some((c) => c.name === "external_id")) {
      sqlite.exec("ALTER TABLE activity ADD COLUMN external_id TEXT");
    }
    sqlite.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS activity_workspace_external_id_uidx ON activity (workspace_id, external_id)"
    );
  } catch {
    // Table may not exist until db:init / drizzle push
  }
}

ensureApiKeyWorkspaceColumn();
ensureActivityExternalId();

export const db = drizzle(sqlite, { schema });

export function getDb() {
  return db;
}

export function getSqlitePath() {
  return dbPath;
}
