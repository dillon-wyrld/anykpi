/**
 * Semantic user clustering from activity shape.
 *
 * Hypothesis (verified): `users.cluster` already exists — no schema
 * migration. The dot plot groups on that field; PMF+ does not consume it
 * yet. Connectors and identify leave `cluster` null. This module fills
 * that column with plain-language archetype labels so those views pick
 * them up without new chrome.
 *
 * Default is local heuristics (architecture: "v1 ships heuristic clusters
 * over activity shape"). Zero network calls unless an operator opts in
 * with both ANYKPI_CLUSTER_MODEL_KEY and ANYKPI_CLUSTER_MODEL_URL.
 */

import { and, eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./schema";

export const DEFAULT_CLUSTER_SEED = 22;

export type ClusterId =
  | "daily"
  | "weekday"
  | "weekender"
  | "casual"
  | "monthly"
  | "burst"
  | "churned"
  | "newbie";

/** Prototype swimlane names — same strings the demo seed and API already use. */
export const CLUSTER_LABELS: Record<ClusterId, string> = {
  daily: "🔥 Power daily",
  weekday: "💼 Weekday workers",
  weekender: "🌴 Weekenders",
  casual: "🌙 Occasional",
  monthly: "🗓️ Monthly check-ins",
  burst: "⚡ Bursty",
  churned: "🫥 Fading away",
  newbie: "🐣 Brand new",
};

export type PersonInput = {
  personId: string;
  signupDate: Date | null;
};

export type ActivityPoint = {
  personId: string;
  timestamp: Date;
};

export type ClusterAssignment = {
  personId: string;
  clusterId: ClusterId;
  cluster: string;
};

export type ClusterOptions = {
  seed?: number;
  asOf?: Date;
  /** Operator BYO key. Ignored unless a model URL is also set. */
  modelKey?: string;
  /** Operator BYO chat-completions-compatible URL. */
  modelUrl?: string;
};

export type ActivityProfile = {
  personId: string;
  tenureDays: number;
  activeDays: number;
  weekdayActive: number;
  weekendActive: number;
  weekdayRate: number;
  weekendRate: number;
  overallRate: number;
  lastSeenDays: number;
  burstiness: number;
  monthlyness: number;
  eventsPerActiveDay: number;
};

const DAY_MS = 86_400_000;
const CLUSTER_IDS = Object.keys(CLUSTER_LABELS) as ClusterId[];

type FeatureKey =
  | "weekdayRate"
  | "weekendRate"
  | "overallRate"
  | "recency"
  | "burstiness"
  | "monthlyness"
  | "tenure";

const PROTOTYPES: Record<ClusterId, Record<FeatureKey, number>> = {
  daily: {
    weekdayRate: 0.85,
    weekendRate: 0.65,
    overallRate: 0.75,
    recency: 0.02,
    burstiness: 0.15,
    monthlyness: 0.05,
    tenure: 0.8,
  },
  weekday: {
    weekdayRate: 0.7,
    weekendRate: 0.06,
    overallRate: 0.5,
    recency: 0.05,
    burstiness: 0.2,
    monthlyness: 0.05,
    tenure: 0.8,
  },
  weekender: {
    weekdayRate: 0.06,
    weekendRate: 0.85,
    overallRate: 0.3,
    recency: 0.08,
    burstiness: 0.2,
    monthlyness: 0.05,
    tenure: 0.8,
  },
  casual: {
    weekdayRate: 0.22,
    weekendRate: 0.22,
    overallRate: 0.22,
    recency: 0.15,
    burstiness: 0.25,
    monthlyness: 0.1,
    tenure: 0.7,
  },
  monthly: {
    weekdayRate: 0.08,
    weekendRate: 0.08,
    overallRate: 0.06,
    recency: 0.2,
    burstiness: 0.2,
    monthlyness: 0.9,
    tenure: 0.8,
  },
  burst: {
    weekdayRate: 0.45,
    weekendRate: 0.45,
    overallRate: 0.25,
    recency: 0.1,
    burstiness: 0.9,
    monthlyness: 0.1,
    tenure: 0.8,
  },
  churned: {
    weekdayRate: 0.2,
    weekendRate: 0.15,
    overallRate: 0.1,
    recency: 0.85,
    burstiness: 0.3,
    monthlyness: 0.1,
    tenure: 0.8,
  },
  newbie: {
    weekdayRate: 0.4,
    weekendRate: 0.35,
    overallRate: 0.4,
    recency: 0.1,
    burstiness: 0.2,
    monthlyness: 0.05,
    tenure: 0.05,
  },
};

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(personId: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < personId.length; i++) {
    h = Math.imul(h ^ personId.charCodeAt(i), 0x9e3779b1);
  }
  return h >>> 0;
}

function utcDay(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      DAY_MS
  );
}

function isWeekendDay(dayNumber: number): boolean {
  const date = new Date(dayNumber * DAY_MS);
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function buildActivityProfile(
  person: PersonInput,
  events: ActivityPoint[],
  asOf: Date
): ActivityProfile {
  const asOfDay = utcDay(asOf);
  const eventDays: number[] = [];
  const seen = new Set<number>();
  let eventCount = 0;

  for (const event of events) {
    if (event.personId !== person.personId) continue;
    const day = utcDay(event.timestamp);
    if (day > asOfDay) continue;
    eventCount += 1;
    if (!seen.has(day)) {
      seen.add(day);
      eventDays.push(day);
    }
  }
  eventDays.sort((a, b) => a - b);

  const firstEvent = eventDays[0] ?? null;
  const signupDay = person.signupDate ? utcDay(person.signupDate) : null;
  const startDay =
    signupDay != null
      ? Math.min(signupDay, asOfDay)
      : firstEvent != null
        ? firstEvent
        : asOfDay;

  const tenureDays = Math.max(1, asOfDay - startDay + 1);
  let weekdaySlots = 0;
  let weekendSlots = 0;
  for (let d = startDay; d <= asOfDay; d++) {
    if (isWeekendDay(d)) weekendSlots += 1;
    else weekdaySlots += 1;
  }

  let weekdayActive = 0;
  let weekendActive = 0;
  for (const day of eventDays) {
    if (day < startDay) continue;
    if (isWeekendDay(day)) weekendActive += 1;
    else weekdayActive += 1;
  }

  const activeDays = weekdayActive + weekendActive;
  const lastActive = eventDays.length > 0 ? eventDays[eventDays.length - 1]! : startDay;
  const lastSeenDays = activeDays === 0 ? tenureDays : Math.max(0, asOfDay - lastActive);

  const gaps: number[] = [];
  for (let i = 1; i < eventDays.length; i++) {
    gaps.push(eventDays[i]! - eventDays[i - 1]!);
  }

  let burstiness = 0;
  if (gaps.length >= 2) {
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const variance =
      gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    burstiness = clamp01(cv / 2);
    const maxGap = Math.max(...gaps);
    let densest = 0;
    for (const day of eventDays) {
      const inWindow = eventDays.filter((d) => d >= day && d < day + 7).length;
      if (inWindow > densest) densest = inWindow;
    }
    if (maxGap >= 10 && densest >= 4) {
      burstiness = Math.max(burstiness, 0.75);
    }
  }

  let monthlyness = 0;
  if (activeDays >= 2 && tenureDays >= 40) {
    const med = median(gaps.length > 0 ? gaps : [tenureDays]);
    const nearMonthly = 1 - clamp01(Math.abs(med - 30) / 18);
    const sparse = activeDays / tenureDays < 0.15;
    monthlyness = sparse ? nearMonthly : nearMonthly * 0.25;
  }

  return {
    personId: person.personId,
    tenureDays,
    activeDays,
    weekdayActive,
    weekendActive,
    weekdayRate: weekdayActive / Math.max(1, weekdaySlots),
    weekendRate: weekendActive / Math.max(1, weekendSlots),
    overallRate: activeDays / tenureDays,
    lastSeenDays,
    burstiness,
    monthlyness,
    eventsPerActiveDay: activeDays > 0 ? eventCount / activeDays : 0,
  };
}

function featuresOf(profile: ActivityProfile): Record<FeatureKey, number> {
  return {
    weekdayRate: clamp01(profile.weekdayRate),
    weekendRate: clamp01(profile.weekendRate),
    overallRate: clamp01(profile.overallRate),
    recency: clamp01(profile.lastSeenDays / Math.max(14, profile.tenureDays * 0.5)),
    burstiness: clamp01(profile.burstiness),
    monthlyness: clamp01(profile.monthlyness),
    tenure: clamp01(profile.tenureDays / 60),
  };
}

function distance(
  a: Record<FeatureKey, number>,
  b: Record<FeatureKey, number>
): number {
  let sum = 0;
  for (const key of Object.keys(a) as FeatureKey[]) {
    const d = a[key] - b[key];
    sum += d * d;
  }
  return sum;
}

export function assignArchetype(
  profile: ActivityProfile,
  seed: number = DEFAULT_CLUSTER_SEED
): ClusterId {
  if (profile.tenureDays <= 14) return "newbie";

  const weekendShare =
    profile.activeDays > 0 ? profile.weekendActive / profile.activeDays : 0;
  const weekdayShare =
    profile.activeDays > 0 ? profile.weekdayActive / profile.activeDays : 0;

  if (
    profile.monthlyness >= 0.65 &&
    profile.overallRate < 0.15 &&
    profile.activeDays >= 2
  ) {
    return "monthly";
  }

  if (profile.lastSeenDays >= 21 && profile.monthlyness < 0.5) {
    return "churned";
  }

  if (profile.activeDays === 0) {
    return "churned";
  }

  if (
    weekendShare >= 0.7 &&
    profile.weekendRate >= 0.3 &&
    profile.weekdayRate < 0.2
  ) {
    return "weekender";
  }

  if (
    weekdayShare >= 0.8 &&
    profile.weekdayRate >= 0.28 &&
    profile.weekendRate < 0.15
  ) {
    return "weekday";
  }

  if (
    profile.overallRate >= 0.55 &&
    profile.weekdayRate >= 0.45 &&
    profile.weekendRate >= 0.3
  ) {
    return "daily";
  }

  if (
    profile.burstiness >= 0.7 &&
    profile.overallRate >= 0.08 &&
    profile.overallRate < 0.55
  ) {
    return "burst";
  }

  if (profile.overallRate < 0.08 && profile.lastSeenDays >= 14) {
    return "churned";
  }

  const feats = featuresOf(profile);
  const rng = mulberry32(hashSeed(profile.personId, seed));
  let best: ClusterId = "casual";
  let bestScore = Infinity;

  for (const id of CLUSTER_IDS) {
    const jitter = (rng() - 0.5) * 1e-9;
    const score = distance(feats, PROTOTYPES[id]) + jitter;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }

  return best;
}

/**
 * Assign plain-language cluster labels. Pure and local — never calls fetch.
 */
export function clusterPeople(
  people: PersonInput[],
  activity: ActivityPoint[],
  options: ClusterOptions = {}
): ClusterAssignment[] {
  const seed = options.seed ?? DEFAULT_CLUSTER_SEED;
  const asOf = options.asOf ?? new Date();
  const byPerson = new Map<string, ActivityPoint[]>();

  for (const event of activity) {
    const list = byPerson.get(event.personId);
    if (list) list.push(event);
    else byPerson.set(event.personId, [event]);
  }

  return [...people]
    .sort((a, b) => (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0))
    .map((person) => {
      const profile = buildActivityProfile(
        person,
        byPerson.get(person.personId) ?? [],
        asOf
      );
      const clusterId = assignArchetype(profile, seed);
      return {
        personId: person.personId,
        clusterId,
        cluster: CLUSTER_LABELS[clusterId],
      };
    });
}

export type RemoteClusterConfig = {
  modelKey: string;
  modelUrl: string;
};

/** Both key and URL are required before anything leaves the machine. */
export function resolveRemoteClusterConfig(
  options: ClusterOptions = {},
  env: NodeJS.ProcessEnv = process.env
): RemoteClusterConfig | null {
  const modelKey = options.modelKey ?? env.ANYKPI_CLUSTER_MODEL_KEY;
  const modelUrl = options.modelUrl ?? env.ANYKPI_CLUSTER_MODEL_URL;
  if (!modelKey || !modelUrl) return null;
  return { modelKey, modelUrl };
}

type LabelMap = Partial<Record<ClusterId, string>>;

/**
 * Optional BYO-model rename of the 8 archetype labels.
 * Sends only cluster-level feature means — no person ids, names, or emails.
 */
export async function refineClusterLabels(
  assignments: ClusterAssignment[],
  people: PersonInput[],
  activity: ActivityPoint[],
  remote: RemoteClusterConfig,
  options: ClusterOptions = {}
): Promise<ClusterAssignment[]> {
  const asOf = options.asOf ?? new Date();
  const seed = options.seed ?? DEFAULT_CLUSTER_SEED;
  const byId = new Map(people.map((p) => [p.personId, p]));

  const groups = new Map<
    ClusterId,
    { count: number; features: Record<FeatureKey, number> }
  >();

  for (const assignment of assignments) {
    const person = byId.get(assignment.personId);
    if (!person) continue;
    const profile = buildActivityProfile(person, activity, asOf);
    const feats = featuresOf(profile);
    const existing = groups.get(assignment.clusterId);
    if (!existing) {
      groups.set(assignment.clusterId, { count: 1, features: { ...feats } });
    } else {
      existing.count += 1;
      for (const key of Object.keys(feats) as FeatureKey[]) {
        existing.features[key] += feats[key];
      }
    }
  }

  const clusters = [...groups.entries()].map(([id, g]) => ({
    id,
    label: CLUSTER_LABELS[id],
    count: g.count,
    features: Object.fromEntries(
      (Object.keys(g.features) as FeatureKey[]).map((k) => [
        k,
        g.features[k] / g.count,
      ])
    ),
  }));

  const response = await fetch(remote.modelUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${remote.modelKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      seed,
      clusters,
    }),
  });

  if (!response.ok) return assignments;

  const payload = (await response.json()) as { labels?: LabelMap };
  const labels = payload.labels;
  if (!labels) return assignments;

  return assignments.map((a) => {
    const next = labels[a.clusterId];
    if (typeof next === "string" && next.trim().length > 0) {
      return { ...a, cluster: next.trim() };
    }
    return a;
  });
}

export async function clusterPeopleAsync(
  people: PersonInput[],
  activity: ActivityPoint[],
  options: ClusterOptions = {}
): Promise<ClusterAssignment[]> {
  const local = clusterPeople(people, activity, options);
  const remote = resolveRemoteClusterConfig(options);
  if (!remote) return local;
  return refineClusterLabels(local, people, activity, remote, options);
}

async function writeAssignments(
  workspaceId: string,
  assignments: ClusterAssignment[]
): Promise<void> {
  for (const assignment of assignments) {
    await db
      .update(schema.users)
      .set({ cluster: assignment.cluster })
      .where(
        and(
          eq(schema.users.personId, assignment.personId),
          eq(schema.users.workspaceId, workspaceId)
        )
      );
  }
}

function toPerson(user: { personId: string; signupDate: Date | null }): PersonInput {
  return { personId: user.personId, signupDate: user.signupDate };
}

function toEvent(row: { personId: string; timestamp: Date }): ActivityPoint {
  return { personId: row.personId, timestamp: row.timestamp };
}

/**
 * Recompute every user's cluster in a workspace and persist to `users.cluster`.
 */
export async function refreshWorkspaceClusters(
  workspaceId: string,
  options: ClusterOptions = {}
): Promise<ClusterAssignment[]> {
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspaceId))
    .all();

  if (users.length === 0) return [];

  const activity = await db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspaceId))
    .all();

  const assignments = await clusterPeopleAsync(
    users.map(toPerson),
    activity.map(toEvent),
    options
  );
  await writeAssignments(workspaceId, assignments);
  return assignments;
}

/**
 * Fill missing `users.cluster` values only — does not overwrite labels
 * already on the read model (demo seed, fixtures, prior refresh).
 */
export async function ensureWorkspaceClusters(
  workspaceId: string,
  options: ClusterOptions = {}
): Promise<ClusterAssignment[]> {
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspaceId))
    .all();

  const pending = users.filter((u) => !u.cluster);
  if (pending.length === 0) return [];

  const activity = await db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspaceId))
    .all();

  const assignments = await clusterPeopleAsync(
    pending.map(toPerson),
    activity.map(toEvent),
    options
  );
  await writeAssignments(workspaceId, assignments);
  return assignments;
}
