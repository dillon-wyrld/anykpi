#!/usr/bin/env node
/**
 * Container entrypoint: ensure the schema exists, then start the server.
 *
 * The standalone Next server does not run migrations, so a fresh volume
 * (or a fresh Postgres database) would open without tables. This applies
 * the committed drizzle migration(s) once — SQLite via `DATABASE_PATH`
 * (zero-config default) or Postgres when `DATABASE_URL` is a
 * postgres:// URL — then hands off to the Next standalone server.
 */
import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

export function isPostgresUrl(url) {
  return typeof url === "string" && /^(postgres|postgresql):\/\//i.test(url.trim());
}

export function migrationsDirFor(env = process.env, cwd = process.cwd()) {
  const dialect = isPostgresUrl(env.DATABASE_URL) ? "pg" : "sqlite";
  return resolve(cwd, "drizzle", dialect);
}

export function migrationSqlFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function splitStatements(sql) {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function applySqliteMigrations(dbPath, migrationsDir) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    .get();
  if (row) {
    console.log("[anykpi] Existing schema detected; skipping initialization.");
    db.close();
    return;
  }

  if (!existsSync(migrationsDir)) {
    console.error("[anykpi] No drizzle/sqlite migrations found in image; cannot initialize schema.");
    db.close();
    process.exit(1);
  }
  const files = migrationSqlFiles(migrationsDir);
  console.log(`[anykpi] Initializing SQLite schema from ${files.length} migration(s)...`);
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const statements = splitStatements(sql);
    const tx = db.transaction(() => {
      for (const stmt of statements) db.exec(stmt);
    });
    tx();
  }
  console.log("[anykpi] Schema ready.");
  db.close();
}

export async function applyPostgresMigrations(databaseUrl, migrationsDir) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const tables = await sql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'users'
    `;
    if (tables.length > 0) {
      console.log("[anykpi] Existing schema detected; skipping initialization.");
      return;
    }

    if (!existsSync(migrationsDir)) {
      console.error("[anykpi] No drizzle/pg migrations found in image; cannot initialize schema.");
      process.exit(1);
    }
    const files = migrationSqlFiles(migrationsDir);
    console.log(`[anykpi] Initializing Postgres schema from ${files.length} migration(s)...`);
    for (const file of files) {
      const text = readFileSync(join(migrationsDir, file), "utf8");
      for (const stmt of splitStatements(text)) {
        await sql.unsafe(stmt);
      }
    }
    console.log("[anykpi] Schema ready.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function initializeSchema(env = process.env, cwd = process.cwd()) {
  const migrationsDir = migrationsDirFor(env, cwd);
  if (isPostgresUrl(env.DATABASE_URL)) {
    await applyPostgresMigrations(env.DATABASE_URL, migrationsDir);
    return;
  }
  const dbPath = env.DATABASE_PATH || "/data/anykpi.db";
  applySqliteMigrations(dbPath, migrationsDir);
}

function invokedDirectly() {
  const self = fileURLToPath(import.meta.url);
  const argv1 = process.argv[1] ? resolve(process.argv[1]) : "";
  return self === argv1;
}

async function main() {
  await initializeSchema();
  const child = spawn("node", ["server.js"], { stdio: "inherit", env: process.env });
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));
  child.on("exit", (code) => process.exit(code ?? 0));
}

if (invokedDirectly()) {
  main().catch((error) => {
    console.error("[anykpi] Failed to initialize schema:", error);
    process.exit(1);
  });
}
