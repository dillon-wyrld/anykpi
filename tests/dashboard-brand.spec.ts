import { test, expect } from "@playwright/test";

test.describe("Dashboard wordmark and tab icon", () => {
  test("nav shows the wordmark + beta tag, not plain-text ANYKPI", async ({
    page,
  }) => {
    await page.goto("/dashboard?workspace=demo&view=dotplot");
    await page.waitForSelector('[data-testid="wordmark"]', { timeout: 15_000 });

    const logo = page.getByTestId("logo-row");
    await expect(logo).toBeVisible();
    await expect(logo.getByTestId("wordmark")).toBeVisible();
    await expect(logo.getByTestId("wordmark")).toHaveAttribute("alt", "ANYKPI");
    await expect(logo.getByTestId("wordmark")).toHaveClass(/h-\[19px\]/);
    await expect(logo.getByTestId("beta-tag")).toHaveText(/beta/i);
    await expect(logo.getByText("ANYKPI", { exact: true })).toHaveCount(0);
  });

  test("document head links the K-tile tab icon", async ({ page }) => {
    await page.goto("/dashboard?workspace=demo&view=dotplot");
    await page.waitForSelector('[data-testid="wordmark"]', { timeout: 15_000 });

    const iconHrefs = await page.locator('link[rel*="icon"]').evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLLinkElement).href)
        .filter((href) => href.includes("/brand/"))
    );
    expect(iconHrefs.some((href) => /\/brand\/(icon\.svg|icon-32\.png|favicon\.ico)/.test(href))).toBe(
      true
    );

    const icon = await page.request.get("/brand/icon-32.png");
    expect(icon.ok()).toBeTruthy();
    expect(icon.headers()["content-type"]).toMatch(/image\/png/);
  });

  test("wall mode masthead uses the same mark", async ({ page }) => {
    await page.goto("/dashboard?workspace=demo&view=dotplot&w=1");
    await page.waitForSelector('[data-testid="wall-masthead"]', { timeout: 15_000 });

    const masthead = page.getByTestId("wall-masthead");
    await expect(masthead).toBeVisible();
    await expect(masthead.getByTestId("wordmark")).toBeVisible();
    await expect(masthead.getByTestId("wordmark")).toHaveAttribute("alt", "ANYKPI");
    await expect(masthead.getByTestId("beta-tag")).toHaveText(/beta/i);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(masthead.getByText("ANYKPI", { exact: true })).toHaveCount(0);
  });
});
