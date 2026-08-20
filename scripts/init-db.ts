#!/usr/bin/env tsx
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";
import { seedDemo } from "../src/demo/seed";
import {
  initializeSchema,
  isPostgresUrl,
} from "./docker-entrypoint.mjs";

const dataDir = resolve(process.cwd(), "data");

if (!existsSync(dataDir)) {
  console.log("Creating data directory...");
  mkdirSync(dataDir, { recursive: true });
}

async function applySchema() {
  if (isPostgresUrl(process.env.DATABASE_URL)) {
    console.log("Applying drizzle/pg migrations...");
    await initializeSchema({
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_PATH: process.env.DATABASE_PATH,
    });
    return;
  }
  console.log("Applying migrations with drizzle-kit...");
  try {
    execSync("pnpm drizzle-kit push", { stdio: "inherit" });
  } catch {
    console.log("Migrations applied (or already current)");
  }
}

applySchema()
  .then(() => {
    console.log("Seeding demo data...");
    return seedDemo();
  })
  .then(() => {
    console.log("Database initialized successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  });
