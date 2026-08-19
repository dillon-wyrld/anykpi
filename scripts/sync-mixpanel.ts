#!/usr/bin/env tsx
import { syncMixpanel } from "../src/connectors/mixpanel";

const projectId = process.env.MIXPANEL_PROJECT_ID;
const apiSecret = process.env.MIXPANEL_API_SECRET;
const workspaceId = process.env.WORKSPACE_ID || "live";

if (!projectId || !apiSecret) {
  console.error("Error: MIXPANEL_PROJECT_ID and MIXPANEL_API_SECRET are required");
  process.exit(1);
}

console.log("Starting Mixpanel sync...");
syncMixpanel({ projectId, apiSecret, workspaceId })
  .then(() => {
    console.log("Mixpanel sync completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Mixpanel sync failed:", error);
    process.exit(1);
  });
