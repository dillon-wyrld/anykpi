import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import Database from "better-sqlite3";
import postgres from "postgres";
import { chmodSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { isPostgresUrl, sqlEngine, TEST_DB_GLOBAL } from "./dialect";
import { installQueryCompat } from "./query-compat";
import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

const dbPath =
  process.env.DATABASE_PATH || resolve(process.cwd(), "data", "anykpi.db");

function restrictDbFileMode(path: string) {
  try {
    if (existsSync(path)) {
      chmodSync(path, 0o600);
    }
  } catch {
    // Best-effort; some filesystems ignore chmod
  }
}

function tablePkColumns(sqlite: Database.Database, table: string): string[] {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
    pk: number;
  }[];
  return cols
    .filter((col) => col.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((col) => col.name);
}

function rebuildTable(
  sqlite: Database.Database,
  table: string,
  createSql: string,
  columns: string[],
  indexSql = ""
) {
  const quoted = columns.map((col) => `"${col}"`).join(", ");
  sqlite.exec(`
    PRAGMA foreign_keys=OFF;
    ${createSql}
    INSERT INTO "__new_${table}" (${quoted}) SELECT ${quoted} FROM "${table}";
    DROP TABLE "${table}";
    ALTER TABLE "__new_${table}" RENAME TO "${table}";
    ${indexSql}
    PRAGMA foreign_keys=ON;
  `);
}

function ensureApiKeyWorkspaceColumn(sqlite: Database.Database) {
  try {
    const cols = sqlite.prepare("PRAGMA table_info(api_keys)").all() as {
      name: string;
    }[];
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

function ensureActivityExternalId(sqlite: Database.Database) {
  try {
    const cols = sqlite.prepare("PRAGMA table_info(activity)").all() as {
      name: string;
    }[];
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

function ensureUsersTimezone(sqlite: Database.Database) {
  try {
    const cols = sqlite.prepare("PRAGMA table_info(users)").all() as {
      name: string;
    }[];
    if (cols.length === 0) return;
    if (!cols.some((c) => c.name === "timezone")) {
      sqlite.exec("ALTER TABLE users ADD COLUMN timezone TEXT");
    }
  } catch {
    // Table may not exist until db:init / drizzle push
  }
}

function ensureTombstones(sqlite: Database.Database) {
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tombstones (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        workspace_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tombstones_workspace_idx
        ON tombstones (workspace_id);
      CREATE UNIQUE INDEX IF NOT EXISTS tombstones_workspace_external_uidx
        ON tombstones (workspace_id, external_id);
    `);
  } catch {
    // Table may not exist until db:init / drizzle push
  }
}

function ensureWorkspaceIsolation(sqlite: Database.Database) {
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        archived_at INTEGER
      );
    `);
    const now = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)"
      )
      .run("demo", "Demo", now);
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)"
      )
      .run("live", "Live", now);

    const usersPk = tablePkColumns(sqlite, "users");
    if (usersPk.length > 0 && usersPk.join(",") !== "workspace_id,person_id") {
      rebuildTable(
        sqlite,
        "users",
        `CREATE TABLE "__new_users" (
          person_id TEXT NOT NULL,
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
          workspace_id TEXT NOT NULL DEFAULT 'demo',
          PRIMARY KEY (workspace_id, person_id)
        );`,
        [
          "person_id",
          "name",
          "email",
          "avatar",
          "emoji",
          "platform",
          "country",
          "income_band",
          "traits",
          "signup_date",
          "cluster",
          "account_id",
          "workspace_id",
        ],
        "CREATE INDEX IF NOT EXISTS users_workspace_idx ON users (workspace_id);"
      );
    }

    const accountsPk = tablePkColumns(sqlite, "accounts");
    if (
      accountsPk.length > 0 &&
      accountsPk.join(",") !== "workspace_id,account_id"
    ) {
      rebuildTable(
        sqlite,
        "accounts",
        `CREATE TABLE "__new_accounts" (
          account_id TEXT NOT NULL,
          name TEXT NOT NULL,
          entity TEXT,
          seats INTEGER DEFAULT 0,
          activated INTEGER DEFAULT 0,
          mrr REAL DEFAULT 0,
          renewal_date INTEGER,
          workspace_id TEXT NOT NULL DEFAULT 'demo',
          PRIMARY KEY (workspace_id, account_id)
        );`,
        [
          "account_id",
          "name",
          "entity",
          "seats",
          "activated",
          "mrr",
          "renewal_date",
          "workspace_id",
        ],
        "CREATE INDEX IF NOT EXISTS accounts_workspace_idx ON accounts (workspace_id);"
      );
    }

    const metricPk = tablePkColumns(sqlite, "metric_defs");
    if (metricPk.length > 0 && metricPk.join(",") !== "workspace_id,metric_id") {
      rebuildTable(
        sqlite,
        "metric_defs",
        `CREATE TABLE "__new_metric_defs" (
          metric_id TEXT NOT NULL,
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
          workspace_id TEXT NOT NULL DEFAULT 'demo',
          PRIMARY KEY (workspace_id, metric_id)
        );`,
        [
          "metric_id",
          "name",
          "section",
          "section_order",
          "owner",
          "type",
          "unit",
          "target",
          "good_dir",
          "status",
          "status_reason",
          "workspace_id",
        ],
        "CREATE INDEX IF NOT EXISTS metric_defs_workspace_idx ON metric_defs (workspace_id);"
      );
    }

    const configPk = tablePkColumns(sqlite, "config");
    if (configPk.length > 0 && configPk.join(",") !== "workspace_id,key") {
      sqlite.exec("DROP INDEX IF EXISTS config_key_workspace_uidx;");
      rebuildTable(
        sqlite,
        "config",
        `CREATE TABLE "__new_config" (
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          workspace_id TEXT NOT NULL DEFAULT 'demo',
          PRIMARY KEY (workspace_id, key)
        );`,
        ["key", "value", "workspace_id"],
        "CREATE INDEX IF NOT EXISTS config_workspace_idx ON config (workspace_id);"
      );
    }

    sqlite.exec(`
      INSERT OR IGNORE INTO workspaces (id, name, created_at)
      SELECT workspace_id, workspace_id, ${now}
      FROM (
        SELECT workspace_id FROM users
        UNION SELECT workspace_id FROM accounts
        UNION SELECT workspace_id FROM metric_defs
        UNION SELECT workspace_id FROM config
        UNION SELECT workspace_id FROM api_keys
      )
      WHERE workspace_id IS NOT NULL;
    `);
  } catch {
    // Tables may not exist until db:init / drizzle push
  }
}

function openSqlite(): AppDatabase {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath, { timeout: 5000 });
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  restrictDbFileMode(dbPath);
  restrictDbFileMode(`${dbPath}-wal`);
  restrictDbFileMode(`${dbPath}-shm`);
  ensureApiKeyWorkspaceColumn(sqlite);
  ensureActivityExternalId(sqlite);
  ensureTombstones(sqlite);
  ensureWorkspaceIsolation(sqlite);
  ensureUsersTimezone(sqlite);
  return drizzle(sqlite, { schema });
}

function openPostgres(): AppDatabase {
  const url = process.env.DATABASE_URL;
  if (!url || !isPostgresUrl(url)) {
    throw new Error(
      "Postgres requires DATABASE_URL (postgres://). Unit tests inject PGlite via vitest.setup."
    );
  }
  // Dashboard fan-out (overview + freshness + day clock + the
  // active view) needs more than a handful of connections. 8
  // deadlocked postgres e2e when WBR started loading event rows.
  const client = postgres(url, { max: 24 });
  const postgresDb = drizzlePostgres(client, { schema }) as unknown as AppDatabase;
  installQueryCompat(postgresDb);
  return postgresDb;
}

function createDb(): AppDatabase {
  const injected = (globalThis as Record<string, unknown>)[TEST_DB_GLOBAL];
  if (injected) return injected as AppDatabase;
  if (sqlEngine() === "postgres") return openPostgres();
  return openSqlite();
}

export const db = createDb();

export function getDb() {
  return db;
}

export function getSqlitePath() {
  return dbPath;
}
