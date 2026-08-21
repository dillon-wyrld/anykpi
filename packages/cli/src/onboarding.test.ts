import { describe, expect, it } from "vitest";
import { READ_KEY_CONSENT, loginReceipt, mcpAddress } from "./onboarding";

describe("CLI login receipt", () => {
  it("prints instance facts, MCP address, and read-key consent", () => {
    const lines = loginReceipt({
      url: "https://kpi.example/",
      scope: "read",
    });
    const text = lines.join("\n");

    expect(mcpAddress("https://kpi.example/")).toBe("https://kpi.example/api/mcp");
    expect(text).toContain("https://kpi.example/api/mcp");
    expect(text).toContain("https://kpi.example/llms.txt");
    expect(text).toContain("AGENTS.md");
    expect(text).toContain("https://kpi.example/agents");
    expect(text).toContain(READ_KEY_CONSENT);
    expect(text).not.toMatch(/Anytime KPI|ANYTIME KPI|Dillon|Midday/i);
  });

  it("omits the read-only consent line for write keys", () => {
    const text = loginReceipt({ url: "http://localhost:3000", scope: "write" }).join(
      "\n"
    );
    expect(text).toContain("http://localhost:3000/api/mcp");
    expect(text).not.toContain(READ_KEY_CONSENT);
  });
});
