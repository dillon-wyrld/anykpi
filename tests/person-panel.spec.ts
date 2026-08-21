import { test, expect } from "@playwright/test";

test.describe("Person drill-down", () => {
  test("clicking a name opens the panel and a shareable URL restores it", async ({
    page,
  }) => {
    await page.goto("/dashboard?workspace=demo&view=dotplot");
    await page.waitForSelector('svg[role="img"]', { timeout: 10000 });

    await page.getByTestId("person-name-p1").click();

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
    await page.goto("/dashboard?workspace=demo&view=dotplot");
    await page.waitForSelector('svg[role="img"]', { timeout: 10000 });

    const name = page.getByTestId("person-name-p1");
    await name.focus();
    await expect(name).toBeFocused();
    await name.press("Enter");
    await expect(page.getByTestId("person-panel")).toBeVisible();
    await expect(page.getByTestId("person-panel-close")).toBeFocused();
  });
});
