import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * ANY-59 — first-run setup: welcome → gallery → first data or labeled demo.
 */

const ADMIN = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";
const WS_WALK = "e2e-setup-walk";
const WS_SKIP = "e2e-setup-skip";

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

async function ensureWorkspace(request: APIRequestContext, id: string, name: string) {
  const created = await adminJson(request, "POST", "/api/v1/workspaces", { id, name });
  expect([200, 201, 400]).toContain(created.status());
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
  await expect(unlockHeading).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("API key").fill(key);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(unlockHeading).toHaveCount(0, { timeout: 15_000 });
}

test.describe("First-run setup (ANY-59)", () => {
  test("fresh workspace walks three steps and lands on labeled demo", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await ensureWorkspace(request, WS_WALK, "Setup Walk");
    const key = await mintWriteKey(request, WS_WALK);
    await unlock(page, WS_WALK, key);

    await expect(page.getByTestId("setup-prompt")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("setup-prompt-start").click();

    await expect(page.getByTestId("setup-welcome")).toBeVisible();
    await expect(page.getByTestId("setup-steps")).toContainText("Welcome");
    await page.getByPlaceholder("Required to save a live workspace").fill(ADMIN);
    await page.getByTestId("setup-company-name").fill("Harbor");
    await page.getByTestId("setup-founded").fill("2024-01-15");
    await page.getByTestId("setup-welcome-continue").click();

    await expect(page.getByTestId("source-gallery")).toBeVisible();
    await expect(page.getByTestId("gallery-card-posthog")).toBeVisible();
    await expect(page.getByTestId("gallery-card-posthog")).toHaveAttribute(
      "data-status",
      "shipped"
    );
    await expect(page.getByTestId("gallery-card-revenuecat")).toHaveAttribute(
      "data-status",
      "shipped"
    );
    await expect(page.getByTestId("gallery-card-github")).toHaveAttribute(
      "data-status",
      "shipped"
    );
    await page.getByTestId("gallery-search").fill("stripe");
    await expect(page.getByTestId("gallery-card-stripe")).toBeVisible();
    await expect(page.getByTestId("gallery-card-posthog")).toHaveCount(0);
    await page.getByTestId("gallery-card-stripe").click();
    await expect(page.getByTestId("credential-stripe")).toBeVisible();
    await page.getByRole("button", { name: "← Back to gallery" }).click();
    await page.getByTestId("setup-connect-continue").click();

    await expect(page.getByTestId("setup-first-data")).toBeVisible();
    await expect(page.getByTestId("setup-sync-now")).toBeVisible();
    await expect(page.getByTestId("setup-snippet")).toBeVisible();
    await expect(page.getByTestId("setup-csv")).toBeVisible();
    await page.getByTestId("setup-explore-demo").click();

    await expect(page).toHaveURL(/workspace=demo/);
    await expect(page.getByTestId("demo-banner")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("demo-banner")).toContainText(/demo data/i);
    await expect(page.getByTestId("ask-anything")).toBeVisible();
  });

  test("complete or skip is remembered per workspace and never re-traps", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await ensureWorkspace(request, WS_SKIP, "Setup Skip");
    const key = await mintWriteKey(request, WS_SKIP);
    await unlock(page, WS_SKIP, key);

    await page.goto(`/connect?setup=1&workspace=${encodeURIComponent(WS_SKIP)}`);
    await expect(page.getByTestId("setup-flow")).toBeVisible();
    await page.getByTestId("setup-skip").click();

    await expect(page).toHaveURL(new RegExp(`workspace=${WS_SKIP}`));
    await expect(page.getByTestId("setup-prompt")).toHaveCount(0);
    await expect(page.getByTestId("setup-flow")).toHaveCount(0);

    await page.goto(`/dashboard?workspace=${WS_SKIP}&view=dotplot`);
    await expect(page.getByTestId("setup-prompt")).toHaveCount(0);
    await expect(page.getByTestId("setup-flow")).toHaveCount(0);

    await page.goto(`/connect?workspace=${encodeURIComponent(WS_SKIP)}`);
    await expect(page.getByRole("heading", { name: "Connect Your Data" })).toBeVisible();
    await expect(page.getByTestId("setup-flow")).toHaveCount(0);
    await expect(page.getByTestId("reenter-setup")).toBeVisible();
    await page.getByTestId("reenter-setup").click();
    await expect(page.getByTestId("setup-flow")).toBeVisible();
  });

  test("demo banner is dismissible and stays dismissed", async ({ page }) => {
    await page.goto("/dashboard?workspace=demo&view=dotplot");
    await expect(page.getByTestId("demo-banner")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("demo-banner-dismiss").click();
    await expect(page.getByTestId("demo-banner")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("demo-banner")).toHaveCount(0);
  });

  test("demo banner leaves after the first real sync", async ({ page, request }) => {
    test.setTimeout(90_000);
    const workspace = "e2e-setup-banner";
    await ensureWorkspace(request, workspace, "Setup Banner");
    const key = await mintWriteKey(request, workspace);
    await unlock(page, workspace, key);

    await page.goto(`/connect?setup=1&workspace=${encodeURIComponent(workspace)}`);
    await page.getByTestId("setup-skip").click();
    await expect(page).toHaveURL(new RegExp(`workspace=${workspace}`));

    await page.evaluate((ws) => {
      window.localStorage.setItem(`anykpi:labeled-demo:${ws}`, "1");
    }, workspace);
    await page.reload();
    await expect(page.getByTestId("demo-banner")).toBeVisible({ timeout: 15_000 });

    const triggered = await adminJson(request, "POST", "/api/v1/sync", {
      workspace,
      source: "mixpanel",
    });
    expect(triggered.ok(), `banner workspace sync ${triggered.status()}`).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId("demo-banner")).toHaveCount(0);
  });
});
