import { test, expect } from "@playwright/test";
import { callMcpTool, parseMcpPayload } from "./helpers/verify-ingest";

const OPERATOR_KEY = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";

const CLIENTS = ["claude", "chatgpt", "cursor", "claude-code", "cli"] as const;

async function mintAgentKey(page: import("@playwright/test").Page): Promise<{
  key: string;
  id: string;
}> {
  await page.getByPlaceholder("Required to mint a new key").fill(OPERATOR_KEY);
  await page.getByRole("button", { name: "Generate API Key" }).click();
  await expect(page.getByText(/won't be shown again/)).toBeVisible();
  const minted = await page.getByTestId("minted-key").inputValue();
  expect(minted).toMatch(/^ak_/);
  const id = minted.split(".")[0];
  expect(id).toMatch(/^ak_/);
  return { key: minted, id };
}

test.describe("Agent onboarding (ANY-60)", () => {
  test("prompt + tabs + minted read key query, then revoke kills access", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/agents");

    const prompt = await page.getByTestId("agent-prompt").innerText();
    expect(prompt).toContain("http://localhost:3000");
    expect(prompt).toContain("http://localhost:3000/llms.txt");
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain("ANYKPI_API_KEY");
    expect(prompt).toContain("no unauthenticated first-key endpoint");
    expect(prompt).toMatch(
      /with this key an agent can: read every view and ask questions — and nothing else/i
    );

    const facts = await request.get("/llms.txt");
    expect(facts.ok()).toBeTruthy();
    expect(await facts.text()).toContain("ANYKPI");

    const mcp = (await page.getByTestId("mcp-address").innerText()).trim();
    expect(mcp).toBe("http://localhost:3000/api/mcp");

    for (const id of CLIENTS) {
      await page.getByTestId(`client-tab-${id}`).click();
      await expect(page.getByTestId(`client-steps-${id}`)).toBeVisible();
      const steps = await page.getByTestId(`client-steps-${id}`).innerText();
      expect(steps).toContain(mcp);
      await expect(page.getByTestId("mcp-address")).toHaveText(mcp);
    }

    await expect(page.getByTestId("key-consent")).toContainText(
      "read every view and ask questions"
    );
    await expect(page.getByTestId("key-scope-list")).toContainText("read");
    await expect(page.getByTestId("key-scope-list")).toContainText("write");
    await expect(page.getByTestId("key-scope-list")).toContainText("admin");

    const { key, id } = await mintAgentKey(page);
    await expect(page.getByTestId("minted-key-scope")).toContainText("read");
    await expect(page.getByTestId(`key-row-${id}`)).toBeVisible();
    await expect(page.getByTestId(`key-row-${id}`)).toContainText("read");

    const overview = await request.get("/api/v1/overview?workspace=live", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(overview.ok(), `overview with minted key ${overview.status()}`).toBeTruthy();
    const overviewBody = (await overview.json()) as { view_url?: string; workspace?: string };
    expect(overviewBody.workspace).toBe("live");
    expect(overviewBody.view_url).toMatch(/\/dashboard/);

    const { response: mcpRes, body: mcpBody } = await callMcpTool(
      request,
      "get_overview",
      { workspace: "live" },
      { Authorization: `Bearer ${key}` }
    );
    expect(mcpRes.ok(), `MCP get_overview ${mcpRes.status()}`).toBeTruthy();
    const payload = parseMcpPayload(mcpBody);
    expect(payload.viewUrl ?? payload.view_url).toBeTruthy();

    await page.getByTestId(`revoke-key-${id}`).click();
    await expect(page.getByTestId(`key-row-${id}`)).toHaveCount(0);

    const after = await request.get("/api/v1/overview?workspace=live", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(after.status()).toBe(401);

    const { response: mcpAfter } = await callMcpTool(
      request,
      "get_overview",
      { workspace: "live" },
      { Authorization: `Bearer ${key}` }
    );
    expect(mcpAfter.status()).toBe(401);
  });

  test("setup Agents step and /connect links are live", async ({ page }) => {
    await page.goto("/connect");

    await expect(page.locator("#agents")).toBeVisible();
    await page.getByTestId("agents-setup-step").click();
    await expect(page.getByRole("heading", { name: "Agents step" })).toBeVisible();

    const prompt = await page.getByTestId("connect-agent-prompt").innerText();
    expect(prompt).toContain("/llms.txt");
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain("ANYKPI_API_KEY");

    const hrefs = await page.locator('a[href]').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href") || "")
    );
    expect(hrefs.some((href) => href === "/agents" || href.startsWith("/agents"))).toBe(
      true
    );
    expect(hrefs.some((href) => href.includes("#agent-setup"))).toBe(false);
    expect(hrefs.some((href) => href.includes("github.com/anykpi/anykpi"))).toBe(false);

    await page.goto("/agents");
    await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
    await expect(page.getByTestId("agent-prompt")).toBeVisible();
  });
});
