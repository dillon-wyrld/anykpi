import { sql } from "drizzle-orm";
import { QueryPromise } from "drizzle-orm/query-promise";
import { sqlEngine } from "./dialect";
import type { AppDatabase } from "./db";
import * as schema from "./schema";

type CompatQuery = {
  all?: () => unknown;
  get?: () => unknown;
  run?: () => unknown;
};

function addCompat(proto: object): void {
  const target = proto as CompatQuery;
  if (typeof target.all !== "function") {
    target.all = function all(this: PromiseLike<unknown>) {
      return this;
    };
  }
  if (typeof target.get !== "function") {
    target.get = async function get(this: PromiseLike<unknown>) {
      const result = await this;
      return Array.isArray(result) ? result[0] : result;
    };
  }
  if (typeof target.run !== "function") {
    target.run = function run(this: PromiseLike<unknown>) {
      return this;
    };
  }
}

/**
 * Postgres drizzle queries are thenable and have no .all() / .get() / .run().
 * Patch QueryPromise and the live builder prototypes (mixin copies methods
 * at import time, so QueryPromise alone is not enough).
 */
export function installQueryCompat(db?: AppDatabase): void {
  addCompat(QueryPromise.prototype);
  if (!db) return;
  addCompat(Object.getPrototypeOf(db.select().from(schema.users)));
  addCompat(Object.getPrototypeOf(db.insert(schema.users)));
  addCompat(Object.getPrototypeOf(db.update(schema.users)));
  addCompat(Object.getPrototypeOf(db.delete(schema.users)));
}

/** ON CONFLICT alias shared by SQLite and Postgres (case-insensitive). */
export function excluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

type AppTx = {
  insert: AppDatabase["insert"];
};

/**
 * SQLite drizzle transactions are synchronous; Postgres ones are async.
 */
export async function writeInTransaction(
  database: AppDatabase,
  sqliteWork: (tx: AppTx) => void,
  postgresWork: (tx: AppTx) => Promise<void>
): Promise<void> {
  if (sqlEngine() === "sqlite") {
    database.transaction(sqliteWork as Parameters<AppDatabase["transaction"]>[0]);
    return;
  }
  await (
    database.transaction as unknown as (
      fn: (tx: AppTx) => Promise<void>
    ) => Promise<void>
  )(postgresWork);
}
