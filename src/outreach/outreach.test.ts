import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as createKey } from "@/app/api/v1/keys/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import { POST as approveOutreachRoute } from "@/app/api/v1/outreach/approve/route";
import { POST as sendOutreachRoute } from "@/app/api/v1/outreach/send/route";
import { POST as queueOutreachRoute } from "@/app/api/v1/outreach/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { saveSourceConfig } from "@/core/sources";
import { SESSION_COOKIE_NAME, signSession } from "@/core/session";
import { AUDIT_ACTIONS } from "@/core/audit";
import { AUDIT_ACTOR_SESSION } from "@/core/auth";
import {
  asApprovedOutreach,
  queueOutreach,
} from "./index";
import { deliverOutreach, listDeliveries } from "./deliver";
import {
  OUTREACH_NOT_APPROVED,
  OutreachNotApprovedError,
  WRITE_CANNOT_APPROVE_OUTREACH,
} from "./errors";

const ADMIN = "outreach-admin-key";
const WS = "outreach-ws";
const root = resolve(__dirname, "../..");

const originalKey = process.env.ANYKPI_API_KEY;
const originalSecret = process.env.ANYKPI_SECRET;
const originalFetch = globalThis.fetch;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.ANYKPI_SECRET;
  else process.env.ANYKPI_SECRET = originalSecret;
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  await db.delete(schema.outreachDelivery).where(eq(schema.outreachDelivery.workspaceId, WS));
  await db.delete(schema.outreach).where(eq(schema.outreach.workspaceId, WS));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, WS));
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, WS));
});

function asBearer(url: string, key: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
}

async function mintKey(scope: "read" | "write" | "admin") {
  process.env.ANYKPI_API_KEY = ADMIN;
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  vi.stubEnv("NODE_ENV", "test");
  const created = await createKey(
    asBearer("http://localhost:3000/api/v1/keys", ADMIN, {
      name: `outreach-${scope}`,
      scope,
      workspace: WS,
    })
  );
  expect(created.status).toBe(201);
  const body = (await created.json()) as { key: string; id: string };
  return body;
}

async function seedPerson(personId = "dave") {
  await db.insert(schema.users).values({
    personId,
    name: "Dave",
    email: "dave@example.com",
    workspaceId: WS,
  });
}

async function queueDraft(body = "hey Dave — 15 minutes?") {
  return queueOutreach({
    workspaceId: WS,
    personId: "dave",
    body,
    actor: "test",
  });
}

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walkTsFiles(full, acc);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

describe("mail transport has a single importer", () => {
  it("only deliver.ts imports the transport module", () => {
    const files = walkTsFiles(resolve(root, "src"));
    const importers = files.filter((file) => {
      if (file.endsWith("/outreach/transport.ts")) return false;
      const src = readFileSync(file, "utf8");
      return (
        /from\s+["']@\/outreach\/transport["']/.test(src) ||
        /from\s+["']\.\/transport["']/.test(src)
      );
    });
    expect(importers.map((file) => file.slice(root.length + 1))).toEqual([
      "src/outreach/deliver.ts",
    ]);
  });
});

describe("deliverOutreach refuses unapproved drafts", () => {
  it("refuses a waiting draft via a direct function call", async () => {
    await seedPerson();
    const draft = await queueDraft();
    expect(asApprovedOutreach(draft)).toBeNull();

    await expect(deliverOutreach(draft)).rejects.toBeInstanceOf(
      OutreachNotApprovedError
    );
    await expect(deliverOutreach(draft)).rejects.toThrow(OUTREACH_NOT_APPROVED);

    const deliveries = await listDeliveries(WS);
    expect(deliveries).toHaveLength(0);
    const reloaded = await db
      .select()
      .from(schema.outreach)
      .where(eq(schema.outreach.id, draft.id))
      .all();
    expect(reloaded[0]?.state).toBe("waiting");
  });

  it("refuses a fabricated approved object when the row is still waiting", async () => {
    await seedPerson();
    const draft = await queueDraft();
    const forged = {
      ...draft,
      state: "approved" as const,
      approvedBy: "forged",
      approvedAt: new Date(),
    };
    await expect(deliverOutreach(forged)).rejects.toBeInstanceOf(
      OutreachNotApprovedError
    );
  });
});

describe("outreach MCP", () => {
  it("refuses send_outreach on an unapproved draft", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    await seedPerson();
    const draft = await queueDraft();

    const write = await mintKey("write");
    const response = await postMcp(
      asBearer("http://localhost:3000/api/mcp", write.key, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "send_outreach",
          arguments: { workspace: WS, id: draft.id },
        },
      })
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe(OUTREACH_NOT_APPROVED);
  });

  it("refuses approve_outreach for a write-scoped key", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    await seedPerson();
    const draft = await queueDraft();
    const write = await mintKey("write");

    const response = await postMcp(
      asBearer("http://localhost:3000/api/mcp", write.key, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "approve_outreach",
          arguments: { workspace: WS, id: draft.id },
        },
      })
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe(WRITE_CANNOT_APPROVE_OUTREACH);

    const [row] = await db
      .select()
      .from(schema.outreach)
      .where(eq(schema.outreach.id, draft.id))
      .all();
    expect(row?.state).toBe("waiting");
    expect(row?.approvedBy).toBeNull();
  });
});

describe("write-scoped keys cannot approve via REST", () => {
  it("returns 403 and leaves the draft waiting", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    await seedPerson();
    const draft = await queueDraft();
    const write = await mintKey("write");

    const response = await approveOutreachRoute(
      asBearer("http://localhost:3000/api/v1/outreach/approve", write.key, {
        workspaceId: WS,
        id: draft.id,
      })
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe(WRITE_CANNOT_APPROVE_OUTREACH);
  });
});

describe("approved send is logged", () => {
  it("records timestamp, recipient, approving actor, and an audit row", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
    vi.stubEnv("NODE_ENV", "test");
    await seedPerson();
    const queued = await queueOutreachRoute(
      asBearer("http://localhost:3000/api/v1/outreach", ADMIN, {
        workspaceId: WS,
        personId: "dave",
        body: "hey Dave — 15 minutes?",
      })
    );
    expect(queued.status).toBe(201);
    const { draft } = (await queued.json()) as { draft: { id: string } };

    const cookie = `${SESSION_COOKIE_NAME}=${signSession({
      actor: "env",
      workspace: WS,
      canChooseWorkspace: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}`;
    const approved = await approveOutreachRoute(
      new NextRequest("http://localhost:3000/api/v1/outreach/approve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ workspaceId: WS, id: draft.id }),
      })
    );
    expect(approved.status).toBe(200);

    await saveSourceConfig(WS, "resend", {
      apiKey: "re_test",
      from: "founder@example.com",
    });
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch;

    const sent = await sendOutreachRoute(
      asBearer("http://localhost:3000/api/v1/outreach/send", ADMIN, {
        workspaceId: WS,
        id: draft.id,
      })
    );
    expect(sent.status).toBe(200);
    const payload = (await sent.json()) as {
      draft: { state: string };
      delivery: {
        recipient: string;
        approvedBy: string;
        sentAt: string;
      };
    };
    expect(payload.draft.state).toBe("sent");
    expect(payload.delivery.recipient).toBe("dave@example.com");
    expect(payload.delivery.approvedBy).toBe(AUDIT_ACTOR_SESSION);
    expect(Date.parse(payload.delivery.sentAt)).not.toBeNaN();

    const deliveries = await listDeliveries(WS);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      recipient: "dave@example.com",
      approvedBy: AUDIT_ACTOR_SESSION,
      outreachId: draft.id,
    });

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, WS))
      .all();
    expect(audit.map((row) => row.action)).toContain(AUDIT_ACTIONS.outreachSend);
    expect(
      audit.find((row) => row.action === AUDIT_ACTIONS.outreachSend)?.actor
    ).toBe(AUDIT_ACTOR_SESSION);
  });
});
