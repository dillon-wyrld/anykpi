import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as createKey } from "@/app/api/v1/keys/route";
import { POST as queueOutreachRoute } from "@/app/api/v1/outreach/route";
import { POST as tagOutreachOutcome } from "@/app/api/v1/outreach/outcome/route";
import { GET as getPmf } from "@/app/api/views/pmf/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { AUDIT_ACTIONS } from "@/core/audit";
import { queueOutreach } from "@/outreach";
import {
  UNCLUSTERED_LABEL,
  getOutreachOutcome,
  listOutreachOutcomes,
  loadOutreachConversion,
  outcomeAtLeast,
  outreachConversionByCluster,
  outreachOutcomeConfigKey,
  parseOutreachOutcome,
  parseStoredOutreachOutcome,
  resolveOutreachCluster,
  setOutreachOutcome,
} from "./outreach-outcomes";

const ADMIN = "outcome-admin-key";
const WS = "outcome-ws";

const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.config).where(eq(schema.config.workspaceId, WS));
  await db.delete(schema.outreach).where(eq(schema.outreach.workspaceId, WS));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, WS));
});

function asBearer(url: string, key: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedPerson(personId: string, cluster: string | null, name = personId) {
  await db.insert(schema.users).values({
    personId,
    name,
    workspaceId: WS,
    cluster,
  });
}

describe("ANY-27 does not take a drizzle migration", () => {
  it("keeps outcomes in config, not a dedicated table", () => {
    const root = resolve(__dirname, "../..");
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8")
    ) as { entries: Array<{ tag: string }> };
    expect(journal.entries.some((entry) => entry.tag === "0007_outreach")).toBe(true);
    expect(journal.entries.some((entry) => /outcome/i.test(entry.tag))).toBe(false);
    const schema = readFileSync(resolve(root, "src/core/schema.ts"), "utf8");
    expect(schema).not.toMatch(/outcome/);
  });
});

describe("outreach outcome parse + rollup", () => {
  it("accepts only replied / interviewed / converted", () => {
    expect(parseOutreachOutcome("replied")).toBe("replied");
    expect(parseOutreachOutcome("interviewed")).toBe("interviewed");
    expect(parseOutreachOutcome("converted")).toBe("converted");
    expect(parseOutreachOutcome("sent")).toBeNull();
    expect(parseOutreachOutcome("")).toBeNull();
    expect(parseStoredOutreachOutcome('{"outcome":"converted"}')).toBe("converted");
    expect(parseStoredOutreachOutcome("converted")).toBe("converted");
  });

  it("treats converted as at least replied and interviewed", () => {
    expect(outcomeAtLeast("converted", "replied")).toBe(true);
    expect(outcomeAtLeast("converted", "interviewed")).toBe(true);
    expect(outcomeAtLeast("interviewed", "replied")).toBe(true);
    expect(outcomeAtLeast("replied", "converted")).toBe(false);
    expect(outcomeAtLeast(null, "replied")).toBe(false);
  });

  it("resolves cluster by person id, then by name", () => {
    const people = [
      { personId: "p1", name: "Dave", cluster: "🔥 Power daily" },
      { personId: "p2", name: "Mia", cluster: "🌴 Weekenders" },
    ];
    expect(resolveOutreachCluster("p1", people)).toBe("🔥 Power daily");
    expect(resolveOutreachCluster("dave", people)).toBe("🔥 Power daily");
    expect(resolveOutreachCluster("unknown", people)).toBe(UNCLUSTERED_LABEL);
  });

  it("rolls conversion by cluster so research quality is measurable", () => {
    const rows = outreachConversionByCluster([
      { cluster: "🔥 Power daily", sent: true, outcome: "converted" },
      { cluster: "🔥 Power daily", sent: true, outcome: "replied" },
      { cluster: "🌴 Weekenders", sent: true, outcome: null },
      { cluster: "🌴 Weekenders", sent: false, outcome: "interviewed" },
    ]);
    expect(rows).toEqual([
      {
        cluster: "🔥 Power daily",
        outreach: 2,
        sent: 2,
        replied: 2,
        interviewed: 1,
        converted: 1,
        conversionRate: 0.5,
      },
      {
        cluster: "🌴 Weekenders",
        outreach: 2,
        sent: 1,
        replied: 1,
        interviewed: 1,
        converted: 0,
        conversionRate: 0,
      },
    ]);
  });
});

describe("config-backed outcome store", () => {
  it("writes the tag on the existing config unique (workspace, key)", async () => {
    const draft = await queueOutreach({
      workspaceId: WS,
      personId: "dave",
      body: "hey Dave — 15 minutes?",
      actor: "test",
    });
    await seedPerson("p1", "🔥 Power daily", "Dave");

    expect(outreachOutcomeConfigKey(WS, draft.id)).toBe(
      `outreach.outcome:${WS}:${draft.id}`
    );

    await setOutreachOutcome({
      workspaceId: WS,
      id: draft.id,
      outcome: "converted",
      actor: "test",
    });

    expect(await getOutreachOutcome(WS, draft.id)).toBe("converted");
    expect((await listOutreachOutcomes(WS)).get(draft.id)).toBe("converted");

    const [row] = await db
      .select()
      .from(schema.config)
      .where(eq(schema.config.key, outreachOutcomeConfigKey(WS, draft.id)))
      .all();
    expect(row).toMatchObject({
      value: "converted",
      workspaceId: WS,
    });

    const conversion = await loadOutreachConversion(WS);
    expect(conversion).toEqual([
      {
        cluster: "🔥 Power daily",
        outreach: 1,
        sent: 0,
        replied: 1,
        interviewed: 1,
        converted: 1,
        conversionRate: 0,
      },
    ]);

    await setOutreachOutcome({
      workspaceId: WS,
      id: draft.id,
      outcome: null,
      actor: "test",
    });
    expect(await getOutreachOutcome(WS, draft.id)).toBeNull();
  });

  it("refuses a missing draft", async () => {
    await expect(
      setOutreachOutcome({
        workspaceId: WS,
        id: "ou_missing",
        outcome: "replied",
        actor: "test",
      })
    ).rejects.toThrow(/not found/i);
  });
});

describe("POST /api/v1/outreach/outcome", () => {
  it("tags from the API and feeds PMF+ conversion by cluster", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    await seedPerson("p1", "🔥 Power daily", "Dave");

    const queued = await queueOutreachRoute(
      asBearer("http://localhost:3000/api/v1/outreach", ADMIN, {
        workspaceId: WS,
        personId: "dave",
        body: "hey Dave — 15 minutes?",
      })
    );
    expect(queued.status).toBe(201);
    const { draft } = (await queued.json()) as { draft: { id: string } };

    const tagged = await tagOutreachOutcome(
      asBearer("http://localhost:3000/api/v1/outreach/outcome", ADMIN, {
        workspaceId: WS,
        id: draft.id,
        outcome: "converted",
      })
    );
    expect(tagged.status).toBe(200);
    const body = (await tagged.json()) as {
      draft: { id: string; outcome: string | null };
      conversion: Array<{ cluster: string; converted: number }>;
    };
    expect(body.draft.outcome).toBe("converted");
    expect(body.conversion).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cluster: "🔥 Power daily", converted: 1 }),
      ])
    );

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, WS))
      .all();
    expect(audit.map((row) => row.action)).toContain(AUDIT_ACTIONS.outreachOutcome);

    const pmf = await getPmf(
      asBearer(`http://localhost:3000/api/views/pmf?workspace=${encodeURIComponent(WS)}`, ADMIN)
    );
    expect(pmf.status).toBe(200);
    const view = (await pmf.json()) as {
      conversion: Array<{ cluster: string; converted: number }>;
    };
    expect(view.conversion).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cluster: "🔥 Power daily", converted: 1 }),
      ])
    );
  });

  it("rejects a read-scoped key", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    const minted = await createKey(
      asBearer("http://localhost:3000/api/v1/keys", ADMIN, {
        name: "outcome-read",
        scope: "read",
        workspace: WS,
      })
    );
    expect(minted.status).toBe(201);
    const { key } = (await minted.json()) as { key: string };

    const draft = await queueOutreach({
      workspaceId: WS,
      personId: "dave",
      body: "hey",
      actor: "test",
    });

    const response = await tagOutreachOutcome(
      asBearer("http://localhost:3000/api/v1/outreach/outcome", key, {
        workspaceId: WS,
        id: draft.id,
        outcome: "replied",
      })
    );
    expect(response.status).toBe(403);
    expect(await getOutreachOutcome(WS, draft.id)).toBeNull();
  });
});
