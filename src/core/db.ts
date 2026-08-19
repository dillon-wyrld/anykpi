import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import { chmodSync, existsSync } from "fs";
import { resolve } from "path";

const dbPath = process.env.DATABASE_PATH || resolve(process.cwd(), "data", "anykpi.db");

const sqlite = new Database(dbPath);
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
  } catch {
    // Table may not exist until db:init / drizzle push
  }
}

ensureApiKeyWorkspaceColumn();

export const db = drizzle(sqlite, { schema });

export function getDb() {
  return db;
}

export function getSqlitePath() {
  return dbPath;
}
