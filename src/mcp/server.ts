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
import { authorize } from "@/core/auth";
import { buildViewUrl, queryUsersPayload } from "@/core/view-state";
import {
  CohortCompareError,
  cohortsDashboardQuery,
  parseCohortCompareOptions,
} from "@/core/views/cohort-math";

const BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

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
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const workspace = (args as any)?.workspace || "demo";

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

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    dayN: Math.floor(
                      (new Date().getTime() - new Date("2024-01-01").getTime()) /
                        (1000 * 60 * 60 * 24)
                    ),
                    totalUsers: users.length,
                    syncHealth: syncStates.map((s) => ({
                      source: s.source,
                      sourceName: s.sourceName,
                      status: s.status,
                      lastSynced: s.lastSync,
                    })),
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

        case "get_cohorts": {
          const compare = parseCohortCompareOptions({
            split: (args as { split?: string })?.split,
            series: (args as { series?: string | string[] })?.series,
          });
          const payers = Boolean((args as { payers?: boolean })?.payers);
          const viewQuery = new URLSearchParams({ workspace });
          if (payers) viewQuery.set("payers", "1");
          if (compare.split) viewQuery.set("split", compare.split);
          if (compare.series.length) viewQuery.set("series", compare.series.join(","));

          const response = await fetch(
            `${BASE_URL}/api/views/cohorts?${viewQuery.toString()}`
          );
          const data = await response.json();
          if (!response.ok) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ error: data.error || "Cohorts request failed" }),
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    cohorts: data.cohorts,
                    smilingCount: data.cohorts.filter((c: any) => c.smileDetected).length,
                    pmfForming: data.cohorts.filter((c: any) => c.smileDetected).length >= 3,
                    payers,
                    split: data.split ?? null,
                    series: data.series ?? [],
                    viewUrl: `${BASE_URL}/dashboard?${cohortsDashboardQuery({
                      workspace,
                      payers,
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
          const response = await fetch(`${BASE_URL}/api/views/wbr?workspace=${workspace}`);
          const data = await response.json();

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    metrics: data.metrics,
                    exceptions: data.metrics.filter((m: any) => m.status !== "on"),
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
          const response = await fetch(
            `${BASE_URL}/api/views/calendar?workspace=${workspace}`
          );
          const data = await response.json();

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    events: data.events,
                    viewUrl: buildViewUrl(`${BASE_URL}/dashboard`, {
                      view: "calendar",
                      startDate: (args as any)?.startDate,
                      endDate: (args as any)?.endDate,
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

        case "configure_value_events": {
          const presented = process.env.ANYKPI_API_KEY;
          const writeAuth = await authorize(
            {
              headers: {
                get(name: string) {
                  return name.toLowerCase() === "x-api-key" ? presented ?? null : null;
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
  });

  return server;
}

if (require.main === module) {
  const server = createMCPServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((error) => {
    console.error("MCP server failed");
    process.exit(1);
  });
}
