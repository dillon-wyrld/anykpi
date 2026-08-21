import { expect, test, type APIRequestContext } from "@playwright/test";
import { callMcpTool } from "./helpers/verify-ingest";

/**
 * ANY-69 — typed-name-confirmed workspace delete, isolation, no MCP tool.
 */

const ADMIN = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";
const A = "e2e-del-a";
const B = "e2e-del-b";

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

test("typed-name delete cascades one workspace and MCP cannot delete", async ({
  request,
}) => {
  test.setTimeout(60_000);

  for (const [id, name] of [
    [A, "Delete A"],
    [B, "Delete B"],
  ] as const) {
    const created = await adminJson(request, "POST", "/api/v1/workspaces", {
      id,
      name,
    });
    expect([201, 400]).toContain(created.status());
  }

  await adminJson(request, "POST", "/api/ingest/identify", {
    userId: "e2e-del-user",
    workspaceId: A,
    properties: { name: "Only Alpha" },
  });
  await adminJson(request, "POST", "/api/ingest/identify", {
    userId: "e2e-del-user",
    workspaceId: B,
    properties: { name: "Only Beta" },
  });

  const refused = await adminJson(request, "DELETE", "/api/v1/workspaces", {
    id: A,
    name: "Wrong",
  });
  expect(refused.status()).toBe(400);

  const deleted = await adminJson(request, "DELETE", "/api/v1/workspaces", {
    id: A,
    name: "Delete A",
  });
  expect(deleted.ok(), `delete A ${deleted.status()}`).toBeTruthy();
  const body = (await deleted.json()) as {
    deleted?: boolean;
    workspace?: { id?: string };
  };
  expect(body.deleted).toBe(true);
  expect(body.workspace?.id).toBe(A);

  const usersA = await request.get(`/api/v1/users?workspace=${A}`, {
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  const usersB = await request.get(`/api/v1/users?workspace=${B}`, {
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  expect(usersA.ok()).toBeTruthy();
  expect(usersB.ok()).toBeTruthy();
  const namesA = ((await usersA.json()) as { users: { name: string }[] }).users.map(
    (user) => user.name
  );
  const namesB = ((await usersB.json()) as { users: { name: string }[] }).users.map(
    (user) => user.name
  );
  expect(namesA).not.toContain("Only Alpha");
  expect(namesB).toContain("Only Beta");

  const listed = await request.get("/api/v1/workspaces");
  expect(listed.ok()).toBeTruthy();
  const ids = (
    (await listed.json()) as { workspaces: { id: string }[] }
  ).workspaces.map((row) => row.id);
  expect(ids).not.toContain(A);
  expect(ids).toContain(B);

  const mcp = await callMcpTool(
    request,
    "delete_workspace",
    { id: B, name: "Delete B" },
    { Authorization: `Bearer ${ADMIN}` }
  );
  const text = JSON.stringify(mcp.body);
  expect(text.toLowerCase()).toMatch(/not implemented|unknown|not found/);
});
