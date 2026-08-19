import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { POST as postMcp } from "@/app/api/mcp/route";

const WS = "mcp-users-test";
const ADMIN = "anykpi-mcp-test-admin";

afterEach(async () => {
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  if (process.env.ANYKPI_API_KEY === ADMIN) {
    delete process.env.ANYKPI_API_KEY;
  }
  vi.unstubAllEnvs();
});

describe("MCP query_users", () => {
  it("includes a per-user view_url that deep-links the person panel", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ANYKPI_API_KEY", ADMIN);

    await db.insert(schema.users).values([
      { personId: "p1", name: "Dave", workspaceId: WS, platform: "IOS" },
      { personId: "p2", name: "Mia", workspaceId: WS, platform: "WEB" },
    ]);

    const response = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ADMIN}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "query_users",
            arguments: { workspace: WS, limit: 10 },
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result?: { content?: { text?: string }[] };
    };
    const parsed = JSON.parse(body.result?.content?.[0]?.text ?? "{}") as {
      users: { personId: string; view_url?: string }[];
    };

    expect(parsed.users.map((u) => u.personId).sort()).toEqual(["p1", "p2"]);
    for (const user of parsed.users) {
      expect(user.view_url).toContain("/dashboard?");
      expect(user.view_url).toContain("view=dotplot");
      expect(user.view_url).toContain(`user=${user.personId}`);
      expect(user.view_url).toContain(`workspace=${WS}`);
    }
  });
});
