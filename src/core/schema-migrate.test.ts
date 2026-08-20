import { describe, expect, it } from "vitest";
import { join, resolve } from "path";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import * as sqliteSchema from "./schema";
import {
  applySqliteMigrations,
  migrationsDirFor,
  migrationSqlFiles,
  splitStatements,
} from "../../scripts/docker-entrypoint.mjs";
import { catalogTableNames, declaredTableCatalog } from "./schema-catalog";

const root = resolve(__dirname, "../..");
const expected = declaredTableCatalog(sqliteSchema);
const expectedTables = catalogTableNames(expected);

function sqliteCatalog(db: Database.Database) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__%'"
    )
    .all() as { name: string }[];
  const catalog: Record<string, string[]> = {};
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info(${name})`).all() as {
      name: string;
    }[];
    catalog[name] = cols.map((col) => col.name).sort();
  }
  return catalog;
}

async function pgCatalog(client: PGlite) {
  const tables = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  const catalog: Record<string, string[]> = {};
  for (const { table_name } of tables.rows) {
    const cols = await client.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
    `,
      [table_name]
    );
    catalog[table_name] = cols.rows.map((col) => col.column_name).sort();
  }
  return catalog;
}

describe("core schema migrations apply on both engines", () => {
  it("applies drizzle/sqlite onto SQLite with the declared tables and columns", () => {
    const dir = mkdtempSync(join(tmpdir(), "anykpi-schema-sqlite-"));
    const dbPath = join(dir, "anykpi.db");
    applySqliteMigrations(dbPath, migrationsDirFor({}, root));
    const db = new Database(dbPath);
    try {
      const catalog = sqliteCatalog(db);
      expect(Object.keys(catalog).sort()).toEqual(
        expect.arrayContaining(expectedTables)
      );
      for (const table of expectedTables) {
        expect(catalog[table], table).toEqual(expected[table]);
      }
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies drizzle/pg onto Postgres with the declared tables and columns", async () => {
    const client = new PGlite();
    const dir = migrationsDirFor({ DATABASE_URL: "postgres://localhost/anykpi" }, root);
    for (const file of migrationSqlFiles(dir)) {
      const sql = readFileSync(join(dir, file), "utf8");
      for (const stmt of splitStatements(sql)) {
        await client.exec(stmt);
      }
    }
    const catalog = await pgCatalog(client);
    expect(Object.keys(catalog).sort()).toEqual(
      expect.arrayContaining(expectedTables)
    );
    for (const table of expectedTables) {
      expect(catalog[table], table).toEqual(expected[table]);
    }
    await client.close();
  });
});
