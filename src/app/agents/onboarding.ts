/**
 * Agent onboarding copy shared by /agents and the setup Agents step.
 * Prompt + MCP address + per-client steps. No network.
 */

export const DEFAULT_INSTANCE_ORIGIN = "http://localhost:3000";

export const READ_KEY_CONSENT =
  "with this key an agent can: read every view and ask questions — and nothing else.";

export type AgentClientId =
  | "claude"
  | "chatgpt"
  | "cursor"
  | "claude-code"
  | "cli";

export type KeyScopeId = "read" | "write" | "admin";

export function normalizeOrigin(origin?: string): string {
  const raw = (origin ?? "").trim().replace(/\/+$/, "");
  return raw || DEFAULT_INSTANCE_ORIGIN;
}

export function mcpAddress(origin?: string): string {
  return `${normalizeOrigin(origin)}/api/mcp`;
}

export function llmsTxtUrl(origin?: string): string {
  return `${normalizeOrigin(origin)}/llms.txt`;
}

export function agentsPageUrl(origin?: string): string {
  return `${normalizeOrigin(origin)}/agents`;
}

export function connectPageUrl(origin?: string): string {
  return `${normalizeOrigin(origin)}/connect`;
}

/** Self-contained prompt for a fresh agent session. */
export function buildAgentPrompt(origin?: string): string {
  const base = normalizeOrigin(origin);
  const facts = llmsTxtUrl(base);
  const mcp = mcpAddress(base);
  const agents = agentsPageUrl(base);
  const connect = connectPageUrl(base);

  return [
    "You are connecting to ANYKPI, a self-hosted dashboard + REST API + CLI + MCP.",
    "",
    `Instance: ${base}`,
    `Machine-readable facts: ${facts}`,
    "Repo onboarding (same facts): AGENTS.md",
    "",
    `Ask the operator for a read API key. They mint one at ${agents} (or ${connect}) by presenting ANYKPI_API_KEY. There is no unauthenticated first-key endpoint. ${READ_KEY_CONSENT}`,
    "",
    "Then:",
    `1. Read ${facts}.`,
    `2. Connect MCP at ${mcp}. Send the key as Authorization: Bearer <key> or x-api-key.`,
    `3. Call get_overview (workspace demo is public-read) or GET ${base}/api/v1/overview?workspace=demo.`,
    "",
    "Every answer includes a view_url that opens the dashboard in the state that proves it.",
  ].join("\n");
}

export const KEY_SCOPE_ITEMS: ReadonlyArray<{
  scope: KeyScopeId;
  summary: string;
}> = [
  {
    scope: "read",
    summary: "Default. Read every view and ask questions — and nothing else.",
  },
  {
    scope: "write",
    summary:
      "Ingest, connect sources, sync, import, and queue outreach. Cannot approve outreach.",
  },
  {
    scope: "admin",
    summary:
      "Write plus mint admin keys, archive live workspaces, and approve outreach.",
  },
];

export function consentForScope(scope: KeyScopeId): string {
  if (scope === "read") return READ_KEY_CONSENT;
  if (scope === "write") {
    return "with this key an agent can: read every view, ingest events, connect sources, sync, import, and queue outreach — not approve outreach or archive workspaces.";
  }
  return "with this key an agent can: do everything a write key can, mint admin keys, archive live workspaces, and approve outreach.";
}

export type ClientTab = {
  id: AgentClientId;
  label: string;
  steps: string[];
};

export function clientTabs(origin?: string): ClientTab[] {
  const base = normalizeOrigin(origin);
  const mcp = mcpAddress(base);
  const facts = llmsTxtUrl(base);

  return [
    {
      id: "claude",
      label: "Claude",
      steps: [
        "Open Claude settings. On the web: Connectors. On Desktop: Developer → Edit Config.",
        `Add a custom MCP server and paste the MCP address: ${mcp}`,
        "Add the read API key as Authorization: Bearer <key>.",
        "Start a new chat and ask for the company overview.",
      ],
    },
    {
      id: "chatgpt",
      label: "ChatGPT",
      steps: [
        "Open ChatGPT settings → Apps / Connectors (enable Developer mode if asked).",
        `Add a custom MCP server and paste the MCP address: ${mcp}`,
        "Add the read API key as Authorization: Bearer <key>.",
        "Start a new chat and ask for the company overview.",
      ],
    },
    {
      id: "cursor",
      label: "Cursor",
      steps: [
        "Open Cursor Settings → MCP, or create .cursor/mcp.json in the project.",
        `Set the server url to the MCP address: ${mcp}`,
        'Add headers: Authorization: Bearer <key>.',
        "Open Agent chat and ask for the company overview.",
      ],
    },
    {
      id: "claude-code",
      label: "Claude Code",
      steps: [
        `Run: claude mcp add --transport http anykpi ${mcp}`,
        'Add the key: --header "Authorization: Bearer <key>"',
        `Or write .mcp.json with url ${mcp} and the same header.`,
        "Ask for the company overview in a Claude Code session.",
      ],
    },
    {
      id: "cli",
      label: "CLI",
      steps: [
        `Mint a read key: npx @anykpi/cli login --url=${base} --key=<ANYKPI_API_KEY> --name="Agent"`,
        `Default scope is read. ${READ_KEY_CONSENT}`,
        "Query: anykpi overview   (also: anykpi users --json, anykpi cohorts, anykpi wbr)",
        `Facts stay at ${facts} and AGENTS.md. HTTP MCP address: ${mcp}`,
      ],
    },
  ];
}
