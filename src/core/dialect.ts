/**
 * SQL engine selection.
 *
 * SQLite via DATABASE_PATH is the zero-config default. Postgres is used
 * when DATABASE_URL is a postgres:// URL (production / e2e) or when
 * ANYKPI_DB_ENGINE=postgres (unit tests inject PGlite).
 */

export type SqlEngine = "sqlite" | "postgres";

/** Set on globalThis by vitest.setup so db.ts never imports PGlite. */
export const TEST_DB_GLOBAL = "__ANYKPI_TEST_DB__";

export function isPostgresUrl(url: string | undefined): boolean {
  return typeof url === "string" && /^(postgres|postgresql):\/\//i.test(url.trim());
}

export type EnvLike = {
  DATABASE_URL?: string;
  DATABASE_PATH?: string;
  ANYKPI_DB_ENGINE?: string;
};

export function sqlEngine(env: EnvLike = process.env as EnvLike): SqlEngine {
  if (isPostgresUrl(env.DATABASE_URL)) return "postgres";
  const forced = env.ANYKPI_DB_ENGINE?.trim().toLowerCase();
  if (forced === "postgres" || forced === "postgresql") return "postgres";
  return "sqlite";
}

