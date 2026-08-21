import { createServer } from "node:http";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { ViewStateSchema } from "../../src/core/view-state";
import { browserSnippet } from "../../packages/sdk/src/snippet";
import {
  callMcpTool,
  expectUserVisibleViaRestAndMcp,
  parseMcpPayload,
  personIdFor,
} from "./verify-ingest";

export const ADMIN_KEY = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";

/** Demo-seeded people that must never appear as rows on a live workspace. */
export const DEMO_PERSON_NAMES = ["Dave", "Mia"] as const;

/**
 * Dashboard views from ViewStateSchema. A new view in the contract
 * is walked by the real-workspace gate without editing the spec body.
 */
export function dashboardViewsFromContract(): string[] {
  return ViewStateSchema.options.map((option) => {
    const view = option.shape.view;
    if (!("value" in view) || typeof view.value !== "string") {
      throw new Error("ViewStateSchema option is missing a view literal");
    }
    return view.value;
  });
}

export type McpToolRow = { name: string };

export async function listMcpTools(
  request: APIRequestContext
): Promise<McpToolRow[]> {
  const response = await request.post("/api/mcp", {
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(response.ok(), `tools/list HTTP ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { result?: { tools?: McpToolRow[] } };
  const tools = body.result?.tools ?? [];
  expect(tools.length, "tools/list returned no tools").toBeGreaterThan(0);
  return tools;
}

export async function adminJson(
  request: APIRequestContext,
  method: string,
  url: string,
  body?: unknown
) {
  return request.fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${ADMIN_KEY}`,
      "content-type": "application/json",
    },
    data: body,
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createEmptyWorkspace(
  request: APIRequestContext,
  id: string,
  name: string
): Promise<void> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const created = await adminJson(request, "POST", "/api/v1/workspaces", {
      id,
      name,
    });
    lastStatus = created.status();
    if (lastStatus === 201) return;
    if (lastStatus === 400) {
      const body = (await created.json().catch(() => ({}))) as { error?: string };
      if ((body.error ?? "").toLowerCase().includes("already exists")) return;
    }
    await sleep(800 * (attempt + 1));
  }
  expect(lastStatus, `POST /api/v1/workspaces ${lastStatus}`).toBe(201);
}

/**
 * Typed-name delete (ANY-69) so later e2e specs do not inherit this
 * workspace's connectors, users, or sync state.
 */
export async function deleteLiveWorkspace(
  request: APIRequestContext,
  id: string,
  name: string
): Promise<void> {
  const deleted = await adminJson(request, "DELETE", "/api/v1/workspaces", {
    id,
    name,
  });
  if (deleted.status() === 404) return;
  expect(
    deleted.ok(),
    `DELETE /api/v1/workspaces ${deleted.status()}`
  ).toBeTruthy();
}

/**
 * Point ICS at a non-local URL so a later sync cannot hang on a closed
 * fixture port.
 */
export async function neutralizeIcsSource(
  request: APIRequestContext,
  workspace: string,
  key: string
): Promise<void> {
  const { response } = await callMcpTool(
    request,
    "connect_source",
    {
      workspace,
      source: "ics",
      credentials: { icsUrl: "https://example.com/calendar.ics" },
    },
    { Authorization: `Bearer ${key}` }
  );
  expect(response.ok(), `neutralize ICS ${response.status()}`).toBeTruthy();
}

export async function mintWriteKey(
  request: APIRequestContext,
  workspace: string
): Promise<string> {
  const created = await adminJson(request, "POST", "/api/v1/keys", {
    name: `${workspace}-rwg`,
    scope: "write",
    workspace,
  });
  expect(created.ok(), `mint write key ${created.status()}`).toBeTruthy();
  const body = (await created.json()) as { key: string };
  expect(body.key).toMatch(/^ak_/);
  return body.key;
}

export async function expectWorkspaceEmpty(
  request: APIRequestContext,
  workspace: string,
  key: string
): Promise<void> {
  const users = await request.get(`/api/v1/users?workspace=${workspace}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  expect(users.ok(), `empty users ${users.status()}`).toBeTruthy();
  const body = (await users.json()) as { users?: unknown[]; total?: number };
  expect(body.users ?? []).toEqual([]);
  expect(body.total ?? 0).toBe(0);
}

export async function ingestViaPublicSnippet(
  page: Page,
  request: APIRequestContext,
  input: {
    workspace: string;
    key: string;
    userId: string;
    userName: string;
    email: string;
    platform: string;
  }
): Promise<void> {
  const html = `<!doctype html>
<html>
  <body>
    <p>ANYKPI public snippet fixture</p>
    ${browserSnippet({
      endpoint: "http://localhost:3000",
      workspaceId: input.workspace,
      apiKey: input.key,
      debug: true,
      userId: input.userId,
      properties: {
        name: input.userName,
        email: input.email,
        platform: input.platform,
      },
      trackEvent: {
        name: "rwg_snippet_played",
        properties: { platform: input.platform },
      },
    })}
  </body>
</html>`;

  const deadline = Date.now() + 45_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const fixture = await page.context().newPage();
    try {
      await fixture.goto("http://localhost:3000/connect");
      await fixture.setContent(html, { waitUntil: "domcontentloaded" });
      await sleep(400);
    } finally {
      await fixture.close();
    }
    try {
      await expectUserVisibleViaRestAndMcp(request, {
        userId: input.userId,
        platform: input.platform,
        workspace: input.workspace,
        apiKey: input.key,
      });
      return;
    } catch (error) {
      lastError = error;
      await sleep(1_000);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("public snippet ingest did not land");
}

/** GET /api/views/:view with retries — postgres e2e can 500 once under load. */
export async function fetchViewJson(
  request: APIRequestContext,
  view: string,
  workspace: string,
  key: string
) {
  let last = await request.get(`/api/views/${view}?workspace=${workspace}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  for (let attempt = 0; attempt < 2 && !last.ok(); attempt += 1) {
    await sleep(1_200);
    last = await request.get(`/api/views/${view}?workspace=${workspace}`, {
      headers: { authorization: `Bearer ${key}` },
    });
  }
  return last;
}

export async function unlockWorkspace(
  page: Page,
  workspace: string,
  key: string
): Promise<void> {
  await page.goto(`/dashboard?workspace=${workspace}&view=dotplot`);
  const unlockHeading = page.getByRole("heading", {
    name: `Unlock ${workspace}`,
  });
  const daytrack = page.getByTestId("daytrack");
  await expect(unlockHeading.or(daytrack)).toBeVisible({ timeout: 20_000 });
  if (await unlockHeading.isVisible()) {
    await page.getByLabel("API key").fill(key);
    await page.getByRole("button", { name: "Open workspace" }).click();
    await expect(unlockHeading).toHaveCount(0, { timeout: 15_000 });
  }
  await expect(page).toHaveURL(new RegExp(`workspace=${workspace}`));
  expect(page.url()).not.toContain(key);
}

export async function expectNoDemoPeople(
  page: Page,
  request: APIRequestContext,
  workspace: string,
  key: string
): Promise<void> {
  const users = await request.get(`/api/v1/users?workspace=${workspace}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  expect(users.ok(), `users leak check ${users.status()}`).toBeTruthy();
  const body = (await users.json()) as { users?: { name?: string }[] };
  const names = (body.users ?? []).map((user) => user.name);
  for (const name of DEMO_PERSON_NAMES) {
    expect(names, `demo person ${name} on ${workspace}`).not.toContain(name);
    await expect(page.getByRole("button", { name: `Open ${name}` })).toHaveCount(
      0
    );
  }
}

export function viewUrlFromPayload(payload: Record<string, unknown>): string {
  const url = payload.view_url ?? payload.viewUrl;
  expect(url, "tool result missing view_url / viewUrl").toBeTruthy();
  return String(url);
}

export function expectDashboardViewUrl(
  url: string,
  workspace: string
): string {
  expect(url).toContain("/dashboard");
  if (url.includes("workspace=")) {
    expect(url).toContain(`workspace=${workspace}`);
  }
  return url;
}

export async function expectAuditContains(
  request: APIRequestContext,
  workspace: string,
  key: string,
  match: { action: string; subject?: string }
): Promise<void> {
  const url = new URL("http://localhost:3000/api/v1/audit");
  url.searchParams.set("workspace", workspace);
  url.searchParams.set("action", match.action);
  url.searchParams.set("limit", "100");
  let response = await request.get(`${url.pathname}${url.search}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  for (let attempt = 0; attempt < 4 && !response.ok(); attempt += 1) {
    const authKey =
      response.status() === 401 && key !== ADMIN_KEY ? ADMIN_KEY : key;
    await sleep(600 * (attempt + 1));
    response = await request.get(`${url.pathname}${url.search}`, {
      headers: { authorization: `Bearer ${authKey}` },
    });
  }
  expect(response.ok(), `GET /api/v1/audit ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as {
    entries: Array<{ action: string; subject: string }>;
  };
  const found = body.entries.some(
    (entry) =>
      entry.action === match.action &&
      (match.subject === undefined || entry.subject === match.subject)
  );
  expect(
    found,
    `audit missing ${match.action}${match.subject ? ` ${match.subject}` : ""}`
  ).toBeTruthy();
}

/** Local ICS feed so trigger_sync can write calendar rows on localhost. */
export function startFakeIcs(title: string): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const stamp = new Date();
  const ymd = stamp.toISOString().slice(0, 10).replace(/-/g, "");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ANYKPI//real-workspace-gate//EN",
    "BEGIN:VEVENT",
    `UID:rwg-${stamp.getTime()}@localhost`,
    `DTSTART:${ymd}T120000Z`,
    `DTEND:${ymd}T130000Z`,
    `SUMMARY:${title}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/calendar; charset=utf-8" });
      res.end(ics);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("ics listen failed"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/calendar.ics`,
        close: () =>
          new Promise((res, rej) =>
            server.close((error) => (error ? rej(error) : res()))
          ),
      });
    });
    server.on("error", reject);
  });
}

export {
  callMcpTool,
  expectUserVisibleViaRestAndMcp,
  parseMcpPayload,
  personIdFor,
};
