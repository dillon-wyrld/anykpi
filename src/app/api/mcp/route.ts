import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import { buildViewUrl } from "@/core/view-state";
import { gate, isReadOnlyMcpTool } from "@/core/auth";
import { logServerError } from "@/core/errors";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

async function handleMCPRequest(
  body: Record<string, unknown>,
  workspaceOverride?: string
) {
  const method = body.method;
  const params = (body.params ?? {}) as {
    name?: string;
    arguments?: { workspace?: string; limit?: number };
  };

  if (method === "tools/list") {
    return {
      tools: [
        {
          name: "get_overview",
          description:
            "Get a high-level snapshot: current day, headline metrics, exception count, sync health",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Workspace ID (default: demo)",
              },
            },
          },
        },
        {
          name: "query_users",
          description:
            "Filter and group users by platform, country, or behavior. Returns users + view URL",
          inputSchema: {
            type: "object",
            properties: {
              workspace: { type: "string" },
              platform: { type: "string" },
              country: { type: "string" },
              limit: { type: "number" },
            },
          },
        },
        {
          name: "get_cohorts",
          description: "Get cohort retention data with smile flags and PMF verdict",
          inputSchema: {
            type: "object",
            properties: {
              workspace: { type: "string" },
            },
          },
        },
        {
          name: "get_wbr",
          description: "Get Weekly Business Review with computed statuses",
          inputSchema: {
            type: "object",
            properties: {
              workspace: { type: "string" },
            },
          },
        },
        {
          name: "get_calendar",
          description: "Get calendar events",
          inputSchema: {
            type: "object",
            properties: {
              workspace: { type: "string" },
              startDate: { type: "string" },
              endDate: { type: "string" },
            },
          },
        },
      ],
    };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    const workspace = workspaceOverride || args?.workspace || "demo";

    switch (name) {
      case "get_overview": {
        const users = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.workspaceId, workspace))
          .all();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                totalUsers: users.length,
                viewUrl: buildViewUrl(`${BASE_URL}/dashboard`, { view: "dotplot" }),
              }),
            },
          ],
        };
      }

      case "query_users": {
        const users = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.workspaceId, workspace))
          .limit(args?.limit || 100)
          .all();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                users,
                viewUrl: buildViewUrl(`${BASE_URL}/dashboard`, { view: "dotplot" }),
              }),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Tool ${name} not implemented yet` }],
        };
    }
  }

  return { error: "Unknown method" };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const method = body?.method;
    const params = body?.params ?? {};

    if (method === "tools/list") {
      const result = await handleMCPRequest(body);
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id || null,
        result,
      });
    }

    let workspace: string | undefined;
    if (method === "tools/call") {
      const requested = params?.arguments?.workspace || "demo";
      const toolName = params?.name as string | undefined;
      const write = !isReadOnlyMcpTool(toolName);
      const gated = await gate(request, { workspace: requested, write });
      if (!gated.ok) {
        return gated.response;
      }
      workspace = gated.workspace;
    } else {
      const gated = await gate(request, { write: true });
      if (!gated.ok) {
        return gated.response;
      }
      workspace = gated.workspace;
    }

    const result = await handleMCPRequest(body, workspace);

    return NextResponse.json({
      jsonrpc: "2.0",
      id: body.id || null,
      result,
    });
  } catch {
    logServerError("MCP request failed");
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: "Internal Server Error",
        },
      },
      { status: 500 }
    );
  }
}
