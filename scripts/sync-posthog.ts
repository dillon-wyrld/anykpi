#!/usr/bin/env tsx
import { syncPostHog } from "../src/connectors/posthog";

const apiKey = process.env.POSTHOG_API_KEY;
const projectId = process.env.POSTHOG_PROJECT_ID || "default";
const workspaceId = process.env.WORKSPACE_ID || "live";

if (!apiKey) {
  console.error("Error: POSTHOG_API_KEY environment variable is required");
  process.exit(1);
}

console.log("Starting PostHog sync...");
syncPostHog({ apiKey, projectId, workspaceId })
  .then(() => {
    console.log("PostHog sync completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("PostHog sync failed:", error);
    process.exit(1);
  });
