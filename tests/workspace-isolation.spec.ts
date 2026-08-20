import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { callMcpTool, parseMcpPayload } from "./helpers/verify-ingest";

/**
 * ANY-39 — two live workspaces stay isolated across keys, views, and MCP.
 * The dashboard switcher prompts the first time a workspace is unlocked.
 */

const ADMIN = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";
const A = "e2e-iso-a";
const B = "e2e-iso-b";
const DISTINCT = "e2e-shared-id";

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

async function identify(
  request: APIRequestContext,
  key: string,
  workspace: string,
  name: string,
  platform: string
) {
  const res = await request.post("/api/ingest/identify", {
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    data: {
      userId: DISTINCT,
      workspaceId: workspace,
      properties: { name, platform },
    },
  });
  expect(res.ok(), `identify ${workspace} ${res.status()}`).toBeTruthy();
}

test("two live workspaces are isolated across keys, views, and MCP", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  for (const [id, name] of [
    [A, "Isolation A"],
    [B, "Isolation B"],
  ] as const) {
    const created = await adminJson(request, "POST", "/api/v1/workspaces", {
      id,
      name,
    });
    expect([201, 400]).toContain(created.status());
  }

  const keyA = await mintWriteKey(request, A);
  const keyB = await mintWriteKey(request, B);

  await identify(request, keyA, A, "Ada Alpha", "iso-a");
  await identify(request, keyB, B, "Ada Beta", "iso-b");

  const usersA = await request.get(`/api/v1/users?workspace=${A}&platform=iso-a`, {
    headers: { authorization: `Bearer ${keyA}` },
  });
  const usersB = await request.get(`/api/v1/users?workspace=${B}&platform=iso-b`, {
    headers: { authorization: `Bearer ${keyB}` },
  });
  const leak = await request.get(`/api/v1/users?workspace=${B}`, {
    headers: { authorization: `Bearer ${keyA}` },
  });
  expect(usersA.ok()).toBeTruthy();
  expect(usersB.ok()).toBeTruthy();
  expect(leak.status()).toBe(401);

  const namesA = ((await usersA.json()) as { users: { name: string }[] }).users.map(
    (user) => user.name
  );
  expect(namesA).toContain("Ada Alpha");
  expect(namesA).not.toContain("Ada Beta");

  const viewA = await request.get(`/api/views/dotplot?workspace=${A}`, {
    headers: { authorization: `Bearer ${keyA}` },
  });
  const viewCross = await request.get(`/api/views/dotplot?workspace=${B}`, {
    headers: { authorization: `Bearer ${keyA}` },
  });
  expect(viewA.ok()).toBeTruthy();
  expect(viewCross.status()).toBe(401);

  const mcpA = parseMcpPayload(
    (
      await callMcpTool(
        request,
        "query_users",
        { workspace: A, platform: "iso-a", limit: 20 },
        { Authorization: `Bearer ${keyA}` }
      )
    ).body
  );
  const mcpUsers = mcpA.users as { name?: string }[];
  expect(mcpUsers.map((user) => user.name)).toContain("Ada Alpha");
  expect(mcpUsers.map((user) => user.name)).not.toContain("Ada Beta");

  const mcpCross = await callMcpTool(
    request,
    "query_users",
    { workspace: B, limit: 20 },
    { Authorization: `Bearer ${keyA}` }
  );
  expect(mcpCross.response.status()).toBe(401);

  await expectSwitcherPrompt(page, A, keyA);
  await expectSwitcherPrompt(page, B, keyB);
});

async function expectSwitcherPrompt(
  page: Page,
  workspace: string,
  key: string
) {
  await page.goto(`/dashboard?workspace=${workspace}&view=dotplot`);
  await expect(page.getByRole("heading", { name: `Unlock ${workspace}` })).toBeVisible();
  await page.getByLabel("API key").fill(key);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByRole("heading", { name: `Unlock ${workspace}` })).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page).toHaveURL(new RegExp(`workspace=${workspace}`));
  expect(page.url()).not.toContain(key);
}
