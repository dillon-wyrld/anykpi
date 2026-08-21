import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { browserSnippet } from "../packages/sdk/src/snippet";

const ADMIN = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";
const WS_SYNC = "e2e-daytrack-sync";
const WS_SNIPPET = "e2e-daytrack-snip";

async function adminJson(
  request: APIRequestContext,
  method: string,
  url: string,
  body?: unknown
) {
  return request.fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${ADMIN}`,
      "content-type": "application/json",
    },
    data: body,
  });
}

async function mintWriteKey(request: APIRequestContext, workspace: string) {
  const created = await adminJson(request, "POST", "/api/v1/keys", {
    name: `${workspace}-e2e`,
    scope: "write",
    workspace,
  });
  expect(created.ok(), `mint key ${workspace} ${created.status()}`).toBeTruthy();
  const body = (await created.json()) as { key: string };
  expect(body.key).toMatch(/^ak_/);
  return body.key;
}

async function unlock(page: Page, workspace: string, key: string) {
  await page.goto(`/dashboard?workspace=${workspace}&view=dotplot`);
  const unlockHeading = page.getByRole("heading", { name: `Unlock ${workspace}` });
  const module = page.getByTestId("daytrack");
  await expect(unlockHeading.or(module)).toBeVisible({ timeout: 20_000 });
  if (await unlockHeading.isVisible()) {
    await page.getByLabel("API key").fill(key);
    await page.getByRole("button", { name: "Open workspace" }).click();
    await expect(unlockHeading).toHaveCount(0);
  }
  await expect(module).toBeVisible({ timeout: 20_000 });
}

test.describe("Day of YourCo sidebar", () => {
  test("demo workspace renders the full module labeled as demo", async ({
    page,
  }) => {
    await page.goto("/dashboard?workspace=demo&view=dotplot");
    await page.waitForSelector("[data-testid=daytrack]", { timeout: 20_000 });

    const module = page.getByTestId("daytrack");
    await expect(module).toBeVisible();
    await expect(page.getByTestId("daytrack-label")).toHaveText(/day of yourco/i);
    await expect(page.getByTestId("daytrack-demo")).toHaveText(/demo/i);
    await expect(page.getByTestId("daytrack-freshness")).toHaveCount(0);
    await expect(page.getByTestId("daytrack-day")).toHaveText(/^\d+$/);
    await expect(page.getByTestId("daytrack-left")).toHaveText(/\d+h \d+m left/);
    await expect(page.getByTestId("daytrack-founded")).toHaveText(/Founded /);
    await expect(page.getByTestId("daytrack-online")).toBeVisible();
    await expect(page.getByTestId("daytrack-stat-week")).toBeVisible();
    await expect(page.getByTestId("daytrack-stat-next-up")).toBeVisible();
    await expect(page.getByTestId("daytrack-stat-spread")).toBeVisible();
    await expect(page.getByTestId("daytrack-city-sf")).toBeVisible();
    await expect(module.getByText("12a").first()).toBeVisible();
    await expect(module.getByText("6p")).toBeVisible();
    await expect(page.getByTestId("daytrack-gear")).toBeVisible();
    await expect(page.locator(".dprail")).toHaveCount(4);
    await expect(page.locator(".tzbar")).toHaveCount(3);
  });

  test("a synced workspace shows real tallies and the freshness chip", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    const created = await adminJson(request, "POST", "/api/v1/workspaces", {
      id: WS_SYNC,
      name: "Daytrack Live",
    });
    expect([201, 400]).toContain(created.status());

    const key = await mintWriteKey(request, WS_SYNC);
    await adminJson(request, "PATCH", "/api/v1/config", {
      workspaceId: WS_SYNC,
      companyName: "Harbor",
      foundedAt: "2026-01-01",
      homeCity: { timezone: "America/Los_Angeles", label: "San Francisco" },
    });

    const identified = await request.post("/api/ingest/identify", {
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      data: {
        userId: "daytrack-sf",
        workspaceId: WS_SYNC,
        properties: {
          name: "SF one",
          country: "US",
          timezone: "America/Los_Angeles",
          platform: "web",
        },
      },
    });
    expect(identified.ok(), `identify ${identified.status()}`).toBeTruthy();

    const tracked = await request.post("/api/ingest/event", {
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      data: {
        userId: "daytrack-sf",
        eventName: "daytrack_ping",
        workspaceId: WS_SYNC,
        properties: { platform: "web" },
      },
    });
    expect(tracked.ok(), `track ${tracked.status()}`).toBeTruthy();

    await unlock(page, WS_SYNC, key);
    await expect(page.getByTestId("daytrack-label")).toHaveText(/day of harbor/i);
    await expect(page.getByTestId("daytrack-demo")).toHaveCount(0);
    await expect(page.getByTestId("daytrack-freshness")).toBeVisible();
    const online = Number(await page.getByTestId("daytrack-online").innerText());
    expect(online).toBeGreaterThanOrEqual(1);
  });

  test("a tracking-snippet event moves Online within two minutes", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);

    const created = await adminJson(request, "POST", "/api/v1/workspaces", {
      id: WS_SNIPPET,
      name: "Daytrack Snippet",
    });
    expect([201, 400]).toContain(created.status());
    const key = await mintWriteKey(request, WS_SNIPPET);

    await request.post("/api/ingest/identify", {
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      data: {
        userId: "daytrack-seed",
        workspaceId: WS_SNIPPET,
        properties: {
          name: "Seed",
          country: "US",
          timezone: "America/Los_Angeles",
          platform: "web",
        },
      },
    });
    await request.post("/api/ingest/event", {
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      data: {
        userId: "daytrack-seed",
        eventName: "daytrack_seed",
        workspaceId: WS_SNIPPET,
      },
    });

    await unlock(page, WS_SNIPPET, key);
    await expect(page.getByTestId("daytrack-demo")).toHaveCount(0);
    const before = await page.getByTestId("daytrack-online").innerText();

    const stamp = Date.now();
    const userId = `daytrack-snippet-${stamp}`;
    const html = `<!doctype html>
<html>
  <body>
    <p>snippet</p>
    ${browserSnippet({
      endpoint: "http://localhost:3000",
      workspaceId: WS_SNIPPET,
      apiKey: key,
      debug: true,
      userId,
      properties: {
        name: "Snippet",
        country: "US",
        timezone: "America/Los_Angeles",
        platform: "web",
      },
      trackEvent: { name: "daytrack_snippet", properties: { platform: "web" } },
    })}
  </body>
</html>`;

    const fixture = await page.context().newPage();
    await fixture.goto("http://localhost:3000/connect");
    const identify = fixture.waitForResponse(
      (res) =>
        res.url().includes("/api/ingest/identify") &&
        res.request().method() === "POST" &&
        res.ok()
    );
    const event = fixture.waitForResponse(
      (res) =>
        (res.url().includes("/api/ingest/event") ||
          res.url().includes("/api/ingest/batch")) &&
        res.request().method() === "POST" &&
        res.ok()
    );
    await fixture.setContent(html, { waitUntil: "domcontentloaded" });
    await Promise.all([identify, event]);
    await fixture.close();

    await expect
      .poll(async () => page.getByTestId("daytrack-online").innerText(), {
        timeout: 120_000,
      })
      .not.toBe(before);
    await expect(page).toHaveURL(/workspace=e2e-daytrack-snip/);
  });
});
