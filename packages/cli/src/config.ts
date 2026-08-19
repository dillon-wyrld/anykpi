import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  apiUrl?: string;
  apiKey?: string;
  workspace?: string;
}

export function configDir(): string {
  return process.env.ANYKPI_CONFIG_DIR || join(homedir(), ".anykpi");
}

export function configFile(): string {
  return join(configDir(), "config.json");
}

export function loadConfig(): Config {
  const file = configFile();
  if (!existsSync(file)) {
    return {};
  }
  return JSON.parse(readFileSync(file, "utf-8")) as Config;
}

export function saveConfig(config: Config): void {
  const dir = configDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configFile(), JSON.stringify(config, null, 2));
}

export function resolveApiUrl(config: Config = loadConfig()): string {
  return (
    config.apiUrl ||
    process.env.ANYKPI_API_URL ||
    "http://localhost:3000"
  );
}

export function resolveApiKey(config: Config = loadConfig()): string | undefined {
  const key = config.apiKey || process.env.ANYKPI_API_KEY;
  if (!key || key.trim().length === 0) return undefined;
  return key;
}
