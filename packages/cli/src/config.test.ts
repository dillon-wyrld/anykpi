import { chmodSync, writeFileSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configFile, saveConfig } from "./config";

const originalEnv = {
  HOME: process.env.HOME,
  ANYKPI_CONFIG_DIR: process.env.ANYKPI_CONFIG_DIR,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function isolatedHome() {
  const dir = mkdtempSync(join(tmpdir(), "anykpi-cli-config-"));
  process.env.HOME = dir;
  process.env.ANYKPI_CONFIG_DIR = join(dir, ".anykpi");
  return dir;
}

function fileMode(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("CLI config file mode", () => {
  it("writes config.json as 0600 and chmod's an existing world-readable file", () => {
    isolatedHome();
    saveConfig({ apiUrl: "http://localhost:3000", apiKey: "secret", workspace: "live" });

    const file = configFile();
    if (process.platform !== "win32") {
      expect(fileMode(file)).toBe(0o600);
    } else {
      expect(fileMode(file) & 0o200).toBeGreaterThan(0);
    }

    if (process.platform === "win32") return;

    writeFileSync(file, '{"apiKey":"old"}', { mode: 0o644 });
    try {
      chmodSync(file, 0o644);
    } catch {
      // some filesystems ignore chmod
    }
    expect(fileMode(file)).toBe(0o644);

    saveConfig({ apiUrl: "http://localhost:3000", apiKey: "secret", workspace: "live" });
    expect(fileMode(file)).toBe(0o600);
  });
});
