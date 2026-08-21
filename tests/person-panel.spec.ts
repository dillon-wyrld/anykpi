import { test, expect, type Page } from "@playwright/test";

async function openDemoDotplot(page: Page) {
  await page.goto("/dashboard?workspace=demo&view=dotplot");
  await page.waitForSelector('svg[role="img"]', { timeout: 15_000 });
  const dismiss = page.getByTestId("demo-banner-dismiss");
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
    await expect(page.getByTestId("demo-banner")).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: "Open Dave" })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("Person drill-down", () => {
  test("clicking a name opens the panel and a shareable URL restores it", async ({
    page,
  }) => {
    await openDemoDotplot(page);

    await page.getByRole("button", { name: "Open Dave" }).click();

    const panel = page.getByTestId("person-panel");
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/[?&]user=p1/);
    await expect(panel.getByRole("heading", { name: "Dave" })).toBeVisible();
    await expect(panel.getByText("First seen")).toBeVisible();
    await expect(panel.getByText("Last seen")).toBeVisible();
    await expect(panel.getByText("Cohort")).toBeVisible();
    await expect(panel.getByText("Cluster")).toBeVisible();
    await expect(panel.getByText("Platform")).toBeVisible();
    await expect(panel.getByTestId("person-revenue")).toBeVisible();
    await expect(panel.getByTestId("person-timeline")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]user=/);

    await page.goto("/dashboard?workspace=demo&view=dotplot&user=p1");
    await expect(page.getByTestId("person-panel")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dave" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]user=p1/);
  });

  test("the name is keyboard reachable", async ({ page }) => {
    await openDemoDotplot(page);

    const name = page.getByRole("button", { name: "Open Dave" });
    await name.focus();
    await expect(name).toBeFocused();
    await name.press("Enter");
    await expect(page.getByTestId("person-panel")).toBeVisible();
    await expect(page.getByTestId("person-panel-close")).toBeFocused();
  });
});
