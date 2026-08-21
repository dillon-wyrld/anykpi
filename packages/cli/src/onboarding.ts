/**
 * Terminal-agent receipt after `anykpi login`.
 * Same facts as /agents: instance, /llms.txt, AGENTS.md, MCP address, read-key consent.
 */

export const READ_KEY_CONSENT =
  "with this key an agent can: read every view and ask questions — and nothing else.";

export function normalizeOrigin(origin?: string): string {
  const raw = (origin ?? "").trim().replace(/\/+$/, "");
  return raw || "http://localhost:3000";
}

export function mcpAddress(origin?: string): string {
  return `${normalizeOrigin(origin)}/api/mcp`;
}

export function loginReceipt(options: {
  url: string;
  scope: string;
}): string[] {
  const base = normalizeOrigin(options.url);
  const lines = [
    `MCP address: ${mcpAddress(base)}`,
    `Facts: ${base}/llms.txt (same as AGENTS.md)`,
    `Agents: ${base}/agents`,
  ];
  if (options.scope === "read") {
    lines.push(READ_KEY_CONSENT);
  }
  return lines;
}
