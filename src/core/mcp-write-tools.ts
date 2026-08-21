/**
 * MCP write tools — connect_source, trigger_sync, import_csv,
 * define_metric, disconnect_source, annotate.
 *
 * HTTP and stdio advertise the same schemas. Callers gate write scope.
 * Successful payloads include a dashboard view_url that proves the result.
 */

import { getConnector, resolveSources, sync } from "@/connectors";
import {
  AnnotateRequestSchema,
  ConnectSourceRequestSchema,
  DefineMetricRequestSchema,
  DisconnectSourceRequestSchema,
  ImportRequestSchema,
  MCP_ANNOTATE_TOOL,
  MCP_DEFINE_METRIC_TOOL,
  MCP_DISCONNECT_SOURCE_TOOL,
  SyncTriggerRequestSchema,
} from "./contracts";
import {
  AnnotateError,
  annotationViewUrl,
  createAnnotation,
  serializeAnnotation,
} from "./annotations";
import {
  WbrBuilderError,
  deckViewUrl,
  defineMetric,
  definedMetricPayload,
} from "./wbr-builder";
import {
  CSV_SOURCE,
  csvSourceConfig,
  formatImportErrors,
  parseCsvSourceConfig,
  runCsvImport,
} from "./csv-import";
import {
  disconnectSource,
  hasInstanceSecret,
  loadSourceConfig,
  saveSourceConfig,
} from "./sources";
import { loadWorkspaceSyncStates } from "./sync-health";

export const MCP_WRITE_TOOL_NAMES = [
  "connect_source",
  "trigger_sync",
  "import_csv",
  "define_metric",
  "disconnect_source",
  "annotate",
] as const;

export type McpWriteToolName = (typeof MCP_WRITE_TOOL_NAMES)[number];

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, Record<string, unknown>>;
  };
};

export const MCP_WRITE_TOOLS: McpToolDefinition[] = [
  {
    name: "connect_source",
    description:
      "Store per-source credentials encrypted at rest. Requires a write-scoped API key. Credentials are never returned. Returns connected + view_url.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Workspace ID (default: live)",
        },
        source: {
          type: "string",
          description: "Source id (ics, csv, or a connector slug)",
        },
        credentials: {
          type: "object",
          description:
            "Per-source credentials. Never echoed. csv stores kind + mapping.",
        },
      },
    },
  },
  {
    name: "trigger_sync",
    description:
      "Trigger a connector sync for one source or all registered sources. Requires a write-scoped API key. Returns results, states, and view_url.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Workspace ID (default: live)",
        },
        source: {
          type: "string",
          description:
            "Connector source to sync. Omit or pass all to run every registered source.",
        },
      },
    },
  },
    {
      name: "import_csv",
      description:
        "Import users or events from CSV. Requires a write-scoped API key. Optional preview returns column mapping without writing. Returns import counts and view_url.",
      inputSchema: {
        type: "object",
        properties: {
          workspace: {
            type: "string",
            description: "Workspace ID (default: live)",
          },
          csv: {
            type: "string",
            description: "CSV text (header row required)",
          },
          kind: {
            type: "string",
            enum: ["users", "events"],
            description: "File kind. Detected from columns when omitted.",
          },
          mapping: {
            type: "object",
            description:
              "Column to field mapping. Reuses the csv source mapping when omitted.",
          },
          preview: {
            type: "boolean",
            description: "When true, return column mapping without writing.",
          },
        },
      },
    },
    MCP_DEFINE_METRIC_TOOL,
    MCP_DISCONNECT_SOURCE_TOOL,
    MCP_ANNOTATE_TOOL,
  ];

export type McpWriteArgs = {
  workspace?: string;
  source?: string | Record<string, unknown>;
  credentials?: Record<string, unknown>;
  csv?: string;
  kind?: string;
  mapping?: Record<string, unknown>;
  preview?: boolean;
  targetType?: string;
  targetId?: string;
  content?: string;
  id?: string;
  name?: string;
  section?: string;
  type?: string;
  unit?: string;
  target?: number;
  goodDir?: string;
  owner?: string;
  points?: unknown;
};

export type McpWriteResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

export type McpToolContent = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function writeViewUrl(baseUrl: string, workspace: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  return `${origin}/dashboard?workspace=${encodeURIComponent(workspace)}&view=dotplot`;
}

function withViewUrl(
  payload: Record<string, unknown>,
  baseUrl: string,
  workspace: string
): Record<string, unknown> {
  const viewUrl = writeViewUrl(baseUrl, workspace);
  return { ...payload, viewUrl, view_url: viewUrl };
}

async function loadStates(workspace: string) {
  return loadWorkspaceSyncStates(workspace);
}

function asStringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return null;
    out[key] = item;
  }
  return out;
}

export async function runConnectSource(
  args: McpWriteArgs,
  workspace: string,
  baseUrl: string
): Promise<McpWriteResult> {
  const credentials = asStringRecord(args.credentials);
  if (!credentials) {
    return { ok: false, error: "Bad Request" };
  }

  if (typeof args.source !== "string") {
    return { ok: false, error: "Bad Request" };
  }

  const parsed = ConnectSourceRequestSchema.safeParse({
    source: args.source,
    credentials,
    workspaceId: workspace,
  });
  if (!parsed.success) {
    return { ok: false, error: "Bad Request" };
  }

  const entries = Object.entries(parsed.data.credentials);
  if (entries.length === 0 || entries.some(([, value]) => value.length === 0)) {
    return { ok: false, error: "Bad Request" };
  }

  if (!hasInstanceSecret()) {
    return { ok: false, error: "set ANYKPI_SECRET" };
  }

  const { rotated } = await saveSourceConfig(
    workspace,
    parsed.data.source,
    parsed.data.credentials
  );

  return {
    ok: true,
    payload: withViewUrl(
      {
        source: parsed.data.source,
        workspaceId: workspace,
        connected: true,
        rotated,
      },
      baseUrl,
      workspace
    ),
  };
}

export async function runTriggerSync(
  args: McpWriteArgs,
  workspace: string,
  baseUrl: string
): Promise<McpWriteResult> {
  const parsed = SyncTriggerRequestSchema.safeParse({
    source: typeof args.source === "string" ? args.source : undefined,
    workspace,
  });
  if (!parsed.success) {
    return { ok: false, error: "Bad Request" };
  }

  const sourceArg = parsed.data.source;
  const sources = resolveSources(sourceArg);
  for (const source of sources) {
    if (!getConnector(source)) {
      return { ok: false, error: `Unknown connector source: ${source}` };
    }
  }

  const results = await Promise.all(
    sources.map(async (source) => {
      const result = await sync(source, workspace);
      return { source, ...result };
    })
  );

  return {
    ok: true,
    payload: withViewUrl(
      {
        results,
        states: await loadStates(workspace),
        workspace,
      },
      baseUrl,
      workspace
    ),
  };
}

export async function runImportCsv(
  args: McpWriteArgs,
  workspace: string,
  baseUrl: string
): Promise<McpWriteResult> {
  const mapping =
    args.mapping === undefined ? undefined : asStringRecord(args.mapping);
  if (args.mapping !== undefined && !mapping) {
    return { ok: false, error: "Bad Request" };
  }

  const parsed = ImportRequestSchema.safeParse({
    csv: args.csv,
    kind: args.kind,
    mapping,
    preview: args.preview,
    workspaceId: workspace,
  });
  if (!parsed.success) {
    return { ok: false, error: "Bad Request" };
  }

  if (!parsed.data.preview && !hasInstanceSecret()) {
    return { ok: false, error: "set ANYKPI_SECRET" };
  }

  const stored = parseCsvSourceConfig(
    await loadSourceConfig(workspace, CSV_SOURCE)
  );
  const resolvedMapping =
    parsed.data.mapping && Object.keys(parsed.data.mapping).length > 0
      ? parsed.data.mapping
      : stored.mapping;

  const outcome = await runCsvImport({
    csv: parsed.data.csv,
    kind: parsed.data.kind ?? stored.kind,
    mapping: resolvedMapping,
    preview: parsed.data.preview,
    workspaceId: workspace,
  });

  if (outcome.status === "preview") {
    return {
      ok: true,
      payload: withViewUrl({ ...outcome.preview }, baseUrl, workspace),
    };
  }

  if (outcome.status === "invalid") {
    return { ok: false, error: formatImportErrors(outcome.errors) };
  }

  await saveSourceConfig(
    workspace,
    CSV_SOURCE,
    csvSourceConfig(outcome.result.kind, resolvedMapping ?? {})
  );

  return {
    ok: true,
    payload: withViewUrl({ ...outcome.result }, baseUrl, workspace),
  };
}

export async function runDefineMetric(
  args: McpWriteArgs,
  workspace: string,
  baseUrl: string
): Promise<McpWriteResult> {
  if ("status" in args || "statusReason" in args) {
    return { ok: false, error: "status is computed and cannot be written" };
  }
  const parsed = DefineMetricRequestSchema.safeParse({
    id: args.id,
    name: args.name,
    section: args.section,
    type: args.type,
    unit: args.unit,
    target: args.target,
    goodDir: args.goodDir,
    owner: args.owner,
    source: args.source,
    points: args.points,
    workspace,
  });
  if (!parsed.success) {
    return { ok: false, error: "Bad Request" };
  }
  try {
    const row = await defineMetric(workspace, parsed.data);
    const viewUrl = deckViewUrl(baseUrl, workspace);
    return {
      ok: true,
      payload: {
        metric: definedMetricPayload(row),
        workspace,
        viewUrl,
        view_url: viewUrl,
      },
    };
  } catch (error) {
    if (error instanceof WbrBuilderError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export async function runAnnotate(
  args: McpWriteArgs,
  workspace: string,
  baseUrl: string
): Promise<McpWriteResult> {
  const parsed = AnnotateRequestSchema.safeParse({
    type: args.type,
    targetType: args.targetType,
    targetId: args.targetId,
    content: args.content,
    workspace,
  });
  if (!parsed.success) {
    return { ok: false, error: "Bad Request" };
  }
  try {
    const row = await createAnnotation(workspace, parsed.data);
    const viewUrl = annotationViewUrl(
      baseUrl,
      workspace,
      row.targetType,
      row.targetId
    );
    return {
      ok: true,
      payload: {
        annotation: serializeAnnotation(row),
        workspace,
        viewUrl,
        view_url: viewUrl,
      },
    };
  } catch (error) {
    if (error instanceof AnnotateError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export async function runDisconnectSource(
  args: McpWriteArgs,
  workspace: string,
  baseUrl: string
): Promise<McpWriteResult> {
  if (typeof args.source !== "string") {
    return { ok: false, error: "Bad Request" };
  }

  const parsed = DisconnectSourceRequestSchema.safeParse({
    source: args.source,
    workspaceId: workspace,
  });
  if (!parsed.success) {
    return { ok: false, error: "Bad Request" };
  }

  const { disconnected } = await disconnectSource(workspace, parsed.data.source);
  if (!disconnected) {
    return { ok: false, error: "Not Found" };
  }

  return {
    ok: true,
    payload: withViewUrl(
      {
        source: parsed.data.source,
        workspaceId: workspace,
        disconnected: true,
      },
      baseUrl,
      workspace
    ),
  };
}

export async function runMcpWriteTool(
  name: string,
  args: McpWriteArgs,
  workspace: string,
  baseUrl: string
): Promise<McpWriteResult | null> {
  switch (name) {
    case "connect_source":
      return runConnectSource(args, workspace, baseUrl);
    case "trigger_sync":
      return runTriggerSync(args, workspace, baseUrl);
    case "import_csv":
      return runImportCsv(args, workspace, baseUrl);
    case "define_metric":
      return runDefineMetric(args, workspace, baseUrl);
    case "disconnect_source":
      return runDisconnectSource(args, workspace, baseUrl);
    case "annotate":
      return runAnnotate(args, workspace, baseUrl);
    default:
      return null;
  }
}

export function mcpToolResult(result: McpWriteResult): McpToolContent {
  if (!result.ok) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: result.error }) }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(result.payload) }],
  };
}
