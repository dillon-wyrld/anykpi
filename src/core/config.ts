/**
 * Operator config. Lives in `anykpi.config.json` beside the SQLite file
 * (same directory as DATABASE_PATH). Missing file → documented defaults.
 * Invalid file fails at boot with the offending path — never at render.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { z } from "zod";
import {
  DEFAULT_WBR_EXCEPTION_RULES,
  type WbrExceptionRules,
} from "@/core/views/wbr-math";

export class AnykpiConfigError extends Error {
  readonly offendingPath: string;
  readonly configPath: string;

  constructor(configPath: string, offendingPath: string, detail: string) {
    super(`Invalid anykpi.config.json at ${configPath}\n  ${offendingPath}: ${detail}`);
    this.name = "AnykpiConfigError";
    this.configPath = configPath;
    this.offendingPath = offendingPath;
  }
}

const WbrExceptionFieldsSchema = z
  .object({
    consecutiveMissesForOff: z.number().int().min(1).max(12).optional(),
    consecutiveMissesForWatch: z.number().int().min(1).max(12).optional(),
    inputThinWinStdDevs: z.number().min(0).max(10).optional(),
    wrongWayLookbackWeeks: z.number().int().min(2).max(12).optional(),
  })
  .strict();

export const AnykpiConfigInputSchema = z
  .object({
    wbr: z
      .object({
        exceptions: WbrExceptionFieldsSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AnykpiConfig = {
  wbr: { exceptions: WbrExceptionRules };
};

export function defaultAnykpiConfig(): AnykpiConfig {
  return {
    wbr: { exceptions: { ...DEFAULT_WBR_EXCEPTION_RULES } },
  };
}

/** Same directory as the SQLite file: `<db-dir>/anykpi.config.json`. */
export function anykpiConfigPath(
  databasePath = process.env.DATABASE_PATH ||
    resolve(process.cwd(), "data", "anykpi.db")
): string {
  return join(dirname(resolve(databasePath)), "anykpi.config.json");
}

export function formatConfigIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

function throwConfigError(configPath: string, issues: { path: string; message: string }[]): never {
  const first = issues[0] ?? { path: "(root)", message: "invalid config" };
  const detail = issues.map((i) => `${i.path}: ${i.message}`).join("\n  ");
  throw new AnykpiConfigError(configPath, first.path, detail);
}

export function parseAnykpiConfig(
  raw: unknown,
  configPath = "anykpi.config.json"
): AnykpiConfig {
  const parsed = AnykpiConfigInputSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throwConfigError(configPath, formatConfigIssues(parsed.error));
  }

  const exceptions: WbrExceptionRules = {
    ...DEFAULT_WBR_EXCEPTION_RULES,
    ...parsed.data.wbr?.exceptions,
  };

  if (exceptions.consecutiveMissesForWatch > exceptions.consecutiveMissesForOff) {
    throw new AnykpiConfigError(
      configPath,
      "wbr.exceptions.consecutiveMissesForWatch",
      "must be less than or equal to consecutiveMissesForOff"
    );
  }

  return { wbr: { exceptions } };
}

let cached: AnykpiConfig | undefined;

function readAndParse(path: string): AnykpiConfig {
  if (!existsSync(path)) {
    return defaultAnykpiConfig();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : "could not parse JSON";
    throw new AnykpiConfigError(path, "(root)", detail);
  }

  return parseAnykpiConfig(raw, path);
}

/** Boot / first use. Missing file → defaults. Invalid file → throw. */
export function loadAnykpiConfig(path = anykpiConfigPath()): AnykpiConfig {
  cached = readAndParse(path);
  return cached;
}

/** Cached config. Loads once; never swallows an invalid file. */
export function getAnykpiConfig(): AnykpiConfig {
  if (!cached) {
    cached = loadAnykpiConfig();
  }
  return cached;
}

export function resetAnykpiConfigCache(): void {
  cached = undefined;
}
