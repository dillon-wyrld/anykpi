import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as getAudit } from "@/app/api/v1/audit/route";
import { POST as postIdentify } from "@/app/api/ingest/identify/route";
import { POST as postEvent } from "@/app/api/ingest/event/route";
import { POST as postBatch } from "@/app/api/ingest/batch/route";
import { POST as postWebhook } from "@/app/api/ingest/webhook/[source]/route";
import { POST as postConnect } from "@/app/api/v1/connect/route";
import { POST as postImport } from "@/app/api/v1/import/route";
import { POST as postSync } from "@/app/api/v1/sync/route";
import { POST as createKey } from "@/app/api/v1/keys/route";
import { DELETE as deleteKey } from "@/app/api/v1/keys/[id]/route";
import { POST as downgradeKeys } from "@/app/api/v1/keys/downgrade/route";
import { POST as postStripeWebhook } from "@/app/api/webhooks/stripe/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import { POST as postOutreach } from "@/app/api/v1/outreach/route";
import { POST as postOutreachApprove } from "@/app/api/v1/outreach/approve/route";
import { POST as postOutreachSend } from "@/app/api/v1/outreach/send/route";
import { POST as postOutreachOutcome } from "@/app/api/v1/outreach/outcome/route";
import { DELETE as deleteUser } from "@/app/api/v1/users/[id]/route";
import {
  PATCH as archiveWorkspaceRoute,
  POST as createWorkspaceRoute,
} from "@/app/api/v1/workspaces/route";
import { PATCH as patchConfig } from "@/app/api/v1/config/route";
import {
  AUDIT_ACTIONS,
  WRITE_HTTP_ROUTES,
  WRITE_ROUTE_MODULES,
  recordAudit,
} from "@/core/audit";
import { AUDIT_ACTOR_ENV, AUDIT_ACTOR_WEBHOOK } from "@/core/auth";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { saveSourceConfig } from "@/core/sources";
import { signWebhookBody } from "@/core/webhook";
import { registry } from "@/connectors";
import { computeStripeSignature, type StripeEvent } from "@/connectors/stripe";

const ADMIN = "audit-route-admin";
const WS = "audit-log";
const HMAC = "audit-hmac-secret";
const STRIPE_WEBHOOK_RAW = "audit_stripe_webhook";
const STRIPE_WEBHOOK_SECRET = `whsec_${Buffer.from(STRIPE_WEBHOOK_RAW, "utf8").toString("base64")}`;

const originalKey = process.env.ANYKPI_API_KEY;
const originalSecret = process.env.ANYKPI_SECRET;
const originalPosthogSync = registry.posthog.sync;

const root = resolve(__dirname, "../..");

afterEach(async () => {
  registry.posthog.sync = originalPosthogSync;
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.ANYKPI_SECRET;
  else process.env.ANYKPI_SECRET = originalSecret;
  vi.unstubAllEnvs();
  await db.delete(schema.auditLog).where(eq(schema.auditLog.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, WS));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WS));
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, WS));
  await db.delete(schema.outreachDelivery).where(eq(schema.outreachDelivery.workspaceId, WS));
  await db.delete(schema.outreach).where(eq(schema.outreach.workspaceId, WS));
  await db.delete(schema.config).where(eq(schema.config.workspaceId, WS));
  await db.delete(schema.personRevenue).where(eq(schema.personRevenue.workspaceId, WS));
  await db.delete(schema.mrrSnapshots).where(eq(schema.mrrSnapshots.workspaceId, WS));
  await db.delete(schema.subscriptionEvents).where(eq(schema.subscriptionEvents.workspaceId, WS));
  await db.delete(schema.tombstones).where(eq(schema.tombstones.workspaceId, WS));
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
});

function asAdmin(url: string, method: string, body?: unknown) {
  process.env.ANYKPI_API_KEY = ADMIN;
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  vi.stubEnv("NODE_ENV", "test");
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function queryAudit(params: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/v1/audit");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await getAudit(asAdmin(url.toString(), "GET"));
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    workspace: string;
    total: number;
    entries: Array<{
      actor: string;
      action: string;
      subject: string;
      createdAt: string;
      workspaceId: string;
    }>;
  }>;
}

type Driver = () => Promise<{ actor: string; subject?: string }>;

const drivers: Record<(typeof WRITE_HTTP_ROUTES)[number]["action"], Driver> = {
  [AUDIT_ACTIONS.ingestIdentify]: async () => {
    const res = await postIdentify(
      asAdmin("http://localhost:3000/api/ingest/identify", "POST", {
        userId: "audit-identify",
        workspaceId: WS,
        properties: { name: "Ada" },
      })
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_ENV, subject: "person_audit-identify" };
  },
  [AUDIT_ACTIONS.ingestEvent]: async () => {
    const res = await postEvent(
      asAdmin("http://localhost:3000/api/ingest/event", "POST", {
        userId: "audit-event",
        eventName: "song_played",
        workspaceId: WS,
      })
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_ENV, subject: "person_audit-event" };
  },
  [AUDIT_ACTIONS.ingestBatch]: async () => {
    const res = await postBatch(
      asAdmin("http://localhost:3000/api/ingest/batch", "POST", {
        workspaceId: WS,
        events: [
          {
            userId: "audit-batch",
            eventName: "song_played",
            idempotencyKey: "audit-batch-1",
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_ENV, subject: "1" };
  },
  [AUDIT_ACTIONS.ingestWebhook]: async () => {
    const connected = await postConnect(
      asAdmin("http://localhost:3000/api/v1/connect", "POST", {
        source: "webhook",
        workspaceId: WS,
        credentials: { hmacSecret: HMAC },
      })
    );
    expect(connected.status).toBe(201);
    const body = JSON.stringify({
      userId: "audit-hook",
      eventName: "song_played",
    });
    const res = await postWebhook(
      new NextRequest(
        `http://localhost:3000/api/ingest/webhook/webhook?workspace=${WS}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-webhook-signature": signWebhookBody(HMAC, body),
          },
          body,
        }
      ),
      { params: Promise.resolve({ source: "webhook" }) }
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_WEBHOOK, subject: "webhook" };
  },
  [AUDIT_ACTIONS.connectSave]: async () => {
    const res = await postConnect(
      asAdmin("http://localhost:3000/api/v1/connect", "POST", {
        source: "ics",
        workspaceId: WS,
        credentials: { icsUrl: "https://example.test/cal.ics" },
      })
    );
    expect([200, 201]).toContain(res.status);
    return { actor: AUDIT_ACTOR_ENV, subject: "ics" };
  },
  [AUDIT_ACTIONS.importCsv]: async () => {
    const csv = readFileSync(
      resolve(root, "tests/fixtures/import/events.csv"),
      "utf8"
    );
    const res = await postImport(
      asAdmin("http://localhost:3000/api/v1/import", "POST", {
        csv,
        kind: "events",
        workspaceId: WS,
      })
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_ENV, subject: "events" };
  },
  [AUDIT_ACTIONS.syncTrigger]: async () => {
    registry.posthog.sync = async () => ({
      rowsSynced: 0,
      nextCursor: null,
      health: "ok",
    });
    const res = await postSync(
      asAdmin("http://localhost:3000/api/v1/sync", "POST", {
        source: "posthog",
        workspace: WS,
      })
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_ENV, subject: "posthog" };
  },
  [AUDIT_ACTIONS.keysCreate]: async () => {
    const res = await createKey(
      asAdmin("http://localhost:3000/api/v1/keys", "POST", {
        name: "audit-mint",
        scope: "write",
        workspace: WS,
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    return { actor: AUDIT_ACTOR_ENV, subject: body.id };
  },
  [AUDIT_ACTIONS.keysRevoke]: async () => {
    const created = await createKey(
      asAdmin("http://localhost:3000/api/v1/keys", "POST", {
        name: "audit-revoke",
        scope: "write",
        workspace: WS,
      })
    );
    const { id } = (await created.json()) as { id: string };
    const res = await deleteKey(
      asAdmin(`http://localhost:3000/api/v1/keys/${id}`, "DELETE"),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_ENV, subject: id };
  },
  [AUDIT_ACTIONS.keysDowngrade]: async () => {
    const id = `ak_audit_legacy_${Date.now()}`;
    await db.insert(schema.apiKeys).values({
      id,
      hashedKey: "not-a-real-hash",
      name: "legacy",
      workspaceId: WS,
      createdAt: new Date(),
      scope: "write",
      legacy: true,
    });
    const res = await downgradeKeys(
      asAdmin("http://localhost:3000/api/v1/keys/downgrade", "POST", { id })
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_ENV, subject: id };
  },
  [AUDIT_ACTIONS.webhookStripe]: async () => {
    process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
    await saveSourceConfig(WS, "stripe", {
      apiKey: "rk_audit",
      webhookSecret: STRIPE_WEBHOOK_SECRET,
    });
    const event = JSON.parse(
      readFileSync(
        resolve(root, "src/connectors/testing/fixtures/stripe/webhook/event.json"),
        "utf8"
      )
    ) as StripeEvent;
    const payload = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = computeStripeSignature(payload, timestamp, STRIPE_WEBHOOK_SECRET);
    const res = await postStripeWebhook(
      new NextRequest(
        `http://localhost:3000/api/webhooks/stripe?workspace=${WS}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": `t=${timestamp},v1=${signature}`,
          },
          body: payload,
        }
      )
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_WEBHOOK, subject: "evt_fixture_sub_created" };
  },
  [AUDIT_ACTIONS.outreachQueue]: async () => {
    const res = await postOutreach(
      asAdmin("http://localhost:3000/api/v1/outreach", "POST", {
        workspaceId: WS,
        personId: "audit-outreach",
        body: "hey — 15 minutes?",
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { draft: { id: string } };
    return { actor: AUDIT_ACTOR_ENV, subject: body.draft.id };
  },
  [AUDIT_ACTIONS.outreachApprove]: async () => {
    const queued = await postOutreach(
      asAdmin("http://localhost:3000/api/v1/outreach", "POST", {
        workspaceId: WS,
        personId: "audit-approve",
        body: "hey — 15 minutes?",
      })
    );
    const { draft } = (await queued.json()) as { draft: { id: string } };
    const res = await postOutreachApprove(
      asAdmin("http://localhost:3000/api/v1/outreach/approve", "POST", {
        workspaceId: WS,
        id: draft.id,
      })
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_ENV, subject: draft.id };
  },
  [AUDIT_ACTIONS.outreachSend]: async () => {
    await db.insert(schema.users).values({
      personId: "audit-send",
      name: "Ada",
      email: "ada@example.com",
      workspaceId: WS,
    });
    const queued = await postOutreach(
      asAdmin("http://localhost:3000/api/v1/outreach", "POST", {
        workspaceId: WS,
        personId: "audit-send",
        body: "hey — 15 minutes?",
      })
    );
    const { draft } = (await queued.json()) as { draft: { id: string } };
    const approved = await postOutreachApprove(
      asAdmin("http://localhost:3000/api/v1/outreach/approve", "POST", {
        workspaceId: WS,
        id: draft.id,
      })
    );
    expect(approved.status).toBe(200);
    process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
    await saveSourceConfig(WS, "resend", {
      apiKey: "re_audit",
      from: "founder@example.com",
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("{}", { status: 200 })) as typeof fetch;
    try {
      const res = await postOutreachSend(
        asAdmin("http://localhost:3000/api/v1/outreach/send", "POST", {
          workspaceId: WS,
          id: draft.id,
        })
      );
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = previousFetch;
    }
    return { actor: AUDIT_ACTOR_ENV, subject: draft.id };
  },
  [AUDIT_ACTIONS.outreachOutcome]: async () => {
    const queued = await postOutreach(
      asAdmin("http://localhost:3000/api/v1/outreach", "POST", {
        workspaceId: WS,
        personId: "audit-outcome",
        body: "hey — 15 minutes?",
      })
    );
    expect(queued.status).toBe(201);
    const { draft } = (await queued.json()) as { draft: { id: string } };
    const res = await postOutreachOutcome(
      asAdmin("http://localhost:3000/api/v1/outreach/outcome", "POST", {
        workspaceId: WS,
        id: draft.id,
        outcome: "converted",
      })
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_ENV, subject: draft.id };
  },
  [AUDIT_ACTIONS.usersDelete]: async () => {
    await db.insert(schema.users).values({
      personId: "audit-delete",
      name: "Ada",
      workspaceId: WS,
    });
    const res = await deleteUser(
      asAdmin(
        `http://localhost:3000/api/v1/users/audit-delete?workspace=${WS}`,
        "DELETE"
      ),
      { params: Promise.resolve({ id: "audit-delete" }) }
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_ENV, subject: "audit-delete" };
  },
  [AUDIT_ACTIONS.workspaceCreate]: async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
    const res = await createWorkspaceRoute(
      asAdmin("http://localhost:3000/api/v1/workspaces", "POST", {
        id: WS,
        name: "Audit log",
      })
    );
    expect(res.status).toBe(201);
    return { actor: AUDIT_ACTOR_ENV, subject: WS };
  },
  [AUDIT_ACTIONS.workspaceArchive]: async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
    const created = await createWorkspaceRoute(
      asAdmin("http://localhost:3000/api/v1/workspaces", "POST", {
        id: WS,
        name: "Audit log",
      })
    );
    expect(created.status).toBe(201);
    await db.delete(schema.auditLog).where(eq(schema.auditLog.workspaceId, WS));
    const res = await archiveWorkspaceRoute(
      asAdmin("http://localhost:3000/api/v1/workspaces", "PATCH", { id: WS })
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_ENV, subject: WS };
  },
  [AUDIT_ACTIONS.configSave]: async () => {
    const res = await patchConfig(
      asAdmin("http://localhost:3000/api/v1/config", "PATCH", {
        workspaceId: WS,
        companyName: "AuditCo",
      })
    );
    expect(res.status).toBe(200);
    return { actor: AUDIT_ACTOR_ENV, subject: "company_profile" };
  },
};

describe("GET /api/v1/audit", () => {
  it("answers what an agent did yesterday in one query", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const minted = await createKey(
      asAdmin("http://localhost:3000/api/v1/keys", "POST", {
        name: "yesterday-agent",
        scope: "write",
        workspace: WS,
      })
    );
    expect(minted.status).toBe(201);
    const { id, key } = (await minted.json()) as { id: string; key: string };

    const today = await postEvent(
      new NextRequest("http://localhost:3000/api/ingest/event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          userId: "agent-today",
          eventName: "song_played",
          workspaceId: WS,
        }),
      })
    );
    expect(today.status).toBe(200);

    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);
    await recordAudit({
      workspaceId: WS,
      actor: id,
      action: AUDIT_ACTIONS.ingestIdentify,
      subject: "person_agent-yesterday",
      at: yesterday,
    });

    const windowStart = new Date(yesterday.getTime() - 60 * 60 * 1000);
    const windowEnd = new Date(yesterday.getTime() + 60 * 60 * 1000);
    const listed = await queryAudit({
      workspace: WS,
      actor: id,
      since: windowStart.toISOString(),
      until: windowEnd.toISOString(),
    });

    expect(listed.total).toBe(1);
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]).toMatchObject({
      actor: id,
      action: AUDIT_ACTIONS.ingestIdentify,
      subject: "person_agent-yesterday",
      workspaceId: WS,
    });
  });

  it("does not record a CSV preview or a read MCP tool", async () => {
    const csv = readFileSync(
      resolve(root, "tests/fixtures/import/events.csv"),
      "utf8"
    );
    const preview = await postImport(
      asAdmin("http://localhost:3000/api/v1/import", "POST", {
        csv,
        kind: "events",
        workspaceId: WS,
        preview: true,
      })
    );
    expect(preview.status).toBe(200);

    const mcp = await postMcp(
      asAdmin("http://localhost:3000/api/mcp", "POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_overview", arguments: { workspace: WS } },
      })
    );
    expect(mcp.status).toBe(200);

    const listed = await queryAudit({ workspace: WS });
    expect(listed.entries.map((row) => row.action)).not.toContain(
      AUDIT_ACTIONS.importCsv
    );
    expect(listed.entries.map((row) => row.action)).not.toContain(
      AUDIT_ACTIONS.mcpCall
    );
  });
});

describe("every write route produces an audit row", () => {
  it("enumerates every write route", () => {
    expect(WRITE_HTTP_ROUTES.map((route) => route.action).sort()).toEqual(
      Object.keys(drivers).sort()
    );
  });

  it.each(WRITE_HTTP_ROUTES)(
    "$method $path records $action",
    async (route) => {
      const driver = drivers[route.action];
      const { actor, subject } = await driver();
      const listed = await queryAudit({
        workspace: WS,
        action: route.action,
      });
      expect(listed.total).toBeGreaterThanOrEqual(1);
      const row = listed.entries.find((entry) =>
        subject ? entry.subject === subject : true
      );
      expect(row).toMatchObject({
        actor,
        action: route.action,
        workspaceId: WS,
      });
      if (subject) expect(row?.subject).toBe(subject);
    }
  );

  it("every write route module records an audit row", () => {
    for (const rel of WRITE_ROUTE_MODULES) {
      const src = readFileSync(resolve(root, rel), "utf8");
      expect(
        src,
        `${rel} must call recordAudit / recordWriteAudit / recordWebhookAudit / recordMcpWriteAudit`
      ).toMatch(/record(Write|Webhook|McpWrite)?Audit/);
    }
  });
});
