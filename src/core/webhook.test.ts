import { describe, expect, it } from "vitest";
import { webhookSecretFromConfig } from "./sources";
import {
  classifyEventName,
  hmacSha256Hex,
  isSourceSlug,
  normalizeWebhookPayload,
  presentedSignature,
  signWebhookBody,
  signaturesMatch,
  verifyWebhookSignature,
} from "./webhook";

describe("webhook HMAC", () => {
  it("signs the raw body as sha256=<hex>", () => {
    const body = '{"event":"song_played"}';
    const header = signWebhookBody("recipe-secret", body);
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(header.slice(7)).toBe(hmacSha256Hex("recipe-secret", body));
  });

  it("accepts sha256= and bare hex on either signature header", () => {
    const body = '{"ok":true}';
    const hex = hmacSha256Hex("s", body);

    expect(
      presentedSignature(new Headers({ "x-webhook-signature": `sha256=${hex}` }))
    ).toBe(hex);
    expect(
      presentedSignature(new Headers({ "x-hub-signature-256": hex }))
    ).toBe(hex);
    expect(presentedSignature(new Headers())).toBeNull();
  });

  it("rejects a signature for a different body or secret", () => {
    const body = '{"event":"song_played"}';
    const headers = new Headers({
      "x-webhook-signature": signWebhookBody("s1", body),
    });
    expect(verifyWebhookSignature("s1", body, headers)).toBe(true);
    expect(verifyWebhookSignature("s1", '{"event":"other"}', headers)).toBe(
      false
    );
    expect(verifyWebhookSignature("s2", body, headers)).toBe(false);
    expect(signaturesMatch("aa".repeat(32), "bb".repeat(32))).toBe(false);
  });
});

describe("webhook payload recipes", () => {
  it("reads a PostHog destination event", () => {
    const events = normalizeWebhookPayload({
      event: "song_played",
      distinct_id: "ph_recipe_user",
      timestamp: "2026-03-15T12:00:00.000Z",
      properties: { name: "Recipe Listener", platform: "web" },
    });
    expect(events).toEqual([
      {
        userId: "ph_recipe_user",
        eventName: "song_played",
        properties: { name: "Recipe Listener", platform: "web" },
        timestamp: "2026-03-15T12:00:00.000Z",
      },
    ]);
  });

  it("reads a Zapier canonical event", () => {
    const events = normalizeWebhookPayload({
      userId: "zap_recipe_user",
      eventName: "song_played",
    });
    expect(events).toEqual([
      {
        userId: "zap_recipe_user",
        eventName: "song_played",
        properties: undefined,
        timestamp: undefined,
      },
    ]);
  });

  it("classifies event names the same way as /api/ingest/event", () => {
    expect(classifyEventName("song_played")).toBe("core");
    expect(classifyEventName("search_query")).toBe("search");
    expect(classifyEventName("invite_sent")).toBe("share");
    expect(classifyEventName("subscribe_started")).toBe("pay");
  });

  it("reads hmacSecret, then webhookSecret, then secretKey", () => {
    expect(webhookSecretFromConfig({ hmacSecret: "a" })).toBe("a");
    expect(webhookSecretFromConfig({ webhookSecret: "b" })).toBe("b");
    expect(webhookSecretFromConfig({ secretKey: "c" })).toBe("c");
    expect(webhookSecretFromConfig({ apiKey: "phc_x" })).toBeNull();
    expect(webhookSecretFromConfig(null)).toBeNull();
  });

  it("accepts source slugs used by the recipes", () => {
    expect(isSourceSlug("posthog")).toBe(true);
    expect(isSourceSlug("zapier")).toBe(true);
    expect(isSourceSlug("webhook")).toBe(true);
    expect(isSourceSlug("Not Valid")).toBe(false);
  });
});
