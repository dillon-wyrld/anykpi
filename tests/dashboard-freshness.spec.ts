import { test, expect } from "@playwright/test";

const API_KEY = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";

test.describe("Dashboard updates in place", () => {
  test("track() appears on the dot plot without a reload", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    const freshnessReady = page.waitForResponse(
      (res) => res.url().includes("/api/v1/freshness") && res.ok(),
      { timeout: 15_000 }
    );
    await page.goto("/dashboard?workspace=demo&view=dotplot");
    await page.waitForSelector('svg[role="img"]', { timeout: 15_000 });
    await freshnessReady;

    const stamp = Date.now();
    const userId = `fresh-e2e-${stamp}`;
    const name = `Fresh ${stamp}`;

    const tracked = await request.post("/api/ingest/event", {
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "x-api-key": API_KEY,
      },
      data: {
        userId,
        eventName: "freshness_ping",
        workspaceId: "demo",
        properties: { name, platform: "web" },
      },
    });
    expect(tracked.ok(), `track failed: ${tracked.status()}`).toBeTruthy();

    const row = page.getByTestId(`person-name-person_${userId}`);
    await expect(row).toBeAttached({ timeout: 60_000 });
    await expect(page).toHaveURL(/view=dotplot/);
  });
});
