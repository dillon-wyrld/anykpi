#!/usr/bin/env tsx
import { syncAmplitude } from "../src/connectors/amplitude";

const apiKey = process.env.AMPLITUDE_API_KEY;
const secretKey = process.env.AMPLITUDE_SECRET_KEY;
const workspaceId = process.env.WORKSPACE_ID || "live";

if (!apiKey || !secretKey) {
  console.error("Error: AMPLITUDE_API_KEY and AMPLITUDE_SECRET_KEY are required");
  process.exit(1);
}

console.log("Starting Amplitude sync...");
syncAmplitude({ apiKey, secretKey, workspaceId })
  .then(() => {
    console.log("Amplitude sync completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Amplitude sync failed:", error);
    process.exit(1);
  });
