import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { apiRequest, INGEST_EVENT_PATH, INGEST_IDENTIFY_PATH } from "./api";
import { configFile, loadConfig, saveConfig } from "./config";

export const PUBLISHED_COMMANDS = [
  "login",
  "workspaces",
  "identify",
  "track",
  "overview",
  "users",
  "cohorts",
  "wbr",
  "calendar",
  "sync",
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

        const response = await fetch(`${options.url}/api/v1/keys`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name, workspace: options.workspace }),
        });

        const data = (await response.json()) as {
          error?: string;
          key?: string;
          id?: string;
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

  return program;
}
