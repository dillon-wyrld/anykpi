import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./schema";
import {
  CLUSTER_LABELS,
  DEFAULT_CLUSTER_SEED,
  clusterPeople,
  clusterPeopleAsync,
  ensureWorkspaceClusters,
  refreshWorkspaceClusters,
  resolveRemoteClusterConfig,
  type ActivityPoint,
  type PersonInput,
} from "./clustering";

const AS_OF = new Date("2026-08-16T12:00:00.000Z"); // Sunday
const WS = "cluster-test";
const DAY_MS = 86_400_000;

function daysAgo(n: number): Date {
  return new Date(AS_OF.getTime() - n * DAY_MS);
}

function eventsOn(personId: string, offsets: number[]): ActivityPoint[] {
  return offsets.map((n) => ({
    personId,
    timestamp: daysAgo(n),
  }));
}

function weekdayOffsets(tenure: number): number[] {
  const out: number[] = [];
  for (let n = 0; n < tenure; n++) {
    const dow = daysAgo(n).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(n);
  }
  return out;
}

function weekendOffsets(tenure: number): number[] {
  const out: number[] = [];
  for (let n = 0; n < tenure; n++) {
    const dow = daysAgo(n).getUTCDay();
    if (dow === 0 || dow === 6) out.push(n);
  }
  return out;
}

function everyDay(tenure: number): number[] {
  return Array.from({ length: tenure }, (_, n) => n);
}

/** Canonical 8-archetype fixture — one person per cluster. */
function canonFixture(): { people: PersonInput[]; activity: ActivityPoint[] } {
  const people: PersonInput[] = [
    { personId: "u-daily", signupDate: daysAgo(45) },
    { personId: "u-weekday", signupDate: daysAgo(45) },
    { personId: "u-weekender", signupDate: daysAgo(45) },
    { personId: "u-casual", signupDate: daysAgo(45) },
    { personId: "u-monthly", signupDate: daysAgo(90) },
    { personId: "u-burst", signupDate: daysAgo(60) },
    { personId: "u-churned", signupDate: daysAgo(60) },
    { personId: "u-newbie", signupDate: daysAgo(6) },
  ];

  const burst: number[] = [];
  for (let n = 0; n < 60; n++) {
    const phase = n % 20;
    if (phase < 5) burst.push(n);
  }

  const casual = [0, 3, 9, 14, 20, 27, 33, 38];

  const activity: ActivityPoint[] = [
    ...eventsOn("u-daily", everyDay(45)),
    ...eventsOn("u-weekday", weekdayOffsets(45)),
    ...eventsOn("u-weekender", weekendOffsets(45)),
    ...eventsOn("u-casual", casual),
    ...eventsOn("u-monthly", [0, 30, 60, 90]),
    ...eventsOn("u-burst", burst),
    ...eventsOn("u-churned", [45, 46, 47, 50, 52]),
    ...eventsOn("u-newbie", [0, 2, 4]),
  ];

  return { people, activity };
}

function labelsById(
  people: PersonInput[],
  activity: ActivityPoint[],
  seed = DEFAULT_CLUSTER_SEED
) {
  const assignments = clusterPeople(people, activity, { seed, asOf: AS_OF });
  return Object.fromEntries(assignments.map((a) => [a.personId, a.cluster]));
}

afterEach(async () => {
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("clusterPeople (seeded heuristics)", () => {
  it("assigns the canon fixture to the eight prototype names", () => {
    const { people, activity } = canonFixture();
    const byId = labelsById(people, activity);

    expect(byId["u-daily"]).toBe(CLUSTER_LABELS.daily);
    expect(byId["u-weekday"]).toBe(CLUSTER_LABELS.weekday);
    expect(byId["u-weekender"]).toBe(CLUSTER_LABELS.weekender);
    expect(byId["u-casual"]).toBe(CLUSTER_LABELS.casual);
    expect(byId["u-monthly"]).toBe(CLUSTER_LABELS.monthly);
    expect(byId["u-burst"]).toBe(CLUSTER_LABELS.burst);
    expect(byId["u-churned"]).toBe(CLUSTER_LABELS.churned);
    expect(byId["u-newbie"]).toBe(CLUSTER_LABELS.newbie);
  });

  it("is stable across runs and matches the snapshot", () => {
    const { people, activity } = canonFixture();
    const first = labelsById(people, activity);
    const second = labelsById(people, activity);
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });

  it("uses the same labels when the seed is unchanged", () => {
    const { people, activity } = canonFixture();
    expect(labelsById(people, activity, 22)).toEqual(
      labelsById(people, activity, 22)
    );
  });
});

describe("default mode makes zero network calls", () => {
  it("stubs fetch and fails on any egress", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("egress: default clustering must not call fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { people, activity } = canonFixture();

    clusterPeople(people, activity, { asOf: AS_OF });
    await clusterPeopleAsync(people, activity, { asOf: AS_OF });

    expect(resolveRemoteClusterConfig({})).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ensureWorkspaceClusters does not call fetch when filling nulls", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("egress: default clustering must not call fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    await db.insert(schema.users).values({
      personId: "u-live",
      name: "Live user",
      signupDate: daysAgo(45),
      cluster: null,
      workspaceId: WS,
    });
    await db.insert(schema.activity).values({
      personId: "u-live",
      timestamp: daysAgo(1),
      eventName: "core",
      eventClass: "core",
      workspaceId: WS,
    });

    const assigned = await ensureWorkspaceClusters(WS, { asOf: AS_OF });
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.cluster).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    const row = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.personId, "u-live"))
      .get();
    expect(row?.cluster).toBe(assigned[0]?.cluster);
  });
});

describe("persist / read-model wiring", () => {
  it("refreshWorkspaceClusters writes labels onto users.cluster", async () => {
    const { people, activity } = canonFixture();
    for (const person of people) {
      await db.insert(schema.users).values({
        personId: person.personId,
        name: person.personId,
        signupDate: person.signupDate,
        cluster: null,
        workspaceId: WS,
      });
    }
    for (const event of activity) {
      await db.insert(schema.activity).values({
        personId: event.personId,
        timestamp: event.timestamp,
        eventName: "core",
        eventClass: "core",
        workspaceId: WS,
      });
    }

    const assigned = await refreshWorkspaceClusters(WS, { asOf: AS_OF });
    expect(assigned).toHaveLength(people.length);

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workspaceId, WS))
      .all();

    const byId = Object.fromEntries(rows.map((r) => [r.personId, r.cluster]));
    expect(byId["u-weekender"]).toBe(CLUSTER_LABELS.weekender);
    expect(byId["u-daily"]).toBe(CLUSTER_LABELS.daily);
  });

  it("ensureWorkspaceClusters does not overwrite an existing label", async () => {
    await db.insert(schema.users).values({
      personId: "u-kept",
      name: "Kept",
      signupDate: daysAgo(45),
      cluster: "already-set",
      workspaceId: WS,
    });

    const assigned = await ensureWorkspaceClusters(WS, { asOf: AS_OF });
    expect(assigned).toHaveLength(0);

    const row = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.personId, "u-kept"))
      .get();
    expect(row?.cluster).toBe("already-set");
  });
});

describe("operator opt-in remote naming", () => {
  it("calls fetch only when both key and URL are set", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({ labels: { weekender: "weekend power listeners" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { people, activity } = canonFixture();
    const refined = await clusterPeopleAsync(people, activity, {
      asOf: AS_OF,
      modelKey: "sk-operator",
      modelUrl: "https://models.example.test/v1/cluster-names",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)
    ) as { clusters: { id: string }[] };
    expect(body.clusters.every((c) => !("personId" in c))).toBe(true);
    expect(refined.find((a) => a.clusterId === "weekender")?.cluster).toBe(
      "weekend power listeners"
    );
  });
});
