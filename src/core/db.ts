import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import { resolve } from "path";

const dbPath = process.env.DATABASE_PATH || resolve(process.cwd(), "data", "anykpi.db");

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

export function getDb() {
  return db;
}
