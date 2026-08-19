import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as postConnect } from "@/app/api/v1/connect/route";
import { POST as postWebhook } from "@/app/api/ingest/webhook/[source]/route";
import { GET as getUsers } from "@/app/api/v1/users/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { and, eq } from "drizzle-orm";
import { loadSourceCiphertext } from "@/core/sources";
import { signWebhookBody } from "@/core/webhook";

const ADMIN = "webhook-route-admin";
const WS = "webhook-route";
const POSTHOG_SECRET = "ph_destination_hmac_must_not_leak";
const ZAPIER_SECRET = "zapier_hmac_must_not_leak";

const originalKey = process.env.ANYKPI_API_KEY;
const originalSecret = process.env.ANYKPI_SECRET;

const posthogFixture = readFileSync(
  resolve(__dirname, "../../docs/recipes/posthog-destination.json"),
  "utf8"
);
const zapierFixture = readFileSync(
  resolve(__dirname, "../../docs/recipes/zapier.json"),
  "utf8"
);

afterEach(async () => {
  restoreEnv("ANYKPI_API_KEY", originalKey);
  restoreEnv("ANYKPI_SECRET", originalSecret);
  vi.unstubAllEnvs();
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function asAdmin(body: unknown) {
  process.env.ANYKPI_API_KEY = ADMIN;
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  vi.stubEnv("NODE_ENV", "test");
  return new NextRequest("http://localhost:3000/api/v1/connect", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN}`,
    },
    body: JSON.stringify(body),
  });
}

function webhookRequest(
  source: string,
  body: string,
  headers: Record<string, string> = {}
) {
  return new NextRequest(
    `http://localhost:3000/api/ingest/webhook/${source}?workspace=${WS}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body,
    }
  );
}

function captureLogs() {
  const lines: string[] = [];
  const push = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  const log = vi.spyOn(console, "log").mockImplementation(push);
  const error = vi.spyOn(console, "error").mockImplementation(push);
  const warn = vi.spyOn(console, "warn").mockImplementation(push);
  const info = vi.spyOn(console, "info").mockImplementation(push);
  return {
    lines,
    restore() {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
      info.mockRestore();
    },
  };
}

async function storeHmac(source: string, hmacSecret: string) {
  const res = await postConnect(
    asAdmin({
      source,
      workspaceId: WS,
      credentials: { hmacSecret },
    })
  );
  expect([200, 201]).toContain(res.status);
  const body = await res.json();
  expect(JSON.stringify(body)).not.toContain(hmacSecret);

  const ciphertext = await loadSourceCiphertext(WS, source);
  expect(ciphertext).toMatch(/^v1:/);
  expect(ciphertext).not.toContain(hmacSecret);
  expect(ciphertext).not.toContain("hmacSecret");

  return body as { rotated: boolean };
}

describe("POST /api/ingest/webhook/:source", () => {
  it("delivers the PostHog destination recipe end-to-end (signed fixture)", async () => {
    const logs = captureLogs();
    await storeHmac("posthog", POSTHOG_SECRET);

    const res = await postWebhook(
      webhookRequest("posthog", posthogFixture, {
        "x-webhook-signature": signWebhookBody(POSTHOG_SECRET, posthogFixture),
      }),
      { params: Promise.resolve({ source: "posthog" }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, accepted: 1 });
    expect(JSON.stringify(body)).not.toContain(POSTHOG_SECRET);

    const row = await db
      .select()
      .from(schema.activity)
      .where(
        and(
          eq(schema.activity.workspaceId, WS),
          eq(schema.activity.personId, "person_ph_recipe_user")
        )
      )
      .get();
    expect(row?.eventName).toBe("song_played");

    const listed = await getUsers(
      new NextRequest(
        `http://localhost:3000/api/v1/users?workspace=${WS}&platform=web`,
        { headers: { authorization: `Bearer ${ADMIN}` } }
      )
    );
    expect(listed.status).toBe(200);
    const users = (await listed.json()) as {
      users: { personId: string; name: string }[];
    };
    expect(users.users.map((user) => user.personId)).toContain(
      "person_ph_recipe_user"
    );
    expect(
      users.users.find((user) => user.personId === "person_ph_recipe_user")?.name
    ).toBe("Recipe Listener");

    expect(logs.lines.join("\n")).not.toContain(POSTHOG_SECRET);
    logs.restore();
  });

  it("delivers the Zapier recipe fixture when signed", async () => {
    await storeHmac("zapier", ZAPIER_SECRET);

    const res = await postWebhook(
      webhookRequest("zapier", zapierFixture, {
        "x-hub-signature-256": signWebhookBody(ZAPIER_SECRET, zapierFixture),
      }),
      { params: Promise.resolve({ source: "zapier" }) }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, accepted: 1 });

    const row = await db
      .select()
      .from(schema.activity)
      .where(
        and(
          eq(schema.activity.workspaceId, WS),
          eq(schema.activity.personId, "person_zap_recipe_user")
        )
      )
      .get();
    expect(row?.eventName).toBe("song_played");
  });

  it("returns 401 for a bad signature", async () => {
    await storeHmac("posthog", POSTHOG_SECRET);

    const res = await postWebhook(
      webhookRequest("posthog", posthogFixture, {
        "x-webhook-signature": signWebhookBody("wrong-secret", posthogFixture),
      }),
      { params: Promise.resolve({ source: "posthog" }) }
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });

    const row = await db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, WS))
      .get();
    expect(row).toBeUndefined();
  });

  it("returns 401 when the signature header is missing", async () => {
    await storeHmac("posthog", POSTHOG_SECRET);

    const res = await postWebhook(
      webhookRequest("posthog", posthogFixture),
      { params: Promise.resolve({ source: "posthog" }) }
    );
    expect(res.status).toBe(401);
  });

  it("rotating the secret invalidates the old one immediately", async () => {
    const first = "hmac_first_rotate_value";
    const second = "hmac_second_rotate_value";
    const logs = captureLogs();

    const created = await storeHmac("zapier", first);
    expect(created.rotated).toBe(false);

    const accepted = await postWebhook(
      webhookRequest("zapier", zapierFixture, {
        "x-webhook-signature": signWebhookBody(first, zapierFixture),
      }),
      { params: Promise.resolve({ source: "zapier" }) }
    );
    expect(accepted.status).toBe(200);

    const rotated = await storeHmac("zapier", second);
    expect(rotated.rotated).toBe(true);

    const stale = await postWebhook(
      webhookRequest("zapier", zapierFixture, {
        "x-webhook-signature": signWebhookBody(first, zapierFixture),
      }),
      { params: Promise.resolve({ source: "zapier" }) }
    );
    expect(stale.status).toBe(401);

    const fresh = await postWebhook(
      webhookRequest("zapier", zapierFixture, {
        "x-webhook-signature": signWebhookBody(second, zapierFixture),
      }),
      { params: Promise.resolve({ source: "zapier" }) }
    );
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual({ success: true, accepted: 1 });

    expect(logs.lines.join("\n")).not.toContain(first);
    expect(logs.lines.join("\n")).not.toContain(second);
    logs.restore();
  });
});
