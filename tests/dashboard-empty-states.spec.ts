import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * ANY-70 — designed empty states on the five views, and a freshness
 * chip that shows a failing source and links to /connect#health.
 */

const ADMIN = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";
const WS = "e2e-empty-70";

const VIEWS = [
  {
    id: "dotplot",
    testId: "view-empty-dotplot",
    actionId: "view-empty-dotplot-action",
    what: "Every person as a row of days",
  },
  {
    id: "cohorts",
    testId: "view-empty-cohorts",
    actionId: "view-empty-cohorts-action",
    what: "Retention by signup week",
  },
  {
    id: "wbr",
    testId: "view-empty-wbr",
    actionId: "view-empty-wbr-action",
    what: "The weekly scorecard",
  },
  {
    id: "calendar",
    testId: "view-empty-calendar",
    actionId: "view-empty-calendar-action",
    what: "Launches, rituals, and milestones",
  },
  {
    id: "pmf",
    testId: "view-empty-pmf",
    actionId: "view-empty-pmf-action",
    what: "Who to talk to next",
  },
] as const;

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
  const loaded = page.getByTestId("view-empty-dotplot").or(page.getByTestId("daytrack"));
  await expect(unlockHeading.or(loaded)).toBeVisible({ timeout: 20_000 });
  if (await unlockHeading.isVisible()) {
    await page.getByLabel("API key").fill(key);
    await page.getByRole("button", { name: "Open workspace" }).click();
    await expect(unlockHeading).toHaveCount(0);
  }
}

test.describe("Designed empty states and freshness errors", () => {
  test("each of the five views shows what it will show and one next action", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    const created = await adminJson(request, "POST", "/api/v1/workspaces", {
      id: WS,
      name: "Empty seventy",
    });
    expect([201, 400]).toContain(created.status());
    const key = await mintWriteKey(request, WS);
    await unlock(page, WS, key);

    for (const view of VIEWS) {
      await page.goto(`/dashboard?workspace=${WS}&view=${view.id}`);
      const empty = page.getByTestId(view.testId);
      await expect(empty).toBeVisible({ timeout: 15_000 });
      await expect(empty).toContainText(view.what);
      const action = page.getByTestId(view.actionId);
      await expect(action).toBeVisible();
      await expect(action).toHaveText("Connect a source");
      await expect(action).toHaveAttribute("href", `/connect?setup=1&workspace=${WS}`);
      await expect(empty.locator("a")).toHaveCount(1);
    }
  });

  test("freshness chip shows a failing source and links to connector health", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    const created = await adminJson(request, "POST", "/api/v1/workspaces", {
      id: WS,
      name: "Empty seventy",
    });
    expect([201, 400]).toContain(created.status());
    const key = await mintWriteKey(request, WS);

    await page.route("**/api/v1/sync**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workspace: WS,
          syncIntervalMinutes: 15,
          states: [
            {
              source: "mixpanel",
              sourceName: "Mixpanel",
              status: "error",
              error: "unauthorized",
            },
          ],
        }),
      });
    });

    await unlock(page, WS, key);
    await page.goto(`/dashboard?workspace=${WS}&view=dotplot`);

    const chip = page
      .getByTestId("daytrack-freshness")
      .or(page.getByTestId("freshness-chip"));
    await expect(chip.first()).toBeVisible({ timeout: 15_000 });
    await expect(chip.first()).toHaveAttribute("data-freshness", "error");
    await expect(chip.first()).toHaveAttribute("href", "/connect#health");
    await expect(chip.first()).toContainText(/needs attention/i);

    await chip.first().click();
    await expect(page).toHaveURL(/\/connect#health/);
    await expect(page.getByTestId("connector-health")).toBeVisible({
      timeout: 15_000,
    });
  });
});
