import { expect, test } from "@playwright/test";
import {
  createEmptyWorkspace,
  deleteLiveWorkspace,
  mintWriteKey,
  unlockWorkspace,
} from "./helpers/real-workspace";

/**
 * ANY-65 — vanity-event guard on the /connect picker.
 * One-sentence warning; save still succeeds.
 */

const WORKSPACE_NAME = "Vanity event guard";

function workspaceId(): string {
  return `e2evn${Date.now().toString(36)}`;
}

test("picking a vanity event on /connect warns and still saves", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const workspace = workspaceId();
  await createEmptyWorkspace(request, workspace, WORKSPACE_NAME);
  const key = await mintWriteKey(request, workspace);

  try {
    await unlockWorkspace(page, workspace, key);
    await page.goto(`/connect?workspace=${encodeURIComponent(workspace)}`);
    await page.getByRole("button", { name: /Path 2: Add ANYKPI Events/ }).click();
    await expect(page.getByTestId("value-event-picker")).toBeVisible();

    await page.getByPlaceholder("Required to save a live workspace").fill(key);
    await page.getByTestId("value-event-pick-app_opened").click();
    await expect(page.getByTestId("value-event-core")).toHaveValue("app_opened");
    await expect(page.getByTestId("value-event-warning")).toHaveText(
      "That event is vanity — it counts presence, not value."
    );

    const save = page.getByTestId("value-event-save");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByTestId("value-event-saved")).toBeVisible();
    await expect(page.getByTestId("value-event-warning")).toBeVisible();

    await page.getByTestId("value-event-pick-song_played").click();
    await expect(page.getByTestId("value-event-warning")).toHaveCount(0);
    await expect(save).toBeEnabled();
  } finally {
    await deleteLiveWorkspace(request, workspace, WORKSPACE_NAME);
  }
});
