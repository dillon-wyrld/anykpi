import { test, expect, type Page } from "@playwright/test";

/**
 * ANY-43 — connect mint flow + live workspace auth gate.
 *
 * Demo stays public-read. Live views stay gated until a minted key starts
 * a browser session (ANY-36). The key never goes in the URL.
 */

const OPERATOR_KEY = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";

async function expectDemoPublic(page: Page) {
  await page.goto("/dashboard?workspace=demo&view=dotplot");
  await page.waitForSelector('svg[role="img"]', { timeout: 15_000 });
  await expect(page).toHaveURL(/workspace=demo/);
  await expect(page.getByRole("button", { name: "Open Dave" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unlock live" })).toHaveCount(
    0
  );
}

async function expectLiveGate(page: Page) {
  await page.goto("/dashboard?workspace=live&view=dotplot");
  await expect(page.getByRole("heading", { name: "Unlock live" })).toBeVisible();
  await expect(page.getByLabel("API key")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open workspace" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Day" })).toHaveCount(0);
  await expect(page).toHaveURL(/workspace=live/);
  expect(page.url()).not.toMatch(/[?&](key|apiKey|api_key|api-key)=/);
}

async function mintKeyOnConnect(page: Page): Promise<string> {
  await page.goto("/connect");
  await page.getByPlaceholder("Required to mint a new key").fill(OPERATOR_KEY);
  await page.getByRole("button", { name: "Generate API Key" }).click();
  await expect(page.getByText(/won't be shown again/)).toBeVisible();
  const minted = await page.locator('input[readonly]').first().inputValue();
  expect(minted).toMatch(/^ak_/);
  expect(minted).not.toBe(OPERATOR_KEY);
  return minted;
}

test.describe("Connect flow and live auth gate", () => {
  test("demo is public-read while live stays gated without a session", async ({
    page,
    request,
  }) => {
    const demoApi = await request.get("/api/views/dotplot?workspace=demo");
    expect(demoApi.ok(), `demo view API ${demoApi.status()}`).toBeTruthy();

    const liveApi = await request.get("/api/views/dotplot?workspace=live");
    expect(liveApi.status()).toBe(401);

    await expectDemoPublic(page);
    await expectLiveGate(page);

    await page.getByLabel("API key").fill("not-a-real-key");
    await page.getByRole("button", { name: "Open workspace" }).click();
    await expect(page.getByText("That key was not accepted.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Unlock live" })
    ).toBeVisible();

    await expectDemoPublic(page);
  });

  test("mint a key on /connect, enter live, and load gated views", async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(90_000);

    await expectDemoPublic(page);

    const mintedKey = await mintKeyOnConnect(page);

    await expectLiveGate(page);
    await page.getByLabel("API key").fill(mintedKey);
    await page.getByRole("button", { name: "Open workspace" }).click();

    await expect(
      page
        .getByRole("button", { name: "Day" })
        .or(page.getByTestId("view-empty-dotplot"))
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("heading", { name: "Unlock live" })
    ).toHaveCount(0);
    await expect(page).toHaveURL(/workspace=live/);
    expect(page.url()).not.toContain(mintedKey);
    expect(page.url()).not.toMatch(/[?&](key|apiKey|api_key|api-key)=/);

    const liveWithCookie = await page.request.get(
      "/api/views/dotplot?workspace=live"
    );
    expect(
      liveWithCookie.ok(),
      `live view API after session ${liveWithCookie.status()}`
    ).toBeTruthy();

    const liveWithoutCookie = await request.get(
      "/api/views/dotplot?workspace=live"
    );
    expect(liveWithoutCookie.status()).toBe(401);

    await page.getByRole("link", { name: "Cohorts" }).click();
    await expect(page.getByRole("heading", { name: "Cohort retention" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/view=cohorts/);

    await page.getByRole("link", { name: "WBR" }).click();
    await expect(
      page.getByRole("heading", { name: "Weekly Business Review" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/view=wbr/);

    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Read-only")).toBeVisible();

    await expectDemoPublic(page);

    const guest = await browser.newContext();
    try {
      const guestPage = await guest.newPage();
      await expectDemoPublic(guestPage);
      await expectLiveGate(guestPage);
    } finally {
      await guest.close();
    }

    await page.goto("/dashboard?workspace=live&view=dotplot");
    await expect(
      page
        .getByRole("button", { name: "Day" })
        .or(page.getByTestId("view-empty-dotplot"))
    ).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("heading", { name: "Unlock live" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Day" })).toHaveCount(0);

    await expectDemoPublic(page);
  });
});
