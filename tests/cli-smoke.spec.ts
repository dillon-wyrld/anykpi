import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandsFromHelp } from "../packages/cli/src/help";

const CLI = join(process.cwd(), "packages/cli/dist/index.js");
const API_URL = "http://localhost:3000";
const API_KEY = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";

function run(args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env,
    timeout: 30000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`anykpi ${args.join(" ")} exited ${result.status}\n${output}`);
  }
  return output;
}

test("every --help command succeeds and track is visible in /api/v1/users", async ({
  request,
}) => {
  expect(existsSync(CLI), "CLI dist missing — run pnpm --filter @anykpi/cli build").toBeTruthy();

  const home = mkdtempSync(join(tmpdir(), "anykpi-cli-smoke-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    ANYKPI_CONFIG_DIR: join(home, ".anykpi"),
    ANYKPI_API_KEY: API_KEY,
    ANYKPI_API_URL: API_URL,
  };

  const help = run(["--help"], env);
  expect(help).toMatch(/\bconnect\b/);

  const commands = commandsFromHelp(help);
  expect(commands.length).toBeGreaterThan(0);

  const stamp = Date.now();
  const userId = `cli-smoke-${stamp}`;
  const platform = `cli-smoke-${stamp}`;

  const extras: Record<string, string[]> = {
    login: ["--url", API_URL, "--key", API_KEY, "--name", "CLI Smoke", "--workspace", "demo"],
    workspaces: [],
    identify: [
      userId,
      "--name",
      "CLI Smoke User",
      "--platform",
      platform,
      "--workspace",
      "demo",
      "--json",
    ],
    track: [
      userId,
      "cli_smoke_event",
      "--workspace",
      "demo",
      "--platform",
      platform,
      "--name",
      "CLI Smoke User",
      "--json",
    ],
    overview: ["--workspace", "demo", "--json"],
    users: ["--workspace", "demo", "--platform", platform, "--json"],
    cohorts: ["--workspace", "demo", "--json"],
    wbr: ["--workspace", "demo", "--json"],
    calendar: ["--workspace", "demo", "--json"],
    connect: [
      "posthog",
      "--workspace",
      "demo",
      "--api-key",
      "phc_cli_smoke",
      "--project-id",
      "proj_cli_smoke",
      "--json",
    ],
    import: [
      join(home, "cli-smoke-import.csv"),
      "--kind",
      "users",
      "--workspace",
      "demo",
      "--json",
    ],
    sync: ["--workspace", "demo", "--json"],
  };

  writeFileSync(
    join(home, "cli-smoke-import.csv"),
    `person_id,name,platform\ncli-import-${stamp},CLI Import User,${platform}\n`
  );

  for (const command of commands) {
    const extra = extras[command];
    if (!extra) {
      throw new Error(
        `--help command "${command}" has no smoke arguments; every published command must be real`
      );
    }
    const output = run([command, ...extra], env);
    expect(output.length, `${command} produced no output`).toBeGreaterThan(0);
  }

  const users = await request.get(
    `/api/v1/users?workspace=demo&platform=${encodeURIComponent(platform)}`
  );
  expect(users.ok()).toBeTruthy();
  const body = await users.json();
  expect(body.users.map((user: { personId: string }) => user.personId)).toContain(
    `person_${userId}`
  );
});
