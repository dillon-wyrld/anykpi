import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnykpiConfigError,
  anykpiConfigPath,
  defaultAnykpiConfig,
  loadAnykpiConfig,
  parseAnykpiConfig,
  resetAnykpiConfigCache,
} from "./config";
import { DEFAULT_WBR_EXCEPTION_RULES } from "./views/wbr-math";

const root = resolve(__dirname, "../..");

afterEach(() => {
  resetAnykpiConfigCache();
});

describe("anykpi.config.json — defaults", () => {
  it("documents the same defaults as the example file and the engine", () => {
    const example = JSON.parse(
      readFileSync(resolve(root, "anykpi.config.example.json"), "utf8")
    ) as { wbr: { exceptions: typeof DEFAULT_WBR_EXCEPTION_RULES } };
    expect(example.wbr.exceptions).toEqual(DEFAULT_WBR_EXCEPTION_RULES);
    expect(defaultAnykpiConfig().wbr.exceptions).toEqual(DEFAULT_WBR_EXCEPTION_RULES);
    expect(parseAnykpiConfig({})).toEqual(defaultAnykpiConfig());
  });

  it("fills omitted keys from the documented defaults", () => {
    const parsed = parseAnykpiConfig({
      wbr: { exceptions: { consecutiveMissesForOff: 4 } },
    });
    expect(parsed.wbr.exceptions.consecutiveMissesForOff).toBe(4);
    expect(parsed.wbr.exceptions.consecutiveMissesForWatch).toBe(1);
    expect(parsed.wbr.exceptions.inputThinWinStdDevs).toBe(1);
    expect(parsed.wbr.exceptions.wrongWayLookbackWeeks).toBe(3);
  });

  it("treats a missing file as defaults (not an error)", () => {
    const dir = mkdtempSync(join(tmpdir(), "anykpi-config-"));
    const loaded = loadAnykpiConfig(join(dir, "anykpi.config.json"));
    expect(loaded).toEqual(defaultAnykpiConfig());
  });

  it("documents the defaults in human docs", () => {
    const intro = readFileSync(resolve(root, "docs/introduction.md"), "utf8");
    expect(intro).toContain("## WBR exception rules");
    expect(intro).toContain("`2`");
    expect(intro).toContain("`1`");
    expect(intro).toContain("`3`");
    expect(intro).toContain("consecutiveMissesForOff");
    expect(intro).toContain("wrongWayLookbackWeeks");
    expect(intro).toContain("offending path");
  });

  it("resolves the config path beside the database", () => {
    expect(anykpiConfigPath("/data/anykpi.db")).toBe("/data/anykpi.config.json");
    expect(anykpiConfigPath("/var/lib/anykpi/db.sqlite")).toBe(
      "/var/lib/anykpi/anykpi.config.json"
    );
  });
});

describe("anykpi.config.json — invalid config fails at boot with the path", () => {
  it("prints wbr.exceptions.consecutiveMissesForOff when the value is out of range", () => {
    expect(() =>
      parseAnykpiConfig({
        wbr: { exceptions: { consecutiveMissesForOff: 0 } },
      })
    ).toThrow(AnykpiConfigError);

    try {
      parseAnykpiConfig({
        wbr: { exceptions: { consecutiveMissesForOff: 0 } },
      });
      expect.fail("expected parse to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AnykpiConfigError);
      const error = err as AnykpiConfigError;
      expect(error.offendingPath).toBe("wbr.exceptions.consecutiveMissesForOff");
      expect(error.message).toContain("wbr.exceptions.consecutiveMissesForOff");
      expect(error.message).not.toMatch(/silently/i);
    }
  });

  it("prints the unknown-key path instead of ignoring it", () => {
    try {
      parseAnykpiConfig({
        wbr: { exceptions: { consecutiveMissesForOf: 2 } },
      });
      expect.fail("expected parse to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AnykpiConfigError);
      const error = err as AnykpiConfigError;
      expect(error.offendingPath).toBe("wbr.exceptions.consecutiveMissesForOf");
      expect(error.message).toContain("wbr.exceptions.consecutiveMissesForOf");
    }
  });

  it("prints the path for an unknown top-level key", () => {
    try {
      parseAnykpiConfig({ thresholds: {} });
      expect.fail("expected parse to throw");
    } catch (err) {
      expect((err as AnykpiConfigError).offendingPath).toBe("thresholds");
    }
  });

  it("prints wbr.exceptions.consecutiveMissesForWatch when watch > off", () => {
    try {
      parseAnykpiConfig({
        wbr: {
          exceptions: {
            consecutiveMissesForOff: 2,
            consecutiveMissesForWatch: 3,
          },
        },
      });
      expect.fail("expected parse to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AnykpiConfigError);
      expect((err as AnykpiConfigError).offendingPath).toBe(
        "wbr.exceptions.consecutiveMissesForWatch"
      );
    }
  });

  it("loadAnykpiConfig (boot) throws the offending path and never returns defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "anykpi-config-"));
    const path = join(dir, "anykpi.config.json");
    writeFileSync(
      path,
      JSON.stringify({ wbr: { exceptions: { consecutiveMissesForOff: 0 } } })
    );

    expect(() => loadAnykpiConfig(path)).toThrow(/wbr\.exceptions\.consecutiveMissesForOff/);
    expect(() => loadAnykpiConfig(path)).toThrow(AnykpiConfigError);
  });

  it("prints (root) when the file is not JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "anykpi-config-"));
    const path = join(dir, "anykpi.config.json");
    writeFileSync(path, "not-json");

    try {
      loadAnykpiConfig(path);
      expect.fail("expected load to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AnykpiConfigError);
      expect((err as AnykpiConfigError).offendingPath).toBe("(root)");
      expect((err as AnykpiConfigError).message).toContain(path);
    }
  });
});
