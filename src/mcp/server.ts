import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { upsertConfig } from "@/core/upsert";
import { eq, and } from "drizzle-orm";
import { authorize, isReadOnlyMcpTool } from "@/core/auth";
import {
  MCP_WRITE_TOOLS,
  mcpToolResult,
  runMcpWriteTool,
  type McpWriteArgs,
} from "@/core/mcp-write-tools";
import { dayClockFields, workspaceDayClock } from "@/core/day";
import {
  companyDayMilestone,
  loadFoundedAt,
  serializeTodayMilestone,
} from "@/core/milestones";
import { loadWorkspacePresence } from "@/core/presence";
import { buildViewUrl, queryUsersPayload } from "@/core/view-state";
import {
  CohortCompareError,
  cohortsDashboardQuery,
  loadCohortsView,
  parseCohortCompareOptions,
} from "@/core/views/cohorts";
import { loadWbrView } from "@/core/views/wbr";
import { loadCalendarView } from "@/core/views/calendar";
import { activityWindow, buildDotPlotUsers } from "@/core/views/dotplot";
import { ensureWorkspaceClusters } from "@/core/clustering";
import { loadFreshness } from "@/core/freshness";
import { parseSyncIntervalMinutes } from "@/core/scheduler-env";
import { loadWorkspaceSyncStates } from "@/core/sync-health";
import {
  MCP_GET_ACTIVITY_TOOL,
  MCP_GET_SYNC_STATUS_TOOL,
} from "@/core/contracts";

const BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

function toolViewUrl(baseUrl: string, workspace: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  return `${origin}/dashboard?workspace=${encodeURIComponent(workspace)}&view=dotplot`;
}

async function loadActivityPayload(workspace: string, baseUrl: string) {
  await ensureWorkspaceClusters(workspace);

  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspace))
    .all();

  const allActivities = await db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspace))
    .all();

  const { baseDate } = activityWindow([
    ...users.map((user) => user.signupDate),
    ...allActivities.map((row) => row.timestamp),
  ]);
  const matrix = buildDotPlotUsers(users, allActivities);
  const viewUrl = toolViewUrl(baseUrl, workspace);

  return {
    users: matrix,
    days: 28,
    baseDate: baseDate.toISOString(),
    workspace,
    viewUrl,
    view_url: viewUrl,
  };
}

async function loadSyncStates(workspace: string) {
  return loadWorkspaceSyncStates(workspace);
}

async function loadSyncStatusPayload(workspace: string, baseUrl: string) {
  const freshness = await loadFreshness(workspace);
  const viewUrl = toolViewUrl(baseUrl, workspace);
  return {
    ...freshness,
    states: await loadSyncStates(workspace),
    syncIntervalMinutes: parseSyncIntervalMinutes(),
    viewUrl,
    view_url: viewUrl,
  };
}

/** Advertised stdio tools — used by the server and the drift gate. */
export function listStdioMcpTools() {
  return [
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
          workspace: {
            type: "string",
            description: "Workspace ID (default: demo)",
          },
          platform: {
            type: "string",
            description: "Filter by platform (IOS, ANDROID, WEB)",
          },
          country: {
            type: "string",
            description: "Filter by country code",
          },
          limit: {
            type: "number",
            description: "Maximum number of users to return",
          },
        },
      },
    },
    MCP_GET_ACTIVITY_TOOL,
    {
      name: "get_cohorts",
      description:
        "Get cohort retention data with smile flags and PMF verdict. Set split to compare up to 3 series by platform, country, or cluster. Returns data + view URL",
      inputSchema: {
        type: "object",
        properties: {
          workspace: {
            type: "string",
            description: "Workspace ID (default: demo)",
          },
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
      description:
        "Get Weekly Business Review with computed statuses and exception sentences. Returns metrics + view URL",
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
      name: "get_calendar",
      description: "Get calendar events in date range by source. Returns events + view URL",
      inputSchema: {
        type: "object",
        properties: {
          workspace: {
            type: "string",
            description: "Workspace ID (default: demo)",
          },
          startDate: {
            type: "string",
            description: "Start date (ISO format)",
          },
          endDate: {
            type: "string",
            description: "End date (ISO format)",
          },
        },
      },
    },
    MCP_GET_SYNC_STATUS_TOOL,
    {
      name: "install_sdk",
      description:
        "Generate an ANYKPI SDK installation snippet for a web app. Returns snippet code that can be added to HTML",
      inputSchema: {
        type: "object",
        properties: {
          workspace: {
            type: "string",
            description: "Workspace ID (default: live)",
          },
          endpoint: {
            type: "string",
            description: "ANYKPI endpoint URL",
          },
        },
      },
    },
    {
      name: "configure_value_events",
      description:
        "Configure value events mapping for activity tracking. Maps event names to classes (core, search, share, pay)",
      inputSchema: {
        type: "object",
        properties: {
          workspace: {
            type: "string",
            description: "Workspace ID (default: live)",
          },
          mapping: {
            type: "object",
            description:
              "Event mapping, e.g. { core: ['song_played'], search: ['search_performed'], share: ['playlist_shared'], pay: ['checkout_completed'] }",
          },
        },
      },
    },
    ...MCP_WRITE_TOOLS,
  ];
}

export function createMCPServer() {
  const server = new Server(
    {
      name: "anykpi",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: listStdioMcpTools(),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleStdioToolCall(name, args as Record<string, unknown> | undefined);
  });

  return server;
}

export async function handleStdioToolCall(
  name: string,
  args: Record<string, unknown> | undefined
) {
  const write = !isReadOnlyMcpTool(name);
  const workspace =
    (typeof args?.workspace === "string" && args.workspace) || (write ? "live" : "demo");

  try {
    switch (name) {
        case "get_overview": {
          const users = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.workspaceId, workspace))
            .all();

          const syncStates = await db
            .select()
            .from(schema.syncState)
            .where(eq(schema.syncState.workspaceId, workspace))
            .all();

          const clock = await workspaceDayClock(workspace, {
            foundedAt: await loadFoundedAt(workspace),
            signupDates: users.map((user) => user.signupDate),
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ...dayClockFields(clock),
                    todayMilestone: serializeTodayMilestone(
                      companyDayMilestone({
                        workspaceId: workspace,
                        dayN: clock.dayN,
                        foundedAt: clock.foundedAt,
                        timeZone: clock.timeZone,
                      })
                    ),
                    totalUsers: users.length,
                    syncHealth: syncStates.map((s) => ({
                      source: s.source,
                      sourceName: s.sourceName,
                      status: s.status,
                      lastSynced: s.lastSync,
                    })),
                    presence: await loadWorkspacePresence(workspace),
                    viewUrl: buildViewUrl(`${BASE_URL}/dashboard`, {
                      view: "dotplot",
                    }),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "query_users": {
          const conditions = [eq(schema.users.workspaceId, workspace)];
          
          if ((args as any)?.platform) {
            conditions.push(eq(schema.users.platform, (args as any).platform));
          }
          
          if ((args as any)?.country) {
            conditions.push(eq(schema.users.country, (args as any).country));
          }

          const users = await db
            .select()
            .from(schema.users)
            .where(and(...conditions))
            .limit((args as any)?.limit || 100)
            .all();

          const filters = [];
          if ((args as any)?.platform) {
            filters.push({
              field: "platform",
              operator: "eq" as const,
              value: (args as any).platform,
            });
          }
          if ((args as any)?.country) {
            filters.push({
              field: "country",
              operator: "eq" as const,
              value: (args as any).country,
            });
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ...queryUsersPayload(users, BASE_URL, workspace),
                    viewUrl: buildViewUrl(`${BASE_URL}/dashboard`, {
                      view: "dotplot",
                      filters: filters.length > 0 ? filters : undefined,
                    }),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "get_activity": {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  await loadActivityPayload(workspace, BASE_URL),
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "get_sync_status": {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  await loadSyncStatusPayload(workspace, BASE_URL),
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "get_cohorts": {
          const compare = parseCohortCompareOptions({
            split: args?.split as string | undefined,
            series: args?.series as string | string[] | undefined,
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
                text: JSON.stringify(
                  {
                    cohorts: data.cohorts,
                    smilingCount,
                    pmfForming: smilingCount >= 3,
                    payers: data.payers,
                    split: data.split ?? null,
                    series: data.series ?? [],
                    viewUrl: `${BASE_URL}/dashboard?${cohortsDashboardQuery({
                      workspace,
                      payers: data.payers,
                      split: compare.split,
                      series: compare.series.length > 0 ? compare.series : undefined,
                    })}`,
                  },
                  null,
                  2
                ),
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
                text: JSON.stringify(
                  {
                    metrics: data.metrics,
                    proposals: data.proposals,
                    exceptions: data.metrics.filter((m) => m.status !== "ok"),
                    viewUrl: buildViewUrl(`${BASE_URL}/dashboard`, {
                      view: "wbr",
                    }),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "get_calendar": {
          const data = await loadCalendarView(workspace);
          const start = args?.startDate ? Date.parse(String(args.startDate)) : Number.NaN;
          const end = args?.endDate ? Date.parse(String(args.endDate)) : Number.NaN;
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
                text: JSON.stringify(
                  {
                    events,
                    viewUrl: buildViewUrl(`${BASE_URL}/dashboard`, {
                      view: "calendar",
                      startDate: args?.startDate ? String(args.startDate) : undefined,
                      endDate: args?.endDate ? String(args.endDate) : undefined,
                    }),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "install_sdk": {
          const endpoint = (args as any)?.endpoint || BASE_URL;
          const ws = (args as any)?.workspace || "live";

          const snippet = `<script>
  !function(){
    var anykpi = window.anykpi = window.anykpi || [];
    anykpi.init({
      endpoint: "${endpoint}",
      workspaceId: "${ws}",
      debug: true
    });
    anykpi.identify({ 
      userId: "USER_ID", 
      properties: { 
        name: "User Name", 
        email: "user@example.com",
        platform: "WEB"
      }
    });
  }();
</script>
<script src="${endpoint}/sdk.js" async></script>`;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    snippet,
                    instructions:
                      "Add this snippet to your app's HTML. Replace USER_ID, name, and email with actual values. Then call anykpi.track('event_name', {properties}) to track events.",
                    nextStep:
                      "Configure value events with configure_value_events to map your event names to activity classes.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "connect_source":
        case "trigger_sync":
        case "import_csv":
        case "define_metric":
        case "disconnect_source":
        case "annotate": {
          const presented = process.env.ANYKPI_API_KEY;
          const writeAuth = await authorize(
            {
              headers: {
                get(headerName: string) {
                  return headerName.toLowerCase() === "x-api-key" ? presented ?? null : null;
                },
              },
            },
            { write: true, workspace }
          );
          if (!writeAuth.ok) {
            return {
              content: [{ type: "text", text: writeAuth.error }],
              isError: true,
            };
          }

          const result = await runMcpWriteTool(
            name,
            (args ?? {}) as McpWriteArgs,
            workspace,
            BASE_URL
          );
          if (!result) {
            throw new Error(`Unknown tool: ${name}`);
          }
          return mcpToolResult(result);
        }

        case "configure_value_events": {
          const presented = process.env.ANYKPI_API_KEY;
          const writeAuth = await authorize(
            {
              headers: {
                get(headerName: string) {
                  return headerName.toLowerCase() === "x-api-key" ? presented ?? null : null;
                },
              },
            },
            { write: true, workspace }
          );
          if (!writeAuth.ok) {
            return {
              content: [{ type: "text", text: writeAuth.error }],
              isError: true,
            };
          }

          const mapping = (args as any)?.mapping || {};

          await upsertConfig({
            key: "value_events",
            value: JSON.stringify(mapping),
            workspaceId: workspace,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    mapping,
                    message:
                      "Value events configured. These events will now appear in the dot plot and activity views.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof CohortCompareError) {
        return {
          content: [{ type: "text", text: error.message }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: "Internal error",
          },
        ],
        isError: true,
      };
    }
}

if (require.main === module) {
  const server = createMCPServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((error) => {
    console.error("MCP server failed");
    process.exit(1);
  });
}
