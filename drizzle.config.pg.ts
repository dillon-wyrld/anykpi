import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/core/schema.pg.ts",
  out: "./drizzle/pg",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://localhost:5432/anykpi",
  },
});
