import { test, expect } from "@playwright/test";

const VIEWS = ["dotplot", "cohorts", "wbr", "calendar", "pmf"] as const;

test.describe("Ask-anything bar", () => {
  for (const view of VIEWS) {
    test(`⌘K / Ctrl+K focuses the bar on ${view}`, async ({ page }) => {
      await page.goto(`/dashboard?workspace=demo&view=${view}`);
      await expect(page.getByTestId("ask-anything")).toBeVisible();

      await page.keyboard.press("Control+k");
      await expect(page.getByTestId("ask-anything")).toBeFocused();

      await page.locator("body").click();
      await page.keyboard.press("Meta+k");
      await expect(page.getByTestId("ask-anything")).toBeFocused();
    });
  }

  test("canonical queries open the answering view with no answer strip", async ({
    page,
  }) => {
    await page.goto("/dashboard?workspace=demo&view=dotplot");
    const input = page.getByTestId("ask-anything");
    await expect(input).toBeVisible();

    await input.fill("are we smiling yet?");
    await input.press("Enter");
    await expect(page).toHaveURL(/view=cohorts/);
    await expect(page).toHaveURL(/state=/);
    await expect(page.getByTestId("ask-anything")).toHaveValue("");
    await expect(page.getByText(/that's a lot of smiles|getting there/i)).toHaveCount(0);

    await input.fill("who churned this week");
    await input.press("Enter");
    await expect(page).toHaveURL(/view=dotplot/);
    await expect(page).toHaveURL(/g=none/);
    await expect(page).toHaveURL(/state=/);

    await input.fill("ios users in france");
    await input.press("Enter");
    await expect(page).toHaveURL(/view=dotplot/);
    await expect(page).toHaveURL(/g=none/);
    await expect(page).toHaveURL(/[?&]f=/);
    await expect(page).toHaveURL(/state=/);

    await expect(page.getByTestId("ask-anything-chrome")).toBeVisible();
    await expect(page.locator("[data-testid='ask-answer']")).toHaveCount(0);
  });

  test("an unmapped phrase nudges the bar and stays on the view", async ({
    page,
  }) => {
    await page.goto("/dashboard?workspace=demo&view=wbr");
    const input = page.getByTestId("ask-anything");
    await input.fill("zzzz-not-a-query");
    await input.press("Enter");
    await expect(page).toHaveURL(/view=wbr/);
    await expect(page.getByTestId("ask-anything-bar")).toHaveClass(/ask-miss/);
    await expect(page.getByTestId("ask-anything")).toHaveValue("");
  });

  test("the bar is present in wall mode", async ({ page }) => {
    await page.goto("/dashboard?workspace=demo&view=dotplot&w=1");
    await expect(page.getByTestId("wall-masthead")).toBeVisible();
    await expect(page.getByTestId("ask-anything")).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("ask-anything")).toBeFocused();
  });
});
