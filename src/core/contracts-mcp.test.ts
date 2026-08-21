import { describe, expect, it } from "vitest";
import {
  ActivityResponseSchema,
  MCP_GET_ACTIVITY_TOOL,
  MCP_GET_SYNC_STATUS_TOOL,
  PINNED_HTTP_MCP_TOOLS,
  PINNED_MCP_TOOLS,
  PINNED_STDIO_MCP_TOOLS,
  SyncStatusResponseSchema,
  missingPinnedMcpTools,
} from "./contracts";

describe("MCP tool-list drift gate", () => {
  it("treats growth as ok and a missing pinned name as drift", () => {
    const grown = [...PINNED_MCP_TOOLS, "get_future_tool"];
    expect(missingPinnedMcpTools(grown, PINNED_MCP_TOOLS)).toEqual([]);

    const shrunk = PINNED_MCP_TOOLS.filter((name) => name !== "get_activity");
    expect(missingPinnedMcpTools(shrunk, PINNED_MCP_TOOLS)).toEqual([
      "get_activity",
    ]);
  });

  it("pins get_activity and get_sync_status on every v1 surface", () => {
    for (const name of ["get_activity", "get_sync_status"] as const) {
      expect(PINNED_MCP_TOOLS).toContain(name);
      expect(PINNED_STDIO_MCP_TOOLS).toContain(name);
      expect(PINNED_HTTP_MCP_TOOLS).toContain(name);
    }
  });

  it("pins define_metric on every v1 surface", () => {
    expect(PINNED_MCP_TOOLS).toContain("define_metric");
    expect(PINNED_STDIO_MCP_TOOLS).toContain("define_metric");
    expect(PINNED_HTTP_MCP_TOOLS).toContain("define_metric");
  });

  it("pins disconnect_source on every v1 surface", () => {
    expect(PINNED_MCP_TOOLS).toContain("disconnect_source");
    expect(PINNED_STDIO_MCP_TOOLS).toContain("disconnect_source");
    expect(PINNED_HTTP_MCP_TOOLS).toContain("disconnect_source");
  });

  it("advertises get_activity and get_sync_status with object input schemas", () => {
    expect(MCP_GET_ACTIVITY_TOOL.name).toBe("get_activity");
    expect(MCP_GET_SYNC_STATUS_TOOL.name).toBe("get_sync_status");
    expect(MCP_GET_ACTIVITY_TOOL.inputSchema.type).toBe("object");
    expect(MCP_GET_SYNC_STATUS_TOOL.inputSchema.type).toBe("object");
    expect(MCP_GET_ACTIVITY_TOOL.inputSchema.properties).toHaveProperty(
      "workspace"
    );
    expect(MCP_GET_SYNC_STATUS_TOOL.inputSchema.properties).toHaveProperty(
      "workspace"
    );
  });
});

describe("get_activity / get_sync_status contracts", () => {
  it("parses an activity matrix payload with view_url", () => {
    const parsed = ActivityResponseSchema.parse({
      users: [
        {
          personId: "p1",
          activity: [true, false, true],
          signupOffset: 0,
          cohortMonth: 0,
          activeCount: 2,
          streak: 0,
          lastSeen: 0,
          isNew: false,
          paid: false,
          churned: false,
        },
      ],
      days: 28,
      baseDate: "2026-01-01T00:00:00.000Z",
      workspace: "demo",
      viewUrl: "http://localhost:3000/dashboard?workspace=demo&view=dotplot",
      view_url: "http://localhost:3000/dashboard?workspace=demo&view=dotplot",
    });
    expect(parsed.users[0]?.activity).toEqual([true, false, true]);
    expect(parsed.view_url).toContain("view=dotplot");
  });

  it("parses a sync-status payload that unions freshness and sync", () => {
    const parsed = SyncStatusResponseSchema.parse({
      workspace: "demo",
      lastIngest: "12:2026-08-19T18:00:00.000Z",
      sources: [{ source: "ics", lastSync: "2026-08-19T18:00:00.000Z" }],
      states: [
        {
          source: "ics",
          sourceName: "Calendar",
          lastSync: "2026-08-19T18:00:00.000Z",
          status: "success",
        },
      ],
      syncIntervalMinutes: 15,
      view_url: "http://localhost:3000/dashboard?workspace=demo&view=dotplot",
    });
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.states).toHaveLength(1);
    expect(parsed.syncIntervalMinutes).toBe(15);
  });
});
