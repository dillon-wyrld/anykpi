/**
 * Generic webhook-in: HMAC-SHA256 over the raw body, per-source secret
 * from the encrypted sources store.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { SourceSlugSchema } from "./contracts";
import type { SourceConfig } from "./sources";
import { webhookSecretFromConfig } from "./sources";

const SIG_HEADERS = ["x-webhook-signature", "x-hub-signature-256"] as const;

export type WebhookEvent = {
  userId: string;
  eventName: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
};

export function isSourceSlug(value: string): boolean {
  return SourceSlugSchema.safeParse(value).success;
}

export function hmacSha256Hex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${hmacSha256Hex(secret, body)}`;
}

function parsePresentedSignature(value: string): string | null {
  const trimmed = value.trim();
  const prefixed = /^(?:sha256=)?([0-9a-fA-F]{64})$/.exec(trimmed);
  return prefixed ? prefixed[1].toLowerCase() : null;
}

export function presentedSignature(headers: Headers): string | null {
  for (const name of SIG_HEADERS) {
    const raw = headers.get(name);
    if (!raw) continue;
    const parsed = parsePresentedSignature(raw);
    if (parsed) return parsed;
  }
  return null;
}

export function signaturesMatch(providedHex: string, expectedHex: string): boolean {
  const a = Buffer.from(providedHex, "hex");
  const b = Buffer.from(expectedHex, "hex");
  if (a.length !== 32 || b.length !== 32 || a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function verifyWebhookSignature(
  secret: string,
  body: string,
  headers: Headers
): boolean {
  const presented = presentedSignature(headers);
  if (!presented) return false;
  return signaturesMatch(presented, hmacSha256Hex(secret, body));
}

export function sourceWebhookSecret(config: SourceConfig | null): string | null {
  return webhookSecretFromConfig(config);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickUserId(record: Record<string, unknown>): string | undefined {
  const direct =
    asNonEmptyString(record.userId) ?? asNonEmptyString(record.distinct_id);
  if (direct) return direct;

  const user = asRecord(record.user);
  if (user) {
    const nested =
      asNonEmptyString(user.id) ??
      asNonEmptyString(user.userId) ??
      asNonEmptyString(user.distinct_id);
    if (nested) return nested;
  }

  const person = asRecord(record.person);
  if (person) {
    return (
      asNonEmptyString(person.distinct_id) ??
      asNonEmptyString(person.id) ??
      asNonEmptyString(person.userId)
    );
  }

  return undefined;
}

function pickEventName(record: Record<string, unknown>): string | undefined {
  const named = asNonEmptyString(record.eventName);
  if (named) return named;

  if (typeof record.event === "string" && record.event.length > 0) {
    return record.event;
  }

  const nested = asRecord(record.event);
  if (nested) {
    return (
      asNonEmptyString(nested.event) ??
      asNonEmptyString(nested.eventName) ??
      asNonEmptyString(nested.name)
    );
  }

  return undefined;
}

function pickProperties(
  record: Record<string, unknown>
): Record<string, unknown> | undefined {
  const props = asRecord(record.properties);
  return props ?? undefined;
}

function pickTimestamp(record: Record<string, unknown>): string | undefined {
  const direct = record.timestamp;
  if (typeof direct === "string" && direct.length > 0) return direct;
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return new Date(direct).toISOString();
  }

  const nested = asRecord(record.event);
  if (nested) {
    const inner = nested.timestamp;
    if (typeof inner === "string" && inner.length > 0) return inner;
  }

  return undefined;
}

export function normalizeWebhookEvent(value: unknown): WebhookEvent | null {
  const record = asRecord(value);
  if (!record) return null;

  const nestedEvent = asRecord(record.event);
  const userId = pickUserId(record) ?? (nestedEvent ? pickUserId(nestedEvent) : undefined);
  const eventName =
    pickEventName(record) ?? (nestedEvent ? pickEventName(nestedEvent) : undefined);
  if (!userId || !eventName) return null;

  return {
    userId,
    eventName,
    properties:
      pickProperties(record) ??
      (nestedEvent ? pickProperties(nestedEvent) : undefined),
    timestamp:
      pickTimestamp(record) ??
      (nestedEvent ? pickTimestamp(nestedEvent) : undefined),
  };
}

export function normalizeWebhookPayload(body: unknown): WebhookEvent[] {
  if (Array.isArray(body)) {
    return body
      .map((item) => normalizeWebhookEvent(item))
      .filter((item): item is WebhookEvent => item !== null);
  }

  const record = asRecord(body);
  if (!record) return [];

  const batch = record.events;
  if (Array.isArray(batch)) {
    return batch
      .map((item) => normalizeWebhookEvent(item))
      .filter((item): item is WebhookEvent => item !== null);
  }

  const single = normalizeWebhookEvent(record);
  return single ? [single] : [];
}

export function classifyEventName(
  eventName: string
): "core" | "search" | "share" | "pay" {
  const eventLower = eventName.toLowerCase();
  if (eventLower.includes("search") || eventLower.includes("query")) {
    return "search";
  }
  if (eventLower.includes("share") || eventLower.includes("invite")) {
    return "share";
  }
  if (
    eventLower.includes("pay") ||
    eventLower.includes("purchase") ||
    eventLower.includes("subscribe")
  ) {
    return "pay";
  }
  return "core";
}
