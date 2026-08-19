import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { Connector } from "../index";
import {
  fixtureDir,
  fixtureToResponse,
  installFixtureFetch,
  loadFixtureSuite,
  matchFixture,
} from "./index";

/**
 * A connector that is not PostHog/Mixpanel/Amplitude — only used to prove
 * a new source can be written and tested against the harness offline.
 */
const exampleConnector: Connector = {
  source: "example",
  name: "Example",
  async sync(_workspaceId, opts) {
    const cursor = opts?.cursor ?? "start";
    const res = await fetch(
      `https://api.example.test/v1/export?cursor=${cursor}`
    );
    if (!res.ok) {
      return {
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "export failed",
      };
    }
    const data = (await res.json()) as {
      rows: { id: string }[];
      next_cursor: string | null;
    };
    return {
      rowsSynced: data.rows.length,
      nextCursor: data.next_cursor,
      health: "ok",
    };
  },
};

describe("HTTP fixture harness", () => {
  it("matches fixtures by method and URL locator", () => {
    expect(
      matchFixture(
        { request: { urlIncludes: "/v1/export" }, response: { body: {} } },
        "GET",
        "https://api.example.test/v1/export?cursor=start"
      )
    ).toBe(true);
    expect(
      matchFixture(
        { request: { method: "POST", urlIncludes: "/v1/export" }, response: { body: {} } },
        "GET",
        "https://api.example.test/v1/export?cursor=start"
      )
    ).toBe(false);
  });

  it("returns JSON bodies with the recorded status", async () => {
    const res = fixtureToResponse({ status: 201, body: { ok: true } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("fails closed when a request has no fixture", async () => {
    const harness = installFixtureFetch([]);
    try {
      await expect(
        fetch("https://api.example.test/v1/missing")
      ).rejects.toThrow(/No HTTP fixture/);
    } finally {
      harness.restore();
    }
  });

  it("documents how to record fixtures", () => {
    const guide = readFileSync(resolve(__dirname, "RECORDING.md"), "utf8");
    expect(guide).toMatch(/ANYKPI_RECORD_FIXTURES=1/);
    expect(guide).toMatch(/suite\.json/);
    expect(guide).toMatch(/Adding a new connector/);
  });
});

describe("new connector against the harness", () => {
  it("syncs incrementally from recorded pages, offline", async () => {
    const suite = loadFixtureSuite(fixtureDir("example"));
    const harness = installFixtureFetch(suite);

    try {
      const first = await exampleConnector.sync("live");
      expect(first).toEqual({
        rowsSynced: 2,
        nextCursor: "page-2",
        health: "ok",
      });

      const second = await exampleConnector.sync("live", {
        cursor: first.nextCursor ?? undefined,
      });
      expect(second).toEqual({
        rowsSynced: 1,
        nextCursor: null,
        health: "ok",
      });

      expect(harness.calls.map((c) => c.url)).toEqual([
        "https://api.example.test/v1/export?cursor=start",
        "https://api.example.test/v1/export?cursor=page-2",
      ]);
    } finally {
      harness.restore();
    }
  });

  it("returns health error without advancing the cursor", async () => {
    const suite = loadFixtureSuite(fixtureDir("example"));
    const harness = installFixtureFetch(suite);

    try {
      const result = await exampleConnector.sync("live", { cursor: "down" });
      expect(result.health).toBe("error");
      expect(result.nextCursor).toBeNull();
      expect(result.rowsSynced).toBe(0);
    } finally {
      harness.restore();
    }
  });
});
