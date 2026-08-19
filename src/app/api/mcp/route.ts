import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import { buildViewUrl } from "@/core/view-state";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

async function handleMCPRequest(body: any) {
  const { method, params } = body;

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
    const workspace = args?.workspace || "demo";

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
    const result = await handleMCPRequest(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
