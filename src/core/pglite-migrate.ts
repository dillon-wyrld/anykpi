import { readFileSync } from "fs";
import { join } from "path";
import type { PGlite } from "@electric-sql/pglite";
import {
  migrationsDirFor,
  migrationSqlFiles,
  splitStatements,
} from "../../scripts/docker-entrypoint.mjs";

/** Apply committed drizzle/pg SQL onto an in-process PGlite, then seed catalog rows. */
export async function applyPgliteMigrations(
  client: PGlite,
  cwd = process.cwd()
): Promise<void> {
  const dir = migrationsDirFor(
    { DATABASE_URL: "postgres://localhost/anykpi" },
    cwd
  );
  for (const file of migrationSqlFiles(dir)) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const stmt of splitStatements(text)) {
      await client.exec(stmt);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  await client.exec(`
    INSERT INTO workspaces (id, name, created_at) VALUES
      ('demo', 'Demo', ${now}),
      ('live', 'Live', ${now})
    ON CONFLICT (id) DO NOTHING
  `);
}
