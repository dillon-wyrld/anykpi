import { test, expect } from "@playwright/test";
import { browserSnippet } from "../packages/sdk/src/snippet";

const API_KEY = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";

test("copy-paste /connect snippet delivers an event with no build step", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const userId = `sdk-snippet-${stamp}`;
  const platform = `sdk-snippet-${stamp}`;

  const html = `<!doctype html>
<html>
  <body>
    <p>SDK snippet fixture</p>
    ${browserSnippet({
      endpoint: "http://localhost:3000",
      workspaceId: "demo",
      apiKey: API_KEY,
      debug: true,
      userId,
      properties: { name: "SDK snippet user", platform },
      trackEvent: { name: "sdk_snippet_played", properties: { platform } },
    })}
  </body>
</html>`;

  await page.goto("http://localhost:3000/connect");

  const identify = page.waitForResponse(
    (res) =>
      res.url().includes("/api/ingest/identify") &&
      res.request().method() === "POST" &&
      res.ok()
  );
  const event = page.waitForResponse(
    (res) =>
      res.url().includes("/api/ingest/event") &&
      res.request().method() === "POST" &&
      res.ok()
  );

  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await Promise.all([identify, event]);

  const users = await request.get(
    `/api/v1/users?workspace=demo&platform=${encodeURIComponent(platform)}`
  );
  expect(users.ok()).toBeTruthy();
  const body = await users.json();
  expect(body.users.map((user: { personId: string }) => user.personId)).toContain(
    `person_${userId}`
  );
});
