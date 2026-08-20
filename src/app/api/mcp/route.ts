import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { and, eq } from "drizzle-orm";
import { buildViewUrl, publicBaseUrl, queryUsersPayload } from "@/core/view-state";
import { recordMcpWriteAudit } from "@/core/audit";
import { isReadOnlyMcpTool, type AuthOk } from "@/core/auth";
import { gate } from "@/core/session-auth";
import { logServerError } from "@/core/errors";
import {
  CohortCompareError,
  cohortsDashboardQuery,
  loadCohortsView,
  parseCohortCompareOptions,
} from "@/core/views/cohorts";
import { loadSyncHealth } from "@/core/sync-health";
import { loadWbrView } from "@/core/views/wbr";
import { loadCalendarView } from "@/core/views/calendar";

type ToolArgs = {
  workspace?: string;
  platform?: string;
  country?: string;
  limit?: number;
  startDate?: string;
  endDate?: string;
  payers?: boolean;
  split?: string;
  series?: string | string[];
};

async function handleMCPRequest(
  body: Record<string, unknown>,
  workspaceOverride?: string,
  request?: NextRequest
) {
  const method = body.method;
  const params = (body.params ?? {}) as {
    name?: string;
    arguments?: ToolArgs;
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
            "Filter and group users by platform, country, or behavior. Returns users + per-user view_url",
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
          description:
            "Get cohort retention data with smile flags and PMF verdict. Set payers to filter to people on the revenue join. Set split to compare up to 3 series by platform, country, or cluster.",
          inputSchema: {
            type: "object",
            properties: {
              workspace: { type: "string" },
              payers: {
                type: "boolean",
                description: "When true, keep only paying people",
              },
              split: {
                type: "string",
                enum: ["platform", "country", "cluster"],
                description: "Compare retention curves by this field (max 3 series)",
              },
              series: {
                type: "string",
                description:
                  "Comma-separated split values, max 3. A fourth series is refused.",
              },
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
    const baseUrl = publicBaseUrl(request);

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
                syncHealth: await loadSyncHealth(workspace),
                viewUrl: buildViewUrl(`${baseUrl}/dashboard`, { view: "dotplot" }),
              }),
            },
          ],
        };
      }

      case "query_users": {
        const conditions = [eq(schema.users.workspaceId, workspace)];
        if (args?.platform) {
          conditions.push(eq(schema.users.platform, args.platform));
        }
        if (args?.country) {
          conditions.push(eq(schema.users.country, args.country));
        }

        const users = await db
          .select()
          .from(schema.users)
          .where(and(...conditions))
          .limit(args?.limit || 100)
          .all();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ...queryUsersPayload(users, baseUrl, workspace),
                viewUrl: buildViewUrl(`${baseUrl}/dashboard`, { view: "dotplot" }),
              }),
            },
          ],
        };
      }

      case "get_cohorts": {
        const compare = parseCohortCompareOptions({
          split: args?.split,
          series: args?.series,
        });
        const data = await loadCohortsView(workspace, "week", {
          payers: Boolean(args?.payers),
          split: compare.split,
          series: compare.series,
        });
        const smilingCount = data.cohorts.filter((c) => c.smileDetected).length;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                cohorts: data.cohorts,
                smilingCount,
                pmfForming: smilingCount >= 3,
                payers: data.payers,
                split: data.split,
                series: data.series,
                viewUrl: `${baseUrl}/dashboard?${cohortsDashboardQuery({
                  workspace,
                  payers: data.payers,
                  split: data.split,
                  series: compare.series.length > 0 ? compare.series : undefined,
                })}`,
              }),
            },
          ],
        };
      }

      case "get_wbr": {
        const data = await loadWbrView(workspace);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                metrics: data.metrics,
                exceptions: data.metrics.filter((m) => m.status !== "ok"),
                viewUrl: buildViewUrl(`${baseUrl}/dashboard`, { view: "wbr" }),
              }),
            },
          ],
        };
      }

      case "get_calendar": {
        const data = await loadCalendarView(workspace);
        const start = args?.startDate ? Date.parse(args.startDate) : Number.NaN;
        const end = args?.endDate ? Date.parse(args.endDate) : Number.NaN;
        const events = data.events.filter((event) => {
          const ts = Date.parse(event.date);
          if (Number.isNaN(ts)) return true;
          if (!Number.isNaN(start) && ts < start) return false;
          if (!Number.isNaN(end) && ts > end) return false;
          return true;
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                events,
                viewUrl: buildViewUrl(`${baseUrl}/dashboard`, {
                  view: "calendar",
                  startDate: args?.startDate,
                  endDate: args?.endDate,
                }),
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
      const result = await handleMCPRequest(body, undefined, request);
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id || null,
        result,
      });
    }

    let workspace: string | undefined;
    let auth: AuthOk;
    if (method === "tools/call") {
      const requested = params?.arguments?.workspace || "demo";
      const toolName = params?.name as string | undefined;
      const write = !isReadOnlyMcpTool(toolName);
      const gated = await gate(request, { workspace: requested, write });
      if (!gated.ok) {
        return gated.response;
      }
      workspace = gated.workspace;
      auth = gated.auth;
    } else {
      const gated = await gate(request, { write: true });
      if (!gated.ok) {
        return gated.response;
      }
      workspace = gated.workspace;
      auth = gated.auth;
    }

    const result = await handleMCPRequest(body, workspace, request);

    if (method === "tools/call" && workspace) {
      await recordMcpWriteAudit({
        auth,
        workspaceId: workspace,
        toolName: params?.name as string | undefined,
        result,
      });
    }

    return NextResponse.json({
      jsonrpc: "2.0",
      id: body.id || null,
      result,
    });
  } catch (error) {
    if (error instanceof CohortCompareError) {
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32602, message: error.message },
        },
        { status: 400 }
      );
    }
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
