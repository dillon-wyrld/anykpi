import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { PATCH as patchConfig } from "@/app/api/v1/config/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { handleStdioToolCall } from "@/mcp/server";
import { saveValueEvents } from "./value-events";
import {
  VANITY_EVENT_WARNING,
  VALUE_EVENTS_CONFIG_KEY,
  isVanityEvent,
  parseValueEventMapping,
  vanityWarningFor,
  vanityWarningForMapping,
} from "./vanity-events";

const WS = "vanity-events";
const ADMIN = "vanity-events-admin";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.config).where(eq(schema.config.workspaceId, WS));
});

function parseTool(result: { content: { text: string }[]; isError?: boolean }) {
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("vanity event list", () => {
  it("flags page views, app opens, session starts, and logins", () => {
    for (const name of [
      "$pageview",
      "page_view",
      "page views",
      "app_opened",
      "opened the app",
      "session_start",
      "session starts",
      "login",
      "logins",
    ]) {
      expect(isVanityEvent(name), name).toBe(true);
    }
    expect(vanityWarningFor(["$pageview"])).toBe(VANITY_EVENT_WARNING);
    expect(vanityWarningFor(["song_played"])).toBeNull();
  });

  it("does not flag a real value event", () => {
    expect(isVanityEvent("song_played")).toBe(false);
    expect(isVanityEvent("doc_created")).toBe(false);
    expect(isVanityEvent("checkout_completed")).toBe(false);
    expect(vanityWarningForMapping({ core: ["song_played"] })).toBeNull();
  });

  it("parses string or array class lists", () => {
    expect(
      parseValueEventMapping({
        core: "login",
        search: ["query_ran", " search_performed "],
        other: ["ignored"],
      })
    ).toEqual({
      core: ["login"],
      search: ["query_ran", "search_performed"],
    });
  });
});

describe("configure_value_events vanity warning", () => {
  it("warns on a vanity mapping and still writes", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const payload = parseTool(
      await handleStdioToolCall("configure_value_events", {
        workspace: WS,
        mapping: { core: ["login"] },
      })
    );
    expect(payload.success).toBe(true);
    expect(payload.mapping).toEqual({ core: ["login"] });
    expect(payload.warning).toBe(VANITY_EVENT_WARNING);

    const rows = await db
      .select()
      .from(schema.config)
      .where(
        and(
          eq(schema.config.workspaceId, WS),
          eq(schema.config.key, VALUE_EVENTS_CONFIG_KEY)
        )
      )
      .all();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.value ?? "{}")).toEqual({ core: ["login"] });
  });

  it("omits the warning when every event is a value action", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const payload = parseTool(
      await handleStdioToolCall("configure_value_events", {
        workspace: WS,
        mapping: { core: ["song_played"] },
      })
    );
    expect(payload.success).toBe(true);
    expect(payload.warning).toBeUndefined();
    expect(payload.mapping).toEqual({ core: ["song_played"] });
  });
});

describe("connect picker save is never a hard block", () => {
  it("PATCH /api/v1/config writes vanity events and returns the warning", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const response = await patchConfig(
      new NextRequest("http://localhost:3000/api/v1/config", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ADMIN}`,
        },
        body: JSON.stringify({
          workspaceId: WS,
          valueEvents: { core: ["app_opened"] },
        }),
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      warning?: string;
      valueEvents?: { core?: string[] };
    };
    expect(body.warning).toBe(VANITY_EVENT_WARNING);
    expect(body.valueEvents).toEqual({ core: ["app_opened"] });

    const saved = await saveValueEvents(WS, { core: ["session_start"] });
    expect(saved.warning).toBe(VANITY_EVENT_WARNING);
    expect(saved.mapping).toEqual({ core: ["session_start"] });
  });
});
