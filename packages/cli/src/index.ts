#!/usr/bin/env node

/**
 * ANYKPI CLI
 *
 * npx @anykpi/cli — query a local instance and ingest events.
 *
 * Commands:
 * - login / key     Generate API key
 * - keys            List keys or downgrade legacy write keys
 * - workspaces      List workspaces
 * - connect         Store connector credentials
 * - import          Import users or events from CSV
 * - export          Export users, events, and read models
 * - identify        Identify a user
 * - track           Track an event
 * - overview        Get company snapshot
 * - users           Query users
 * - cohorts         Get retention data
 * - wbr             Get WBR metrics
 * - calendar        Get calendar events
 * - sync            Trigger a connector sync
 */

import { createProgram } from "./program";

createProgram()
  .parseAsync(process.argv)
  .catch(() => {
    process.exitCode = 1;
  });
