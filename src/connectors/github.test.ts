import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { loadSourceCiphertext, saveSourceConfig } from "@/core/sources";
import { loadCalendarView } from "@/core/views/calendar";
import { loadWbrView } from "@/core/views/wbr";
import { sync } from "./index";
import {
  GITHUB_SOURCE,
  commitsMetricId,
  parseRepo,
  releaseTitle,
  starsMetricId,
} from "./github";
import { clearWorkspace, restoreEnv, withOfflineSuite } from "./testing/offline";

const WS = "contract-github";
const TOKEN = "ghp_test_fixture_token";
const REPO = "fixture-org/fixture-app";

const originalToken = process.env.GITHUB_TOKEN;
const originalOwner = process.env.GITHUB_OWNER;
const originalRepo = process.env.GITHUB_REPO;
const originalSecret = process.env.ANYKPI_SECRET;

afterEach(async () => {
  restoreEnv("GITHUB_TOKEN", originalToken);
  restoreEnv("GITHUB_OWNER", originalOwner);
  restoreEnv("GITHUB_REPO", originalRepo);
  restoreEnv("ANYKPI_SECRET", originalSecret);
  await clearWorkspace(WS);
});

async function storeCredentials() {
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_OWNER;
  delete process.env.GITHUB_REPO;
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  await saveSourceConfig(WS, GITHUB_SOURCE, {
    token: TOKEN,
    repo: REPO,
  });
}

describe("GitHub connector contract", () => {
  it("stores the token via the sources store and writes releases plus WBR context", async () => {
    await storeCredentials();
    const ciphertext = await loadSourceCiphertext(WS, GITHUB_SOURCE);
    expect(ciphertext).toBeTruthy();
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain(TOKEN);

    await withOfflineSuite("github", ["github", "happy"], async (harness) => {
      const result = await sync("github", WS);

      expect(result).toEqual({
        rowsSynced: 4,
        nextCursor: null,
        health: "ok",
      });

      expect(harness.calls).toHaveLength(3);
      expect(harness.calls[0]?.url).toMatch(/\/repos\/fixture-org\/fixture-app$/);
      expect(harness.calls[1]?.url).toContain("/repos/fixture-org/fixture-app/releases");
      expect(harness.calls[2]?.url).toContain("/stats/commit_activity");

      const events = await db
        .select()
        .from(schema.calEvents)
        .where(
          and(eq(schema.calEvents.workspaceId, WS), eq(schema.calEvents.source, GITHUB_SOURCE))
        )
        .all();
      expect(events).toHaveLength(2);
      expect(events.map((row) => row.title).sort()).toEqual([
        "Release v1.1.0",
        "Release v1.2.0",
      ]);
      expect(events.every((row) => row.type === "launch")).toBe(true);
      expect(events.every((row) => row.badge === "shipped")).toBe(true);
      expect(events.every((row) => row.sourceName === "GitHub")).toBe(true);

      const calendar = await loadCalendarView(WS);
      expect(calendar.events.map((row) => row.title).sort()).toEqual([
        "Release v1.1.0",
        "Release v1.2.0",
      ]);
      expect(calendar.events.every((row) => row.source === GITHUB_SOURCE)).toBe(true);

      const { metrics } = await loadWbrView(WS);
      const stars = metrics.find((metric) => metric.id === starsMetricId(WS));
      expect(stars?.name).toBe("Stars");
      expect(stars?.current).toBe(128);
      expect(stars?.section).toBe("eng");

      const commits = metrics.find((metric) => metric.id === commitsMetricId(WS));
      expect(commits?.name).toBe("Weekly commits");
      expect(commits?.current).toBe(6);
      expect(commits?.weeks).toEqual([3, 5, 2, 8, 4, 6]);
    });
  });

  it("returns health error on 401 and does not advance the cursor", async () => {
    await storeCredentials();

    await withOfflineSuite("github", ["github", "unauthorized"], async () => {
      const result = await sync("github", WS);
      expect(result).toEqual({
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "unauthorized",
      });

      const events = await db
        .select()
        .from(schema.calEvents)
        .where(eq(schema.calEvents.workspaceId, WS))
        .all();
      expect(events).toHaveLength(0);
    });
  });

  it("returns health error on rate-limit and does not advance the cursor", async () => {
    await storeCredentials();

    await withOfflineSuite("github", ["github", "rate-limit"], async () => {
      const result = await sync("github", WS);
      expect(result).toEqual({
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "rate limited",
      });
    });
  });

  it("never logs the token", async () => {
    await storeCredentials();
    const lines: string[] = [];
    const push = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    const log = vi.spyOn(console, "log").mockImplementation(push);
    const error = vi.spyOn(console, "error").mockImplementation(push);

    await withOfflineSuite("github", ["github", "happy"], async () => {
      await sync("github", WS);
    });

    expect(lines.join("\n")).not.toContain(TOKEN);
    log.mockRestore();
    error.mockRestore();
  });
});

describe("GitHub helpers", () => {
  it("parses owner/repo from stored config fields", () => {
    expect(parseRepo({ repo: "fixture-org/fixture-app" })).toEqual({
      owner: "fixture-org",
      repo: "fixture-app",
    });
    expect(parseRepo({ owner: "fixture-org", repo: "fixture-app" })).toEqual({
      owner: "fixture-org",
      repo: "fixture-app",
    });
    expect(parseRepo({ projectId: "fixture-org/fixture-app" })).toEqual({
      owner: "fixture-org",
      repo: "fixture-app",
    });
    expect(parseRepo({ repo: "not-a-repo" })).toBeNull();
  });

  it("titles a release from its tag", () => {
    expect(releaseTitle({ tag_name: "v1.2.0" })).toBe("Release v1.2.0");
    expect(releaseTitle({ tag_name: "  " })).toBeNull();
  });
});
