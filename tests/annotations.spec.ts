import { expect, test } from "@playwright/test";
import {
  ADMIN_KEY,
  createEmptyWorkspace,
  deleteLiveWorkspace,
  mintWriteKey,
  unlockWorkspace,
} from "./helpers/real-workspace";

/**
 * ANY-63 — pin a sticker from the UI, see it on the dot plot and
 * calendar, and survive reload.
 */

const WORKSPACE_NAME = "Annotation sticker layer";

function workspaceId(): string {
  return `e2ean${Date.now().toString(36)}`;
}

test("pin a sticker on the dot plot and a note on the calendar; reload keeps both", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const workspace = workspaceId();
  const userId = `ann-${Date.now()}`;
  const userName = "Ann User";
  await createEmptyWorkspace(request, workspace, WORKSPACE_NAME);
  const key = await mintWriteKey(request, workspace);

  const identify = await request.post("/api/ingest/identify", {
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    data: {
      userId,
      workspaceId: workspace,
      properties: { name: userName, platform: "web" },
    },
  });
  expect(identify.ok()).toBeTruthy();
  const personId = `person_${userId}`;

  try {
    await unlockWorkspace(page, workspace, key);
    await page.goto(`/dashboard?workspace=${workspace}&view=dotplot`);
    await expect(page.getByRole("button", { name: `Open ${userName}` })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Pin sticker" }).click();
    await page.getByLabel("Kind").selectOption("sticker");
    await page.getByLabel("Pin to").selectOption("person");
    await page.getByLabel("Target").selectOption(personId);
    await page.getByLabel("Sticker").fill("🎂");
    await page.getByRole("button", { name: "Save pin" }).click();
    await expect(page.getByTestId("sticker-layer")).toContainText("🎂");

    await page.reload();
    await unlockWorkspace(page, workspace, key);
    await page.goto(`/dashboard?workspace=${workspace}&view=dotplot`);
    await expect(page.getByTestId("sticker-layer")).toContainText("🎂");

    const listed = await request.get(`/api/v1/annotations?workspace=${workspace}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(listed.ok()).toBeTruthy();
    const body = (await listed.json()) as {
      annotations: { type: string; targetType: string; content: string }[];
    };
    expect(body.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "sticker",
          targetType: "person",
          content: "🎂",
        }),
      ])
    );

    const today = new Date();
    const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    await page.goto(`/dashboard?workspace=${workspace}&view=calendar`);
    await expect(page.getByRole("button", { name: "Pin sticker" })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Pin sticker" }).click();
    await page.getByLabel("Kind").selectOption("note");
    await page.getByLabel("Pin to").selectOption("date");
    await page.getByLabel("Target").fill(dayKey);
    await page.getByLabel("Note").fill("Ship day");
    await page.getByRole("button", { name: "Save pin" }).click();
    await expect(page.getByTestId("sticker-layer")).toContainText("Ship day");

    await page.reload();
    await unlockWorkspace(page, workspace, key);
    await page.goto(`/dashboard?workspace=${workspace}&view=calendar`);
    await expect(page.getByTestId("sticker-layer")).toContainText("Ship day");
  } finally {
    await request.fetch("/api/v1/workspaces", {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${ADMIN_KEY}`,
        "content-type": "application/json",
      },
      data: { id: workspace, name: WORKSPACE_NAME },
    }).catch(() => undefined);
    await deleteLiveWorkspace(request, workspace, WORKSPACE_NAME).catch(() => undefined);
  }
});
