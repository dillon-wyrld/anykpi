import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import * as sqliteSchema from "./schema";
import * as pgSchema from "./schema.pg";
import { catalogTableNames, declaredTableCatalog } from "./schema-catalog";

const root = resolve(__dirname, "../..");

describe("schema drift (sqlite-core vs pg-core)", () => {
  it("declares identical tables and columns on both dialects", () => {
    const sqlite = declaredTableCatalog(sqliteSchema);
    const pg = declaredTableCatalog(pgSchema);

    expect(catalogTableNames(pg)).toEqual(catalogTableNames(sqlite));
    for (const table of catalogTableNames(sqlite)) {
      expect(pg[table], table).toEqual(sqlite[table]);
    }
  });

  it("keeps per-dialect journals under drizzle/sqlite and drizzle/pg", () => {
    const sqliteJournal = resolve(root, "drizzle/sqlite/meta/_journal.json");
    const pgJournal = resolve(root, "drizzle/pg/meta/_journal.json");
    expect(existsSync(sqliteJournal)).toBe(true);
    expect(existsSync(pgJournal)).toBe(true);

    const sqlite = JSON.parse(readFileSync(sqliteJournal, "utf8")) as {
      dialect: string;
      entries: Array<{ tag: string }>;
    };
    const pg = JSON.parse(readFileSync(pgJournal, "utf8")) as {
      dialect: string;
    };
    expect(sqlite.dialect).toBe("sqlite");
    expect(pg.dialect).toBe("postgresql");
    expect(sqlite.entries.map((entry) => entry.tag)).toEqual([
      "0000_youthful_medusa",
      "0001_cultured_kronos",
      "0002_revenue_read_models",
      "0003_sources",
      "0004_activity_external_id",
      "0005_api_key_scopes",
      "0006_audit_log",
      "0007_outreach",
      "0008_tombstones",
      "0009_workspaces",
      "0010_user_timezone",
      "0011_source_paused",
    ]);
    expect(existsSync(resolve(root, "drizzle/meta/_journal.json"))).toBe(false);
  });

  it("ships SQL migrations for both engines", () => {
    const sqliteSql = readdirSync(resolve(root, "drizzle/sqlite")).filter((f) =>
      f.endsWith(".sql")
    );
    const pgSql = readdirSync(resolve(root, "drizzle/pg")).filter((f) =>
      f.endsWith(".sql")
    );
    expect(sqliteSql.length).toBeGreaterThan(0);
    expect(pgSql.length).toBeGreaterThan(0);
  });
});
