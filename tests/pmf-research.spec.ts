import { test, expect } from "@playwright/test";

test.describe("PMF+ research entry points", () => {
  test("✨ on a dot-plot row starts research", async ({ page }) => {
    await page.goto("/dashboard?workspace=demo&view=dotplot");
    await page.waitForSelector('svg[role="img"]', { timeout: 10000 });

    await page.getByRole("button", { name: "Open Dave" }).hover();
    await page.getByTestId("dotplot-research-p1").click();
    const disclosure = page.getByTestId("research-disclosure");
    await expect(disclosure).toBeVisible();
    await expect(disclosure.getByText("Fields that leave this machine")).toBeVisible();
    await expect(disclosure.getByTestId("research-outgoing-fields")).toContainText("Dave");
  });

  test("✨ on the person panel starts research", async ({ page }) => {
    await page.goto("/dashboard?workspace=demo&view=dotplot&user=p1");
    const panel = page.getByTestId("person-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Dave" })).toBeVisible();

    await panel.getByTestId("person-research").click();
    const disclosure = page.getByTestId("research-disclosure");
    await expect(disclosure).toBeVisible();
    await expect(disclosure.getByTestId("research-outgoing-fields")).toContainText("Dave");
  });

  test("✨ on the current filtered view starts research", async ({ page }) => {
    await page.goto("/dashboard?workspace=demo&view=pmf");
    await expect(page.getByTestId("pmf-research")).toBeVisible();

    await page.getByLabel("Filter people to research").fill("Dave");
    await page.getByTestId("pmf-research-view").click();

    const disclosure = page.getByTestId("research-disclosure");
    await expect(disclosure).toBeVisible();
    await expect(disclosure.getByTestId("research-outgoing-fields")).toContainText("Dave");
  });
});
