#!/usr/bin/env tsx
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";
import { seedDemo } from "../src/demo/seed";

const dataDir = resolve(process.cwd(), "data");

if (!existsSync(dataDir)) {
  console.log("Creating data directory...");
  mkdirSync(dataDir, { recursive: true });
}

console.log("Applying migrations with drizzle-kit...");
try {
  execSync("pnpm drizzle-kit push", { stdio: "inherit" });
} catch (error) {
  console.log("Migrations applied (or already current)");
}

console.log("Seeding demo data...");
try {
  seedDemo();
  console.log("Database initialized successfully!");
  process.exit(0);
} catch (error) {
  console.error("Failed to seed demo data:", error);
  process.exit(1);
}
