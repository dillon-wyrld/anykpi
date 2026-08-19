import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { loadSourceCiphertext, saveSourceConfig } from "@/core/sources";
import { POST as postStripeWebhook } from "@/app/api/webhooks/stripe/route";
import { sync } from "./index";
import {
  computeStripeSignature,
  subscriptionMrr,
  verifyStripeSignature,
  type StripeEvent,
} from "./stripe";
import { clearWorkspace, restoreEnv, withOfflineSuite } from "./testing/offline";

const WS = "contract-stripe";
const KEY = "rk_test_fixture_restricted";
const WEBHOOK_RAW = "fixture_webhook_secret";
const WEBHOOK_SECRET = `whsec_${Buffer.from(WEBHOOK_RAW, "utf8").toString("base64")}`;

const originalKey = process.env.STRIPE_API_KEY;
const originalWebhook = process.env.STRIPE_WEBHOOK_SECRET;
const originalSecret = process.env.ANYKPI_SECRET;

afterEach(async () => {
  restoreEnv("STRIPE_API_KEY", originalKey);
  restoreEnv("STRIPE_WEBHOOK_SECRET", originalWebhook);
  restoreEnv("ANYKPI_SECRET", originalSecret);
  await clearWorkspace(WS);
});

async function storeCredentials() {
  delete process.env.STRIPE_API_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  await saveSourceConfig(WS, "stripe", {
    apiKey: KEY,
    webhookSecret: WEBHOOK_SECRET,
  });
}

function fixtureEvent(): StripeEvent {
  return JSON.parse(
    readFileSync(
      resolve(__dirname, "testing/fixtures/stripe/webhook/event.json"),
      "utf8"
    )
  ) as StripeEvent;
}

function signedRequest(payload: string, secret: string, workspace = WS) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = computeStripeSignature(payload, timestamp, secret);
  return new NextRequest(
    `http://localhost:3000/api/webhooks/stripe?workspace=${encodeURIComponent(workspace)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${timestamp},v1=${signature}`,
      },
      body: payload,
    }
  );
}

describe("Stripe connector contract", () => {
  it("paginates to completion and writes the MRR read model", async () => {
    await storeCredentials();
    const ciphertext = await loadSourceCiphertext(WS, "stripe");
    expect(ciphertext).toBeTruthy();
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain(KEY);

    await withOfflineSuite("stripe", ["stripe", "happy"], async (harness) => {
      const result = await sync("stripe", WS);

      expect(result).toEqual({
        rowsSynced: 2,
        nextCursor: null,
        health: "ok",
      });

      expect(harness.calls).toHaveLength(2);
      expect(harness.calls[0]?.url).toMatch(/\/v1\/subscriptions\?limit=100&status=all$/);
      expect(harness.calls[1]?.url).toContain("starting_after=sub_aaa");

      const people = await db
        .select()
        .from(schema.personRevenue)
        .where(eq(schema.personRevenue.workspaceId, WS))
        .all();
      expect(people).toHaveLength(2);
      expect(people.map((row) => row.personId).sort()).toEqual(["cus_aaa", "cus_bbb"]);
      expect(people.reduce((sum, row) => sum + row.mrr, 0)).toBe(28);

      const snapshots = await db
        .select()
        .from(schema.mrrSnapshots)
        .where(eq(schema.mrrSnapshots.workspaceId, WS))
        .all();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.mrr).toBe(28);
      expect(snapshots[0]?.subscriberCount).toBe(2);
      expect(snapshots[0]?.source).toBe("stripe");
    });
  });

  it("resumes from SyncResult.nextCursor for a single page", async () => {
    await storeCredentials();

    await withOfflineSuite("stripe", ["stripe", "happy"], async (harness) => {
      const page = await sync("stripe", WS, { cursor: "sub_aaa" });
      expect(page).toEqual({
        rowsSynced: 1,
        nextCursor: null,
        health: "ok",
      });
      expect(harness.calls).toHaveLength(1);
      expect(harness.calls[0]?.url).toContain("starting_after=sub_aaa");
    });
  });

  it("returns health error on 401 and does not advance the cursor", async () => {
    await storeCredentials();

    await withOfflineSuite("stripe", ["stripe", "unauthorized"], async () => {
      const result = await sync("stripe", WS);
      expect(result).toEqual({
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "unauthorized",
      });
    });
  });

  it("returns health error on rate-limit and does not advance the cursor", async () => {
    await storeCredentials();

    await withOfflineSuite("stripe", ["stripe", "rate-limit"], async () => {
      const result = await sync("stripe", WS);
      expect(result).toEqual({
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "rate limited",
      });
    });
  });

  it("never logs the restricted key", async () => {
    await storeCredentials();
    const lines: string[] = [];
    const push = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    const log = vi.spyOn(console, "log").mockImplementation(push);
    const error = vi.spyOn(console, "error").mockImplementation(push);

    await withOfflineSuite("stripe", ["stripe", "happy"], async () => {
      await sync("stripe", WS);
    });

    expect(lines.join("\n")).not.toContain(KEY);
    log.mockRestore();
    error.mockRestore();
  });
});

describe("Stripe webhook", () => {
  it("verifies signatures with the signing secret", () => {
    const payload = JSON.stringify(fixtureEvent());
    const timestamp = 1712102400;
    const header = `t=${timestamp},v1=${computeStripeSignature(payload, timestamp, WEBHOOK_SECRET)}`;
    expect(
      verifyStripeSignature({
        payload,
        header,
        secret: WEBHOOK_SECRET,
        nowSec: timestamp,
      })
    ).toBe(true);
    expect(
      verifyStripeSignature({
        payload,
        header: `t=${timestamp},v1=deadbeef`,
        secret: WEBHOOK_SECRET,
        nowSec: timestamp,
      })
    ).toBe(false);
  });

  it("updates the MRR read model from a fixture event without a poll", async () => {
    process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
    await saveSourceConfig(WS, "stripe", {
      apiKey: KEY,
      webhookSecret: WEBHOOK_SECRET,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const payload = JSON.stringify(fixtureEvent());
    const res = await postStripeWebhook(signedRequest(payload, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, applied: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    const people = await db
      .select()
      .from(schema.personRevenue)
      .where(eq(schema.personRevenue.workspaceId, WS))
      .all();
    expect(people).toHaveLength(1);
    expect(people[0]?.personId).toBe("cus_webhook");
    expect(people[0]?.mrr).toBe(24);
    expect(people[0]?.plan).toBe("plus");
    expect(people[0]?.source).toBe("stripe");

    const snapshots = await db
      .select()
      .from(schema.mrrSnapshots)
      .where(eq(schema.mrrSnapshots.workspaceId, WS))
      .all();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.mrr).toBe(24);
    expect(snapshots[0]?.subscriberCount).toBe(1);
    expect(snapshots[0]?.source).toBe("stripe");

    const events = await db
      .select()
      .from(schema.subscriptionEvents)
      .where(eq(schema.subscriptionEvents.workspaceId, WS))
      .all();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("new");
    expect(events[0]?.sourceEventId).toBe("evt:evt_fixture_sub_created");
  });

  it("rejects a forged signature and does not write", async () => {
    process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
    await saveSourceConfig(WS, "stripe", { webhookSecret: WEBHOOK_SECRET });

    const payload = JSON.stringify(fixtureEvent());
    const res = await postStripeWebhook(signedRequest(payload, "whsec_forged"));
    expect(res.status).toBe(400);

    const snapshots = await db
      .select()
      .from(schema.mrrSnapshots)
      .where(eq(schema.mrrSnapshots.workspaceId, WS))
      .all();
    expect(snapshots).toHaveLength(0);
  });
});

describe("subscription MRR", () => {
  it("converts yearly prices to monthly", () => {
    expect(
      subscriptionMrr({
        id: "sub_year",
        items: {
          data: [
            {
              quantity: 1,
              price: {
                unit_amount: 12000,
                recurring: { interval: "year", interval_count: 1 },
              },
            },
          ],
        },
      })
    ).toBe(10);
  });
});
