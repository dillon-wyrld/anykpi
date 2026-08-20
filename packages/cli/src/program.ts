import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { apiRequest, INGEST_EVENT_PATH, INGEST_IDENTIFY_PATH } from "./api";
import { configFile, loadConfig, saveConfig } from "./config";

export const PUBLISHED_COMMANDS = [
  "login",
  "workspaces",
  "connect",
  "import",
  "export",
  "identify",
  "track",
  "overview",
  "users",
  "cohorts",
  "wbr",
  "calendar",
  "sync",
  "outreach",
  "keys",
] as const;

function workspaceOf(options: { workspace?: string }): string {
  return options.workspace || loadConfig().workspace || "demo";
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("anykpi")
    .description("ANYKPI CLI — query a local instance and ingest events")
    .version("0.1.0");

  program
    .command("login")
    .alias("key")
    .description("Generate API key for agent access")
    .option("--url <url>", "ANYKPI instance URL", "http://localhost:3000")
    .option("--key <key>", "Existing ANYKPI_API_KEY (or set the env var)")
    .option("--name <name>", "API key name (skip the prompt)")
    .option("--workspace <workspace>", "Workspace to bind the minted key to", "demo")
    .option("--scope <scope>", "Key scope: read (default), write, or admin", "read")
    .action(async (options) => {
      const spinner = ora("Connecting to ANYKPI...").start();

      try {
        const adminKey = options.key || process.env.ANYKPI_API_KEY;
        let name: string | undefined = options.name;

        if (!name) {
          spinner.stop();
          if (!process.stdin.isTTY) {
            throw new Error("Pass --name to mint a key non-interactively");
          }
          const answered = await prompts({
            type: "text",
            name: "name",
            message: 'API key name (e.g., "My Agent")',
            initial: "CLI Key",
          });
          name = answered.name;
          spinner.start();
        }

        if (!name) {
          spinner.fail("Cancelled");
          return;
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (adminKey) {
          headers.Authorization = `Bearer ${adminKey}`;
          headers["x-api-key"] = adminKey;
        }

        const scope = String(options.scope || "read").toLowerCase();
        if (scope !== "read" && scope !== "write" && scope !== "admin") {
          throw new Error("scope must be read, write, or admin");
        }

        const response = await fetch(`${options.url}/api/v1/keys`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name, workspace: options.workspace, scope }),
        });

        const data = (await response.json()) as {
          error?: string;
          key?: string;
          id?: string;
          scope?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || "Failed to create API key");
        }

        const config = loadConfig();
        config.apiUrl = options.url;
        config.apiKey = data.key;
        config.workspace = options.workspace;
        saveConfig(config);

        spinner.succeed("API key created and saved");
        console.log();
        console.log(chalk.green("✓"), "Key ID:", chalk.bold(data.id));
        console.log(chalk.green("✓"), "Scope:", chalk.bold(data.scope || scope));
        console.log(chalk.green("✓"), "Saved to:", chalk.dim(configFile()));
        console.log();
        console.log(
          chalk.dim("Your key is stored locally. Run"),
          chalk.bold("anykpi overview"),
          chalk.dim("to test.")
        );
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("workspaces")
    .alias("ws")
    .description("List workspaces")
    .action(() => {
      const config = loadConfig();
      console.log();
      console.log(chalk.bold("Workspaces:"));
      console.log();
      console.log("  demo", config.workspace === "demo" ? chalk.green("(current)") : "");
      console.log("  live", config.workspace === "live" ? chalk.green("(current)") : "");
      console.log();
      console.log(chalk.dim("Use --workspace flag to switch"));
    });

  program
    .command("connect <source>")
    .description("Store source credentials")
    .option("--workspace <workspace>", "Workspace")
    .option("--api-key <key>", "Source API key")
    .option("--project-id <id>", "Source project ID")
    .option("--host <host>", "Source host")
    .option("--api-secret <secret>", "Source API secret")
    .option("--secret-key <key>", "Source secret key")
    .option("--kind <kind>", "CSV kind (users or events)")
    .option(
      "--map <column=field>",
      "CSV column mapping (repeatable)",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[]
    )
    .option("--json", "Output as JSON")
    .action(async (source, options) => {
      const spinner = ora("Saving source config...").start();

      try {
        const credentials: Record<string, string> = {};
        if (options.apiKey) credentials.apiKey = options.apiKey;
        if (options.projectId) credentials.projectId = options.projectId;
        if (options.host) credentials.host = options.host;
        if (options.apiSecret) credentials.apiSecret = options.apiSecret;
        if (options.secretKey) credentials.secretKey = options.secretKey;
        if (options.kind) credentials.kind = options.kind;
        const mapPairs = options.map as string[];
        if (mapPairs.length > 0) {
          const mapping: Record<string, string> = {};
          for (const pair of mapPairs) {
            const eq = pair.indexOf("=");
            if (eq <= 0 || eq === pair.length - 1) {
              throw new Error(`Invalid --map ${pair}; use column=field`);
            }
            mapping[pair.slice(0, eq)] = pair.slice(eq + 1);
          }
          credentials.mapping = JSON.stringify(mapping);
        }

        if (Object.keys(credentials).length === 0) {
          throw new Error("Pass at least one source credential flag");
        }

        const workspace = workspaceOf(options);
        const data = (await apiRequest("/api/v1/connect", {
          method: "POST",
          body: JSON.stringify({
            source,
            credentials,
            workspaceId: workspace,
          }),
        })) as {
          source: string;
          workspaceId: string;
          connected: boolean;
          rotated?: boolean;
        };

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log();
        console.log(
          chalk.green("✓"),
          data.rotated ? "Updated" : "Connected",
          chalk.bold(data.source),
          chalk.dim(data.workspaceId)
        );
        console.log();
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("import <file>")
    .description("Import users or events from a CSV file")
    .option("--kind <kind>", "users or events")
    .option(
      "--map <column=field>",
      "Column mapping (repeatable)",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[]
    )
    .option("--preview", "Show column mapping without writing")
    .option("--workspace <workspace>", "Workspace")
    .option("--json", "Output as JSON")
    .action(async (file: string, options) => {
      const spinner = ora(options.preview ? "Previewing CSV..." : "Importing CSV...").start();

      try {
        const csv = readFileSync(file, "utf8");
        const mapping: Record<string, string> = {};
        for (const pair of options.map as string[]) {
          const eq = pair.indexOf("=");
          if (eq <= 0 || eq === pair.length - 1) {
            throw new Error(`Invalid --map ${pair}; use column=field`);
          }
          mapping[pair.slice(0, eq)] = pair.slice(eq + 1);
        }

        if (options.kind && options.kind !== "users" && options.kind !== "events") {
          throw new Error("kind must be users or events");
        }

        const data = (await apiRequest("/api/v1/import", {
          method: "POST",
          body: JSON.stringify({
            csv,
            workspaceId: workspaceOf(options),
            preview: Boolean(options.preview),
            ...(options.kind ? { kind: options.kind } : {}),
            ...(Object.keys(mapping).length > 0 ? { mapping } : {}),
          }),
        })) as {
          kind?: string;
          columns?: string[];
          mapping?: Record<string, string>;
          sample?: Record<string, string>[];
          rowCount?: number;
          imported?: number;
          skipped?: number;
          workspaceId?: string;
          errors?: Array<{ line: number; message: string }>;
        };

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log();
        if (options.preview) {
          console.log(chalk.bold("Preview"), chalk.dim(data.kind || ""));
          console.log();
          console.log("  Rows:", chalk.bold(String(data.rowCount ?? 0)));
          console.log("  Columns:", (data.columns ?? []).join(", "));
          console.log();
          console.log(chalk.bold("Mapping"));
          for (const [column, field] of Object.entries(data.mapping ?? {})) {
            console.log("  ", chalk.cyan(column), "→", field);
          }
          console.log();
          return;
        }

        console.log(
          chalk.green("✓"),
          "Imported",
          chalk.bold(String(data.imported ?? 0)),
          data.kind || "rows",
          (data.skipped ?? 0) > 0 ? chalk.dim(`(${data.skipped} already present)`) : ""
        );
        console.log();
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("export")
    .description("Export users, events, and read models")
    .option("--format <format>", "json or csv", "json")
    .option("--out <path>", "Write a JSON file or a CSV directory")
    .option("--workspace <workspace>", "Workspace")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora("Exporting workspace...").start();

      try {
        const format = String(options.format || "json").toLowerCase();
        if (format !== "json" && format !== "csv") {
          throw new Error("format must be json or csv");
        }
        if (format === "csv" && !options.out) {
          throw new Error("csv format requires --out <directory>");
        }

        const workspace = workspaceOf(options);
        const params = new URLSearchParams({ workspace, format });
        const data = (await apiRequest(`/api/v1/export?${params}`)) as {
          format: string;
          workspaceId: string;
          exportedAt: string;
          counts?: { users: number; events: number; readModelRows: number };
          restore?: { usersAndEvents: string; connectorReadModels: string };
          files?: Record<string, string>;
          users?: unknown[];
          events?: unknown[];
          readModels?: unknown;
          view_url?: string;
        };

        const written: string[] = [];
        if (options.out) {
          if (format === "csv") {
            mkdirSync(options.out, { recursive: true });
            for (const [name, body] of Object.entries(data.files ?? {})) {
              const path = join(options.out, name);
              writeFileSync(path, body);
              written.push(path);
            }
          } else {
            mkdirSync(dirname(options.out), { recursive: true });
            writeFileSync(options.out, `${JSON.stringify(data, null, 2)}\n`);
            written.push(options.out);
          }
        }

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify({ ...data, written }, null, 2));
          return;
        }

        if (format === "json" && !options.out) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log();
        console.log(chalk.green("✓"), "Exported", chalk.bold(data.workspaceId));
        console.log();
        console.log("  Users:", chalk.bold(String(data.counts?.users ?? 0)));
        console.log("  Events:", chalk.bold(String(data.counts?.events ?? 0)));
        console.log(
          "  Read models:",
          chalk.bold(String(data.counts?.readModelRows ?? 0)),
          chalk.dim("rows")
        );
        console.log();
        if (data.restore?.connectorReadModels) {
          console.log(chalk.dim(data.restore.connectorReadModels));
          console.log();
        }
        if (written.length > 0) {
          console.log(chalk.bold("Wrote"));
          for (const path of written) {
            console.log("  ", path);
          }
          console.log();
        }
        if (data.view_url) {
          console.log(chalk.dim("View:"), chalk.cyan(data.view_url));
        }
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("identify <userId>")
    .description("Identify a user")
    .option("--name <name>", "User name")
    .option("--email <email>", "User email")
    .option("--platform <platform>", "Platform (ios, android, web)")
    .option("--workspace <workspace>", "Workspace")
    .option("--json", "Output as JSON")
    .action(async (userId, options) => {
      const spinner = ora("Identifying user...").start();

      try {
        const data = await apiRequest(INGEST_IDENTIFY_PATH, {
          method: "POST",
          body: JSON.stringify({
            userId,
            properties: {
              name: options.name,
              email: options.email,
              platform: options.platform,
            },
            workspaceId: workspaceOf(options),
          }),
        });

        spinner.succeed("User identified");

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        }
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("track <userId> <eventName>")
    .description("Track an event")
    .option("--workspace <workspace>", "Workspace")
    .option("--platform <platform>", "Platform")
    .option("--name <name>", "User name (used if the user is created on first track)")
    .option("--json", "Output as JSON")
    .action(async (userId, eventName, options) => {
      const spinner = ora("Tracking event...").start();

      try {
        const data = await apiRequest(INGEST_EVENT_PATH, {
          method: "POST",
          body: JSON.stringify({
            userId,
            eventName,
            properties: {
              platform: options.platform,
              name: options.name,
            },
            workspaceId: workspaceOf(options),
          }),
        });

        spinner.succeed("Event tracked");

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        }
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("overview")
    .description("Get company snapshot")
    .option("--workspace <workspace>", "Workspace")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora("Fetching overview...").start();

      try {
        const workspace = workspaceOf(options);
        const data = (await apiRequest(
          `/api/v1/overview?workspace=${encodeURIComponent(workspace)}`
        )) as Record<string, unknown>;

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log();
          console.log(chalk.bold(workspace.toUpperCase()), chalk.dim("workspace"));
          console.log();
          console.log("  Total Users:", chalk.bold(String(data.totalUsers)));
          console.log("  Active Today:", chalk.bold(String(data.activeToday)));
          console.log("  Weekly Active:", chalk.bold(String(data.weeklyActive)));
          console.log("  Retention:", chalk.bold(`${data.retentionRate}%`));
          console.log(
            "  PMF Signal:",
            data.smileDetected ? chalk.green("✓ Smile detected") : chalk.dim("—")
          );
          console.log(
            "  Exceptions:",
            (data.exceptionsCount as number) > 0
              ? chalk.yellow(String(data.exceptionsCount))
              : chalk.green("0")
          );
          console.log();
          if (data.view_url) {
            console.log(chalk.dim("View:"), chalk.cyan(String(data.view_url)));
          }
        }
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("users")
    .description("Query users")
    .option("--workspace <workspace>", "Workspace")
    .option("--cluster <cluster>", "Behavior cluster")
    .option("--platform <platform>", "Platform")
    .option("--limit <limit>", "Limit results", "10")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora("Querying users...").start();

      try {
        const workspace = workspaceOf(options);
        const params = new URLSearchParams({
          workspace,
          ...(options.cluster && { cluster: options.cluster }),
          ...(options.platform && { platform: options.platform }),
          limit: options.limit,
        });

        const data = (await apiRequest(`/api/v1/users?${params}`)) as {
          total: number;
          users: Array<{ emoji?: string; name: string; platform?: string; cluster?: string }>;
          view_url?: string;
        };

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log();
          console.log(chalk.bold(String(data.total)), "users");
          console.log();

          data.users.slice(0, parseInt(options.limit, 10)).forEach((user) => {
            console.log("  ", user.emoji || "👤", chalk.bold(user.name), chalk.dim(user.platform || ""));
            if (user.cluster) {
              console.log("      ", chalk.dim(user.cluster));
            }
          });

          console.log();
          if (data.view_url) {
            console.log(chalk.dim("View:"), chalk.cyan(data.view_url));
          }
        }
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("cohorts")
    .description("Get retention data")
    .option("--workspace <workspace>", "Workspace")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora("Fetching cohorts...").start();

      try {
        const workspace = workspaceOf(options);
        const data = (await apiRequest(
          `/api/v1/cohorts?workspace=${encodeURIComponent(workspace)}`
        )) as {
          cohorts: Array<{
            label: string;
            size: number;
            smileDetected?: boolean;
            retention: { week0: number; week4: number; latest: number };
          }>;
          smileDetected?: boolean;
          view_url?: string;
        };

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log();
          console.log(chalk.bold(String(data.cohorts.length)), "cohorts");
          console.log();

          if (data.smileDetected) {
            console.log(chalk.green("✓"), "PMF smile detected");
            console.log();
          }

          data.cohorts.slice(0, 5).forEach((cohort) => {
            const retention = cohort.retention;
            console.log("  ", chalk.bold(cohort.label), chalk.dim(`(${cohort.size} users)`));
            console.log("      Week 0:", chalk.bold(`${retention.week0}%`));
            console.log("      Week 4:", chalk.bold(`${retention.week4}%`));
            console.log(
              "      Latest:",
              cohort.smileDetected
                ? chalk.green(`${retention.latest}% 😊`)
                : chalk.dim(`${retention.latest}%`)
            );
            console.log();
          });

          if (data.view_url) {
            console.log(chalk.dim("View:"), chalk.cyan(data.view_url));
          }
        }
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("wbr")
    .description("Get WBR metrics")
    .option("--workspace <workspace>", "Workspace")
    .option("--section <section>", "Filter by section")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora("Fetching WBR...").start();

      try {
        const workspace = workspaceOf(options);
        const data = (await apiRequest(
          `/api/v1/wbr?workspace=${encodeURIComponent(workspace)}`
        )) as {
          metrics: Array<{
            section: string;
            status: string;
            name: string;
            owner: string;
            current: number;
            unit: string;
            target: number;
            wow: number;
          }>;
          exceptionsCount: number;
          view_url?: string;
        };

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log();
          console.log(chalk.bold(String(data.metrics.length)), "metrics");

          if (data.exceptionsCount > 0) {
            console.log(chalk.yellow("⚠"), data.exceptionsCount, "exceptions");
          }
          console.log();

          let metrics = data.metrics;
          if (options.section) {
            metrics = metrics.filter(
              (m) => m.section.toLowerCase() === options.section.toLowerCase()
            );
          }

          metrics.slice(0, 10).forEach((metric) => {
            const statusColor =
              metric.status === "ok"
                ? chalk.green
                : metric.status === "watch"
                  ? chalk.yellow
                  : chalk.red;
            const statusIcon =
              metric.status === "ok" ? "✓" : metric.status === "watch" ? "⚠" : "✗";

            console.log("  ", statusColor(statusIcon), chalk.bold(metric.name));
            console.log("      ", chalk.dim(metric.section), "·", metric.owner);
            console.log("      ", "Current:", chalk.bold(metric.current + metric.unit));
            console.log(
              "      ",
              "Target:",
              metric.target + metric.unit,
              "·",
              "WoW:",
              metric.wow > 0 ? chalk.green(`+${metric.wow}%`) : chalk.red(`${metric.wow}%`)
            );
            console.log();
          });

          if (data.view_url) {
            console.log(chalk.dim("View:"), chalk.cyan(data.view_url));
          }
        }
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("calendar")
    .description("Get calendar events")
    .option("--workspace <workspace>", "Workspace")
    .option("--source <source>", "Filter by source")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora("Fetching calendar...").start();

      try {
        const workspace = workspaceOf(options);
        const data = (await apiRequest(
          `/api/v1/calendar?workspace=${encodeURIComponent(workspace)}`
        )) as {
          events: Array<{
            source: string;
            date: string;
            emoji: string;
            title: string;
            badge: string;
            sourceName: string;
            syncAge?: string;
          }>;
          sources: unknown[];
          view_url?: string;
        };

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log();
          console.log(
            chalk.bold(String(data.events.length)),
            "events from",
            chalk.bold(String(data.sources.length)),
            "sources"
          );
          console.log();

          let events = data.events;
          if (options.source) {
            events = events.filter((e) => e.source === options.source);
          }

          events.slice(0, 10).forEach((event) => {
            const date = new Date(event.date);
            console.log("  ", event.emoji, chalk.bold(event.title));
            console.log("      ", chalk.dim(date.toLocaleDateString()), "·", event.badge);
            console.log(
              "      ",
              chalk.dim(event.sourceName),
              event.syncAge ? `· ${event.syncAge}` : ""
            );
            console.log();
          });

          if (data.view_url) {
            console.log(chalk.dim("View:"), chalk.cyan(data.view_url));
          }
        }
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("sync")
    .description("Trigger a connector sync")
    .option("--source <source>", "One source (omit to sync all)")
    .option("--workspace <workspace>", "Workspace")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora("Triggering sync...").start();

      try {
        const workspace = workspaceOf(options);
        const data = (await apiRequest("/api/v1/sync", {
          method: "POST",
          body: JSON.stringify({
            workspace,
            ...(options.source ? { source: options.source } : {}),
          }),
        })) as {
          workspace: string;
          results: Array<{
            source: string;
            rowsSynced: number;
            health: string;
            error?: string;
          }>;
          states: Array<{
            source: string;
            sourceName: string;
            status: string;
            error?: string;
          }>;
        };

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold("Sync"), chalk.dim(data.workspace));
        console.log();

        for (const result of data.results) {
          const ok = result.health === "ok";
          const mark = ok ? chalk.green("✓") : chalk.red("✗");
          const detail = ok
            ? `${result.rowsSynced} rows`
            : result.error || "sync failed";
          console.log("  ", mark, chalk.bold(result.source), chalk.dim(detail));
        }

        console.log();
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("outreach")
    .description("List outreach drafts or tag an outcome")
    .option("--id <id>", "Outreach draft id (required with --outcome)")
    .option("--outcome <outcome>", "replied, interviewed, or converted")
    .option("--workspace <workspace>", "Workspace")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora(
        options.outcome ? "Tagging outreach outcome..." : "Fetching outreach..."
      ).start();

      try {
        const workspace = workspaceOf(options);
        const outcome = options.outcome ? String(options.outcome).toLowerCase() : undefined;
        if (outcome && outcome !== "replied" && outcome !== "interviewed" && outcome !== "converted") {
          throw new Error("outcome must be replied, interviewed, or converted");
        }
        if (outcome && !options.id) {
          throw new Error("Pass --id with --outcome");
        }

        if (outcome && options.id) {
          const data = (await apiRequest("/api/v1/outreach/outcome", {
            method: "POST",
            body: JSON.stringify({
              workspaceId: workspace,
              id: options.id,
              outcome,
            }),
          })) as {
            draft?: { id: string; personId: string; state: string; outcome?: string | null };
            conversion?: Array<{
              cluster: string;
              sent: number;
              converted: number;
              conversionRate: number;
            }>;
            view_url?: string;
          };

          spinner.stop();

          if (options.json) {
            console.log(JSON.stringify(data, null, 2));
            return;
          }

          console.log();
          console.log(
            chalk.green("✓"),
            "Tagged",
            chalk.bold(data.draft?.id || options.id),
            chalk.dim(outcome)
          );
          console.log();
          if (data.view_url) {
            console.log(chalk.dim("View:"), chalk.cyan(data.view_url));
          }
          return;
        }

        const data = (await apiRequest(
          `/api/v1/outreach?workspace=${encodeURIComponent(workspace)}`
        )) as {
          drafts: Array<{
            id: string;
            personId: string;
            state: string;
            outcome?: string | null;
          }>;
          conversion?: Array<{
            cluster: string;
            outreach: number;
            sent: number;
            replied: number;
            interviewed: number;
            converted: number;
            conversionRate: number;
          }>;
          view_url?: string;
        };

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(String(data.drafts.length)), "outreach drafts");
        console.log();

        for (const draft of data.drafts) {
          console.log("  ", chalk.bold(draft.id), chalk.dim(draft.personId));
          console.log(
            "      ",
            "state:",
            chalk.bold(draft.state),
            draft.outcome ? `· ${draft.outcome}` : chalk.dim("· no outcome")
          );
        }

        if ((data.conversion ?? []).length > 0) {
          console.log();
          console.log(chalk.bold("Conversion by cluster"));
          for (const row of data.conversion ?? []) {
            console.log(
              "  ",
              chalk.bold(row.cluster),
              chalk.dim(
                `${row.sent} sent · ${row.replied} replied · ${row.interviewed} interviewed · ${row.converted} converted (${Math.round(row.conversionRate * 100)}%)`
              )
            );
          }
        }

        console.log();
        if (data.view_url) {
          console.log(chalk.dim("View:"), chalk.cyan(data.view_url));
        }
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  program
    .command("keys")
    .description("List API keys or downgrade legacy keys")
    .argument("[action]", "Pass downgrade to convert legacy write keys to read")
    .option("--id <id>", "Downgrade one key id")
    .option("--json", "Output as JSON")
    .action(async (action: string | undefined, options) => {
      if (action && action !== "downgrade") {
        throw new Error("Unknown keys action. Use `anykpi keys` or `anykpi keys downgrade`.");
      }

      const spinner = ora(
        action === "downgrade" ? "Downgrading legacy keys..." : "Listing API keys..."
      ).start();

      try {
        if (action === "downgrade") {
          const data = (await apiRequest("/api/v1/keys/downgrade", {
            method: "POST",
            body: JSON.stringify(options.id ? { id: options.id } : {}),
          })) as { downgraded?: string[] };

          spinner.stop();

          if (options.json) {
            console.log(JSON.stringify(data, null, 2));
            return;
          }

          const ids = data.downgraded ?? [];
          console.log();
          if (ids.length === 0) {
            console.log(chalk.dim("No legacy keys to downgrade."));
          } else {
            console.log(
              chalk.green("✓"),
              "Downgraded",
              chalk.bold(String(ids.length)),
              ids.length === 1 ? "legacy key to read" : "legacy keys to read"
            );
            for (const id of ids) {
              console.log("  ", chalk.dim(id));
            }
          }
          console.log();
          return;
        }

        const data = (await apiRequest("/api/v1/keys")) as {
          keys: Array<{
            id: string;
            name: string;
            scope: string;
            legacy: boolean;
            lastUsedAt?: string | null;
            createdAt: string;
          }>;
        };

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(String(data.keys.length)), "keys");
        console.log();

        for (const key of data.keys) {
          const lastUsed = key.lastUsedAt
            ? new Date(key.lastUsedAt).toLocaleString()
            : "never";
          const flags = key.legacy ? chalk.yellow("legacy") : "";
          console.log("  ", chalk.bold(key.name), chalk.dim(key.id));
          console.log(
            "      ",
            "scope:",
            chalk.bold(key.scope),
            flags,
            "· last used:",
            lastUsed
          );
        }

        if (data.keys.some((key) => key.legacy)) {
          console.log();
          console.log(
            chalk.dim("Legacy keys still have write. Run"),
            chalk.bold("anykpi keys downgrade"),
            chalk.dim("to convert them to read.")
          );
        }
        console.log();
      } catch (error) {
        spinner.fail((error as Error).message);
        throw error;
      }
    });

  return program;
}
