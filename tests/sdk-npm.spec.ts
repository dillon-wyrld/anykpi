import { test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectUserVisibleViaRestAndMcp } from "./helpers/verify-ingest";

const API_URL = "http://localhost:3000";
const API_KEY = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";

function packAndInstallSdk(): string {
  const dir = mkdtempSync(join(tmpdir(), "anykpi-sdk-npm-"));
  const pack = spawnSync(
    "pnpm",
    ["--filter", "@anykpi/sdk", "pack", "--pack-destination", dir],
    { encoding: "utf8", cwd: process.cwd() }
  );
  if (pack.status !== 0) {
    throw new Error(`pnpm pack failed\n${pack.stdout}\n${pack.stderr}`);
  }

  const tarball = readdirSync(dir).find((name) => name.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("pnpm pack did not produce a tarball");
  }

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "anykpi-sdk-npm-e2e", private: true, type: "module" })
  );

  const install = spawnSync(
    "npm",
    ["install", "--offline", "--no-fund", "--no-audit", join(dir, tarball)],
    { encoding: "utf8", cwd: dir }
  );
  if (install.status !== 0) {
    throw new Error(`npm i @anykpi/sdk failed\n${install.stdout}\n${install.stderr}`);
  }

  return dir;
}

test("npm i @anykpi/sdk then track() delivers an event to the local instance", async ({
  request,
}) => {
  const consumerDir = packAndInstallSdk();
  const stamp = Date.now();
  const userId = `sdk-npm-${stamp}`;
  const platform = `sdk-npm-${stamp}`;

  writeFileSync(
    join(consumerDir, "run.mjs"),
    `import { flush, identify, init, track } from "@anykpi/sdk";

const endpoint = process.env.ANYKPI_API_URL;
const apiKey = process.env.ANYKPI_API_KEY;
const userId = process.env.SDK_USER_ID;
const platform = process.env.SDK_PLATFORM;

const client = init({ endpoint, apiKey, workspaceId: "demo" });
await identify({ userId, properties: { name: "SDK npm user", platform } });
await track("sdk_npm_event", { platform });
await client.track("sdk_npm_again", { platform });
await flush();
`
  );

  const run = spawnSync(process.execPath, [join(consumerDir, "run.mjs")], {
    encoding: "utf8",
    cwd: consumerDir,
    env: {
      ...process.env,
      ANYKPI_API_URL: API_URL,
      ANYKPI_API_KEY: API_KEY,
      SDK_USER_ID: userId,
      SDK_PLATFORM: platform,
    },
    timeout: 30000,
  });
  if (run.status !== 0) {
    throw new Error(
      `SDK consumer failed status=${run.status} signal=${run.signal} error=${run.error?.message ?? ""}\n${run.stdout}\n${run.stderr}`
    );
  }

  await expectUserVisibleViaRestAndMcp(request, { userId, platform });
});
