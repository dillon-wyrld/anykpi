#!/usr/bin/env node

/**
 * ANYKPI CLI
 *
 * npx @anykpi/cli — query a local instance and ingest events.
 *
 * Commands:
 * - login / key     Generate API key
 * - workspaces      List workspaces
 * - connect         Store connector credentials
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
