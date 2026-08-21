import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

/**
 * ANY-61 — a fresh live workspace proposes a starter deck; accept
 * becomes a working WBR with computed statuses.
 */

const ADMIN = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";

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

async function retryOk(label: string, run: () => Promise<APIResponse>): Promise<APIResponse> {
  let last: APIResponse | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await run();
    if (last.ok()) return last;
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  expect(last?.ok(), `${label} ${last?.status()}`).toBeTruthy();
  return last!;
}

test("fresh live workspace proposes a starter deck; accept computes statuses", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const WS = `e2e-wbr-${Date.now().toString(36)}-${testInfo.retry}`;

  const created = await adminJson(request, "POST", "/api/v1/workspaces", {
    id: WS,
    name: "WBR builder",
  });
  expect([201, 400]).toContain(created.status());

  const minted = await adminJson(request, "POST", "/api/v1/keys", {
    name: `${WS}-e2e`,
    scope: "write",
    workspace: WS,
  });
  expect(minted.ok()).toBeTruthy();
  const { key } = (await minted.json()) as { key: string };

  const identify = await request.post("/api/ingest/identify", {
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    data: {
      userId: "wbr-ada",
      workspaceId: WS,
      properties: { name: "Ada", platform: "web" },
    },
  });
  expect(identify.ok()).toBeTruthy();

  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    const track = await request.post("/api/ingest/event", {
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      data: {
        userId: "wbr-ada",
        eventName: "song_played",
        workspaceId: WS,
        timestamp: new Date(now - i * 7 * 86400000).toISOString(),
      },
    });
    expect(track.ok()).toBeTruthy();
  }

  const proposed = await retryOk("propose", () =>
    request.get(`/api/views/wbr?workspace=${WS}`, {
      headers: { authorization: `Bearer ${key}` },
    })
  );
  const before = (await proposed.json()) as {
    metrics: { id: string }[];
    proposals: { id: string; status: string; name: string }[];
  };
  expect(before.metrics.length).toBe(0);
  expect(before.proposals.map((p) => p.id)).toEqual(
    expect.arrayContaining(["wbr_signups", "wbr_actives", "wbr_retention"])
  );

  const accept = await retryOk("accept", () =>
    adminJson(request, "PATCH", `/api/v1/metrics?workspace=${WS}`, {
      action: "accept",
      workspace: WS,
    })
  );

  const afterRes = await retryOk("after", () =>
    request.get(`/api/views/wbr?workspace=${WS}`, {
      headers: { authorization: `Bearer ${key}` },
    })
  );
  const after = (await afterRes.json()) as {
    metrics: { id: string; name: string; status: string; weeks: number[] }[];
    proposals: { id: string }[];
  };
  expect(after.proposals).toEqual([]);
  expect(after.metrics.map((m) => m.id)).toEqual(
    expect.arrayContaining(["wbr_signups", "wbr_actives", "wbr_retention"])
  );
  expect(after.metrics.every((m) => ["ok", "watch", "off"].includes(m.status))).toBe(
    true
  );
  expect(after.metrics.find((m) => m.id === "wbr_actives")?.weeks.length).toBe(6);

  await page.goto(`/dashboard?workspace=${WS}&view=wbr`);
  await expect(page.getByRole("heading", { name: `Unlock ${WS}` })).toBeVisible();
  await page.getByLabel("API key").fill(key);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByRole("heading", { name: `Unlock ${WS}` })).toHaveCount(0, {
    timeout: 15_000,
  });

  const cookieView = await retryOk("session wbr", () =>
    page.request.get(`/api/views/wbr?workspace=${WS}`)
  );
  const cookieBody = (await cookieView.json()) as { metrics: { id: string }[] };
  expect(cookieBody.metrics.map((m) => m.id)).toEqual(
    expect.arrayContaining(["wbr_signups", "wbr_actives", "wbr_retention"])
  );

  await expect(page.getByRole("heading", { name: "Weekly Business Review" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("New signups")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Weekly actives")).toBeVisible({ timeout: 15_000 });
});
