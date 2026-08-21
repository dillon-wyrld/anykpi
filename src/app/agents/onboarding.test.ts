import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSTANCE_ORIGIN,
  KEY_SCOPE_ITEMS,
  READ_KEY_CONSENT,
  buildAgentPrompt,
  clientTabs,
  consentForScope,
  llmsTxtUrl,
  mcpAddress,
  normalizeOrigin,
} from "./onboarding";

const root = resolve(__dirname, "../..", "..");

describe("agent onboarding copy", () => {
  it("builds a self-contained prompt with instance, facts, and how to ask for a key", () => {
    const origin = "https://kpi.example";
    const prompt = buildAgentPrompt(origin);

    expect(prompt).toContain("ANYKPI");
    expect(prompt).toContain(origin);
    expect(prompt).toContain(`${origin}/llms.txt`);
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain(`${origin}/agents`);
    expect(prompt).toContain("ANYKPI_API_KEY");
    expect(prompt).toContain("no unauthenticated first-key endpoint");
    expect(prompt).toContain(READ_KEY_CONSENT);
    expect(prompt).toContain(`${origin}/api/mcp`);
    expect(prompt).toContain("get_overview");
    expect(prompt).not.toMatch(/Anytime KPI|ANYTIME KPI/i);
    expect(prompt).not.toMatch(/Midday|T3|Dillon/i);
  });

  it("defaults the instance to localhost when origin is missing", () => {
    expect(normalizeOrigin()).toBe(DEFAULT_INSTANCE_ORIGIN);
    expect(mcpAddress()).toBe(`${DEFAULT_INSTANCE_ORIGIN}/api/mcp`);
    expect(llmsTxtUrl("http://localhost:3000/")).toBe(
      `${DEFAULT_INSTANCE_ORIGIN}/llms.txt`
    );
    expect(buildAgentPrompt()).toContain(DEFAULT_INSTANCE_ORIGIN);
  });

  it("lists true scopes and the read-key consent sentence", () => {
    expect(KEY_SCOPE_ITEMS.map((item) => item.scope)).toEqual([
      "read",
      "write",
      "admin",
    ]);
    expect(consentForScope("read")).toBe(READ_KEY_CONSENT);
    expect(KEY_SCOPE_ITEMS[0]?.summary).toMatch(/nothing else/i);
    expect(KEY_SCOPE_ITEMS[1]?.summary).toMatch(/Cannot approve outreach/);
    expect(KEY_SCOPE_ITEMS[2]?.summary).toMatch(/approve outreach/);
  });

  it("gives each client numbered steps and the same MCP address", () => {
    const origin = "https://kpi.example";
    const mcp = mcpAddress(origin);
    const tabs = clientTabs(origin);
    const ids = tabs.map((tab) => tab.id);

    expect(ids).toEqual(["claude", "chatgpt", "cursor", "claude-code", "cli"]);
    for (const tab of tabs) {
      expect(tab.steps.length).toBeGreaterThanOrEqual(3);
      expect(tab.steps.some((step) => step.includes(mcp))).toBe(true);
    }

    const cli = tabs.find((tab) => tab.id === "cli");
    expect(cli?.steps.join("\n")).toMatch(/npx @anykpi\/cli login/);
    expect(cli?.steps.join("\n")).toContain(READ_KEY_CONSENT);
  });
});

describe("in-app agent links are live", () => {
  it("does not point /connect at a dead agent-setup address", () => {
    const connect = readFileSync(resolve(root, "src/app/connect/page.tsx"), "utf8");
    expect(connect).not.toContain("#agent-setup");
    expect(connect).not.toContain("github.com/anykpi/anykpi");
    expect(connect).toContain('href="/agents"');
    expect(connect).toContain("id=\"agents\"");
    expect(connect).toContain("Copy prompt");
    expect(connect).toContain("READ_KEY_CONSENT");
  });

  it("keeps the /agents page on the shipped onboarding helpers", () => {
    const page = readFileSync(resolve(root, "src/app/agents/page.tsx"), "utf8");
    expect(page).toContain("buildAgentPrompt");
    expect(page).toContain("copy-mcp-address");
    expect(page).toContain("Revoke");
    expect(page).not.toContain("github.com/anykpi/anykpi");
    expect(page).not.toContain("@anykpi/cli\", \"mcp\"");
  });
});
