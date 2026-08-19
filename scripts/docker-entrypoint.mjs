#!/usr/bin/env node
/**
 * Container entrypoint: ensure the SQLite schema exists, then start the server.
 *
 * The standalone Next server does not run migrations, so a fresh volume would
 * open an empty, schema-less database and every route would fail. This applies
 * the committed drizzle migration(s) once, using better-sqlite3 (already present
 * in the runtime image) — no dev dependencies required — then hands off to the
 * Next standalone server.
 */
import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { spawn } from "child_process";

const dbPath = process.env.DATABASE_PATH || "/data/anykpi.db";
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

function schemaExists() {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    .get();
  return !!row;
}

if (!schemaExists()) {
  const migrationsDir = resolve(process.cwd(), "drizzle");
  if (!existsSync(migrationsDir)) {
    console.error("[anykpi] No drizzle/ migrations found in image; cannot initialize schema.");
    process.exit(1);
  }
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`[anykpi] Initializing database schema from ${files.length} migration(s)...`);
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    const tx = db.transaction(() => {
      for (const stmt of statements) db.exec(stmt);
    });
    tx();
  }
  console.log("[anykpi] Schema ready.");
} else {
  console.log("[anykpi] Existing schema detected; skipping initialization.");
}

db.close();

// Hand off to the Next standalone server, forwarding signals.
const child = spawn("node", ["server.js"], { stdio: "inherit", env: process.env });
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("exit", (code) => process.exit(code ?? 0));
