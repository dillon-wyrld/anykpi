/**
 * WBR builder — one write path for auto-proposed, human, and agent metrics.
 *
 * Status is computed by the exception engine. Write paths never store it.
 * Source spec and lifecycle live in config (`wbr_deck`) beside the
 * metric_defs row so a target edit cannot rewrite history.
 */

import { and, eq } from "drizzle-orm";
import {
  DefineMetricRequestSchema,
  type DefineMetricRequest,
  type MetricSource,
} from "@/core/contracts";
import { DEMO_WORKSPACE } from "@/core/auth";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { upsertConfig } from "@/core/upsert";
import { round2 } from "@/core/views/wbr-math";
import {
  WEEK_MS,
  buildRevenueLanes,
  type RevenueLane,
  type RevenueLaneSeries,
} from "@/core/views/revenue-math";
import { loadRevenueSeries } from "@/core/views/revenue";

export const WBR_DECK_CONFIG_KEY = "wbr_deck";

export const WBR_SECTIONS = [
  { id: "fin", n: "01", name: "Finance" },
  { id: "acq", n: "02", name: "Acquisition" },
  { id: "act", n: "03", name: "Activation" },
  { id: "eng", n: "04", name: "Engagement & retention" },
  { id: "qua", n: "05", name: "Quality & support" },
] as const;

export type WbrSectionId = (typeof WBR_SECTIONS)[number]["id"];

export type MetricLifecycle = "proposal" | "active" | "retired";

export type DeckSpec = {
  source: MetricSource;
  lifecycle: MetricLifecycle;
};

export type WbrDeckMeta = {
  version: 1;
  specs: Record<string, DeckSpec>;
  order: string[];
};

export type MetricPointInput = {
  timestamp: Date;
  value: number;
  grain: "week" | "month";
};

export type DefinedMetricRow = {
  metricId: string;
  name: string;
  section: string;
  sectionOrder: string;
  owner: string;
  type: "input" | "output";
  unit: string;
  target: number;
  goodDir: "up" | "down";
  source: MetricSource;
  lifecycle: MetricLifecycle;
  workspaceId: string;
};

export class WbrBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WbrBuilderError";
  }
}

const EMPTY_DECK: WbrDeckMeta = { version: 1, specs: {}, order: [] };

const STARTER_IDS = {
  signups: "wbr_signups",
  actives: "wbr_actives",
  retention: "wbr_retention",
} as const;

const REVENUE_STARTER: Array<{
  id: string;
  series: "mrr" | "new" | "churned" | "arpu" | "runway";
  name: string;
  type: "input" | "output";
  unit: string;
  goodDir: "up" | "down";
  owner: string;
  target: number;
}> = [
  { id: "rev_mrr", series: "mrr", name: "MRR", type: "output", unit: "$", goodDir: "up", owner: "💳", target: 600 },
  { id: "rev_new", series: "new", name: "New subscriptions", type: "input", unit: "", goodDir: "up", owner: "🌱", target: 10 },
  { id: "rev_churned", series: "churned", name: "Churned subscriptions", type: "input", unit: "", goodDir: "down", owner: "👻", target: 5 },
  { id: "rev_arpu", series: "arpu", name: "ARPU", type: "output", unit: "$", goodDir: "up", owner: "💰", target: 8 },
  { id: "rev_runway", series: "runway", name: "Runway", type: "output", unit: "", goodDir: "up", owner: "🛫", target: 5 },
];

export function sectionMeta(id: string) {
  return WBR_SECTIONS.find((s) => s.id === id) ?? WBR_SECTIONS[1];
}

export function metricIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "metric";
}

export function parseDeckMeta(raw: string | null | undefined): WbrDeckMeta {
  if (!raw) return { ...EMPTY_DECK, specs: {}, order: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<WbrDeckMeta>;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_DECK, specs: {}, order: [] };
    const specs: Record<string, DeckSpec> = {};
    if (parsed.specs && typeof parsed.specs === "object") {
      for (const [id, spec] of Object.entries(parsed.specs)) {
        if (!spec || typeof spec !== "object") continue;
        const source = spec.source;
        const lifecycle = spec.lifecycle;
        if (!source || typeof source !== "object") continue;
        if (lifecycle !== "proposal" && lifecycle !== "active" && lifecycle !== "retired") {
          continue;
        }
        specs[id] = { source: source as MetricSource, lifecycle };
      }
    }
    const order = Array.isArray(parsed.order)
      ? parsed.order.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    return { version: 1, specs, order };
  } catch {
    return { ...EMPTY_DECK, specs: {}, order: [] };
  }
}

export async function loadDeckMeta(workspace: string): Promise<WbrDeckMeta> {
  const [row] = await db
    .select()
    .from(schema.config)
    .where(
      and(
        eq(schema.config.workspaceId, workspace),
        eq(schema.config.key, WBR_DECK_CONFIG_KEY)
      )
    )
    .all();
  return parseDeckMeta(row?.value);
}

export async function saveDeckMeta(workspace: string, meta: WbrDeckMeta): Promise<void> {
  await upsertConfig({
    key: WBR_DECK_CONFIG_KEY,
    value: JSON.stringify({ version: 1, specs: meta.specs, order: meta.order }),
    workspaceId: workspace,
  });
}

export function trailingWeekStarts(now: Date, count = 6, yearOffset = 0): Date[] {
  const end = new Date(
    Date.UTC(now.getUTCFullYear() + yearOffset, now.getUTCMonth(), now.getUTCDate())
  );
  const day = end.getUTCDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  end.setUTCDate(end.getUTCDate() - mondayOffset);
  end.setUTCHours(0, 0, 0, 0);
  const starts: Date[] = [];
  for (let i = count - 1; i >= 0; i--) {
    starts.push(new Date(end.getTime() - i * WEEK_MS));
  }
  return starts;
}

export function trailingMonthStarts(now: Date, count = 12, yearOffset = 0): Date[] {
  const starts: Date[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear() + yearOffset, now.getUTCMonth(), 1));
  for (let i = count - 1; i >= 0; i--) {
    starts.push(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1)));
  }
  return starts;
}

function inWindow(ts: Date | null | undefined, start: Date, ms: number): boolean {
  if (!ts) return false;
  const t = ts.getTime();
  return t >= start.getTime() && t < start.getTime() + ms;
}

export function countSignups(
  users: Array<{ signupDate: Date | null }>,
  starts: Date[],
  windowMs: number
): number[] {
  return starts.map((start) =>
    users.filter((user) => inWindow(user.signupDate, start, windowMs)).length
  );
}

export function countActives(
  activity: Array<{ personId: string; timestamp: Date }>,
  starts: Date[],
  windowMs: number
): number[] {
  return starts.map((start) => {
    const ids = new Set<string>();
    for (const row of activity) {
      if (inWindow(row.timestamp, start, windowMs)) ids.add(row.personId);
    }
    return ids.size;
  });
}

export function countRetention(
  users: Array<{ personId: string; signupDate: Date | null }>,
  activity: Array<{ personId: string; timestamp: Date }>,
  starts: Date[],
  windowMs: number
): number[] {
  return starts.map((start) => {
    const end = start.getTime() + windowMs;
    const cohort = users.filter(
      (user) => user.signupDate && user.signupDate.getTime() < end
    );
    if (cohort.length === 0) return 0;
    const active = new Set<string>();
    for (const row of activity) {
      if (inWindow(row.timestamp, start, windowMs)) active.add(row.personId);
    }
    const retained = cohort.filter((user) => active.has(user.personId)).length;
    return round2((retained / cohort.length) * 100);
  });
}

export function countFilteredEvents(
  activity: Array<{
    personId: string;
    timestamp: Date;
    eventName: string;
    eventClass: string;
    platform: string | null;
  }>,
  users: Array<{ personId: string; platform: string | null; country: string | null }>,
  starts: Date[],
  windowMs: number,
  source: Extract<MetricSource, { kind: "event_count" }>
): number[] {
  const byPerson = new Map(users.map((user) => [user.personId, user]));
  return starts.map((start) => {
    let n = 0;
    for (const row of activity) {
      if (!inWindow(row.timestamp, start, windowMs)) continue;
      if (source.eventName && row.eventName !== source.eventName) continue;
      if (source.filters?.eventClass && row.eventClass !== source.filters.eventClass) {
        continue;
      }
      const user = byPerson.get(row.personId);
      if (source.filters?.platform) {
        const platform = row.platform || user?.platform;
        if (platform !== source.filters.platform) continue;
      }
      if (source.filters?.country && user?.country !== source.filters.country) {
        continue;
      }
      n += 1;
    }
    return n;
  });
}

export type ComputedSeries = {
  weeks: number[];
  prevWeeks: number[];
  months: number[];
  prevMonths: number[];
};

export function computeEventCountSeries(
  source: Extract<MetricSource, { kind: "event_count" }>,
  users: Array<{
    personId: string;
    signupDate: Date | null;
    platform: string | null;
    country: string | null;
  }>,
  activity: Array<{
    personId: string;
    timestamp: Date;
    eventName: string;
    eventClass: string;
    platform: string | null;
  }>,
  now = new Date()
): ComputedSeries {
  const weekStarts = trailingWeekStarts(now, 6, 0);
  const prevWeekStarts = trailingWeekStarts(now, 6, -1);
  const monthStarts = trailingMonthStarts(now, 12, 0);
  const prevMonthStarts = trailingMonthStarts(now, 12, -1);
  const measure = source.measure ?? (source.eventName ? "events" : "actives");

  const weeksOf = (starts: Date[], ms: number) => {
    if (measure === "signups") return countSignups(users, starts, ms);
    if (measure === "retention") return countRetention(users, activity, starts, ms);
    if (measure === "events" || source.eventName || source.filters) {
      return countFilteredEvents(activity, users, starts, ms, source);
    }
    return countActives(activity, starts, ms);
  };

  return {
    weeks: weeksOf(weekStarts, WEEK_MS),
    prevWeeks: weeksOf(prevWeekStarts, WEEK_MS),
    months: weeksOf(monthStarts, 32 * 86400000),
    prevMonths: weeksOf(prevMonthStarts, 32 * 86400000),
  };
}

export function revenueSeriesFor(
  series: RevenueLaneSeries,
  kind: Extract<MetricSource, { kind: "revenue" }>["series"]
): ComputedSeries {
  const lanes = buildRevenueLanes(series);
  const id =
    kind === "mrr"
      ? "rev_mrr"
      : kind === "new"
        ? "rev_new"
        : kind === "churned"
          ? "rev_churned"
          : kind === "arpu"
            ? "rev_arpu"
            : "rev_runway";
  const lane = lanes.find((row) => row.id === id);
  return {
    weeks: lane?.weeks ?? [],
    prevWeeks: lane?.prevWeeks ?? [],
    months: lane?.months ?? [],
    prevMonths: lane?.prevMonths ?? [],
  };
}

export function pointsToSeries(
  points: Array<{ timestamp: Date; value: number | null; grain: string }>
): ComputedSeries {
  const allWeeks = points
    .filter((p) => p.grain === "week")
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const allMonths = points
    .filter((p) => p.grain === "month")
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return {
    weeks: allWeeks.slice(0, 6).reverse().map((p) => round2(p.value || 0)),
    prevWeeks: allWeeks.slice(52, 58).reverse().map((p) => round2(p.value || 0)),
    months: allMonths.slice(0, 12).reverse().map((p) => round2(p.value || 0)),
    prevMonths: allMonths.slice(12, 24).reverse().map((p) => round2(p.value || 0)),
  };
}

export function padSeries(series: ComputedSeries): ComputedSeries {
  const pad = (values: number[], n: number) => {
    if (values.length >= n) return values.slice(-n);
    return [...Array(n - values.length).fill(0), ...values];
  };
  return {
    weeks: pad(series.weeks, 6),
    prevWeeks: pad(series.prevWeeks, 6),
    months: pad(series.months, 12),
    prevMonths: pad(series.prevMonths, 12),
  };
}

function nextSectionOrder(section: WbrSectionId, orderIndex: number): string {
  const meta = sectionMeta(section);
  return `${meta.n}.${String(orderIndex + 1).padStart(2, "0")}`;
}

export function assertNoStatusField(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  if ("status" in input || "statusReason" in input) {
    throw new WbrBuilderError("status is computed and cannot be written");
  }
}

export async function defineMetric(
  workspace: string,
  input: DefineMetricRequest,
  options: { lifecycle?: MetricLifecycle } = {}
): Promise<DefinedMetricRow> {
  assertNoStatusField(input);
  const parsed = DefineMetricRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new WbrBuilderError("Bad Request");
  }
  const data = parsed.data;
  const metricId = data.id?.trim() || metricIdFromName(data.name);
  const meta = await loadDeckMeta(workspace);
  const existingSpec = meta.specs[metricId];
  const lifecycle = options.lifecycle ?? existingSpec?.lifecycle ?? "active";

  const [existing] = await db
    .select()
    .from(schema.metricDefs)
    .where(
      and(
        eq(schema.metricDefs.workspaceId, workspace),
        eq(schema.metricDefs.metricId, metricId)
      )
    )
    .all();

  const section = data.section;
  const orderIndex = meta.order.includes(metricId)
    ? meta.order.indexOf(metricId)
    : meta.order.length;
  const sectionOrder = existing?.sectionOrder ?? nextSectionOrder(section, orderIndex);
  const owner = data.owner ?? existing?.owner ?? "·";
  const unit = data.unit ?? existing?.unit ?? "";
  const target = data.target ?? existing?.target ?? 0;
  const goodDir = data.goodDir ?? (existing?.goodDir === "down" ? "down" : "up");
  const type = data.type;
  const source = data.source;

  const row = {
    metricId,
    name: data.name,
    section,
    sectionOrder,
    owner,
    type,
    unit,
    target,
    goodDir,
    status: "ok",
    statusReason: null as string | null,
    workspaceId: workspace,
  };

  if (existing) {
    await db
      .update(schema.metricDefs)
      .set({
        name: row.name,
        section: row.section,
        sectionOrder: row.sectionOrder,
        owner: row.owner,
        type: row.type,
        unit: row.unit,
        target: row.target,
        goodDir: row.goodDir,
        workspaceId: workspace,
      })
      .where(
        and(
          eq(schema.metricDefs.workspaceId, workspace),
          eq(schema.metricDefs.metricId, metricId)
        )
      );
  } else {
    await db.insert(schema.metricDefs).values(row);
    if (!meta.order.includes(metricId)) meta.order.push(metricId);
  }

  meta.specs[metricId] = { source, lifecycle: lifecycle === "retired" ? "active" : lifecycle };
  if (lifecycle === "retired") {
    meta.specs[metricId].lifecycle = "active";
  }
  await saveDeckMeta(workspace, meta);

  if (data.points && data.points.length > 0) {
    await upsertMetricPoints(
      workspace,
      metricId,
      data.points.map((point) => ({
        timestamp: new Date(point.timestamp),
        value: point.value,
        grain: point.grain,
      }))
    );
  }

  return {
    metricId,
    name: row.name,
    section: row.section,
    sectionOrder: row.sectionOrder,
    owner: row.owner,
    type,
    unit: unit ?? "",
    target: target ?? 0,
    goodDir,
    source,
    lifecycle: meta.specs[metricId].lifecycle,
    workspaceId: workspace,
  };
}

export async function editMetric(
  workspace: string,
  patch: {
    id: string;
    name?: string;
    section?: WbrSectionId;
    type?: "input" | "output";
    unit?: string;
    target?: number;
    goodDir?: "up" | "down";
    owner?: string;
    source?: MetricSource;
  }
): Promise<DefinedMetricRow> {
  assertNoStatusField(patch);
  const [existing] = await db
    .select()
    .from(schema.metricDefs)
    .where(
      and(
        eq(schema.metricDefs.workspaceId, workspace),
        eq(schema.metricDefs.metricId, patch.id)
      )
    )
    .all();
  if (!existing) {
    throw new WbrBuilderError("Metric not found");
  }
  const meta = await loadDeckMeta(workspace);
  const spec = meta.specs[patch.id];
  const next = {
    id: patch.id,
    name: patch.name ?? existing.name,
    section: (patch.section ??
      (["fin", "acq", "act", "eng", "qua"].includes(existing.section)
        ? existing.section
        : "acq")) as WbrSectionId,
    type: (patch.type ?? (existing.type === "output" ? "output" : "input")) as
      | "input"
      | "output",
    unit: patch.unit ?? existing.unit ?? "",
    target: patch.target ?? existing.target ?? 0,
    goodDir: (patch.goodDir ?? (existing.goodDir === "down" ? "down" : "up")) as
      | "up"
      | "down",
    owner: patch.owner ?? existing.owner,
    source: patch.source ?? spec?.source ?? ({ kind: "manual" } as const),
  };
  return defineMetric(workspace, next, {
    lifecycle: spec?.lifecycle === "retired" ? "active" : spec?.lifecycle ?? "active",
  });
}

export async function retireMetric(workspace: string, metricId: string): Promise<void> {
  const meta = await loadDeckMeta(workspace);
  const [existing] = await db
    .select()
    .from(schema.metricDefs)
    .where(
      and(
        eq(schema.metricDefs.workspaceId, workspace),
        eq(schema.metricDefs.metricId, metricId)
      )
    )
    .all();
  if (!existing && !meta.specs[metricId]) {
    throw new WbrBuilderError("Metric not found");
  }
  const source = meta.specs[metricId]?.source ?? ({ kind: "manual" } as const);
  meta.specs[metricId] = { source, lifecycle: "retired" };
  meta.order = meta.order.filter((id) => id !== metricId);
  await saveDeckMeta(workspace, meta);
}

export async function reorderMetrics(workspace: string, order: string[]): Promise<void> {
  const meta = await loadDeckMeta(workspace);
  const known = new Set([
    ...Object.keys(meta.specs).filter((id) => meta.specs[id]?.lifecycle !== "retired"),
    ...order,
  ]);
  const next = order.filter((id) => known.has(id));
  for (const id of meta.order) {
    if (!next.includes(id) && meta.specs[id]?.lifecycle !== "retired") next.push(id);
  }
  meta.order = next;
  await saveDeckMeta(workspace, meta);

  const defs = await db
    .select()
    .from(schema.metricDefs)
    .where(eq(schema.metricDefs.workspaceId, workspace))
    .all();
  for (const def of defs) {
    const index = next.indexOf(def.metricId);
    if (index < 0) continue;
    const section = ["fin", "acq", "act", "eng", "qua"].includes(def.section)
      ? (def.section as WbrSectionId)
      : "acq";
    const sectionOrder = nextSectionOrder(section, index);
    if (sectionOrder === def.sectionOrder) continue;
    await db
      .update(schema.metricDefs)
      .set({ sectionOrder })
      .where(
        and(
          eq(schema.metricDefs.workspaceId, workspace),
          eq(schema.metricDefs.metricId, def.metricId)
        )
      );
  }
}

function pointKey(metricId: string, grain: string, timestamp: Date): string {
  return `${metricId}:${grain}:${timestamp.getTime()}`;
}

export async function upsertMetricPoints(
  workspace: string,
  metricId: string,
  points: MetricPointInput[]
): Promise<{ imported: number; updated: number }> {
  const existing = await db
    .select()
    .from(schema.metricPoints)
    .where(
      and(
        eq(schema.metricPoints.workspaceId, workspace),
        eq(schema.metricPoints.metricId, metricId)
      )
    )
    .all();
  const byKey = new Map(
    existing.map((row) => [pointKey(metricId, row.grain, row.timestamp), row])
  );
  let imported = 0;
  let updated = 0;
  for (const point of points) {
    const key = pointKey(metricId, point.grain, point.timestamp);
    const found = byKey.get(key);
    if (found) {
      if (found.value !== point.value) {
        await db
          .update(schema.metricPoints)
          .set({ value: point.value })
          .where(
            and(
              eq(schema.metricPoints.workspaceId, workspace),
              eq(schema.metricPoints.id, found.id)
            )
          );
        updated += 1;
      }
      continue;
    }
    await db.insert(schema.metricPoints).values({
      metricId,
      timestamp: point.timestamp,
      value: point.value,
      grain: point.grain,
      workspaceId: workspace,
    });
    byKey.set(key, {
      id: -1,
      metricId,
      timestamp: point.timestamp,
      value: point.value,
      grain: point.grain,
      workspaceId: workspace,
    });
    imported += 1;
  }
  return { imported, updated };
}

export function parseManualCsv(csv: string): MetricPointInput[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new WbrBuilderError("CSV is empty");
  }
  const header = lines[0].toLowerCase().split(",").map((cell) => cell.trim());
  const hasHeader =
    header.includes("timestamp") ||
    header.includes("date") ||
    header.includes("value");
  const rows = hasHeader ? lines.slice(1) : lines;
  const tsIdx = hasHeader
    ? Math.max(header.indexOf("timestamp"), header.indexOf("date"), 0)
    : 0;
  const valueIdx = hasHeader ? Math.max(header.indexOf("value"), 1) : 1;
  const grainIdx = hasHeader ? header.indexOf("grain") : 2;
  const points: MetricPointInput[] = [];
  for (const line of rows) {
    const cells = line.split(",").map((cell) => cell.trim());
    const rawTs = cells[tsIdx];
    const rawValue = cells[valueIdx];
    if (!rawTs || rawValue === undefined) {
      throw new WbrBuilderError("CSV rows need timestamp and value");
    }
    const timestamp = new Date(rawTs);
    if (Number.isNaN(timestamp.getTime())) {
      throw new WbrBuilderError("CSV timestamp is invalid");
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      throw new WbrBuilderError("CSV value is not a number");
    }
    const grainRaw = grainIdx >= 0 ? cells[grainIdx] : "week";
    const grain = grainRaw === "month" ? "month" : "week";
    points.push({ timestamp, value, grain });
  }
  return points;
}

export async function importManualCsv(
  workspace: string,
  metricId: string,
  csv: string
): Promise<{ imported: number; updated: number }> {
  const points = parseManualCsv(csv);
  const meta = await loadDeckMeta(workspace);
  const [existing] = await db
    .select()
    .from(schema.metricDefs)
    .where(
      and(
        eq(schema.metricDefs.workspaceId, workspace),
        eq(schema.metricDefs.metricId, metricId)
      )
    )
    .all();
  if (!existing) {
    throw new WbrBuilderError("Metric not found");
  }
  const source = meta.specs[metricId]?.source ?? { kind: "manual" as const };
  if (source.kind !== "manual") {
    meta.specs[metricId] = {
      source: { kind: "manual" },
      lifecycle: meta.specs[metricId]?.lifecycle ?? "active",
    };
    await saveDeckMeta(workspace, meta);
  }
  return upsertMetricPoints(workspace, metricId, points);
}

export type StarterProposal = DefineMetricRequest & { id: string };

export function starterProposals(input: {
  userCount: number;
  activityCount: number;
  revenueLanes: RevenueLane[];
  takenIds: Set<string>;
}): StarterProposal[] {
  const out: StarterProposal[] = [];
  if (input.userCount > 0 && !input.takenIds.has(STARTER_IDS.signups)) {
    out.push({
      id: STARTER_IDS.signups,
      name: "New signups",
      section: "acq",
      type: "input",
      unit: "",
      target: 0,
      goodDir: "up",
      owner: "📥",
      source: { kind: "event_count", measure: "signups" },
    });
  }
  if (input.activityCount > 0 && !input.takenIds.has(STARTER_IDS.actives)) {
    out.push({
      id: STARTER_IDS.actives,
      name: "Weekly actives",
      section: "eng",
      type: "input",
      unit: "",
      target: 0,
      goodDir: "up",
      owner: "⚡",
      source: { kind: "event_count", measure: "actives" },
    });
  }
  if (
    input.userCount > 0 &&
    input.activityCount > 0 &&
    !input.takenIds.has(STARTER_IDS.retention)
  ) {
    out.push({
      id: STARTER_IDS.retention,
      name: "Retention",
      section: "eng",
      type: "output",
      unit: "%",
      target: 0,
      goodDir: "up",
      owner: "🔁",
      source: { kind: "event_count", measure: "retention" },
    });
  }
  if (input.revenueLanes.length > 0) {
    for (const spec of REVENUE_STARTER) {
      if (input.takenIds.has(spec.id)) continue;
      const lane = input.revenueLanes.find((row) => row.id === spec.id);
      if (!lane || lane.weeks.every((value) => value === 0) && lane.weeks.length === 0) {
        continue;
      }
      if (!lane || (lane.weeks.length === 0 && lane.months.length === 0)) continue;
      out.push({
        id: spec.id,
        name: spec.name,
        section: "fin",
        type: spec.type,
        unit: spec.unit,
        target: spec.target,
        goodDir: spec.goodDir,
        owner: spec.owner,
        source: { kind: "revenue", series: spec.series },
      });
    }
  }
  return out;
}

export async function listStarterProposals(workspace: string): Promise<StarterProposal[]> {
  if (workspace === DEMO_WORKSPACE) return [];
  const [users, activity, meta, revenueSeries] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.workspaceId, workspace)).all(),
    db.select().from(schema.activity).where(eq(schema.activity.workspaceId, workspace)).all(),
    loadDeckMeta(workspace),
    loadRevenueSeries(workspace),
  ]);
  const lanes = buildRevenueLanes(revenueSeries);
  const taken = new Set<string>();
  for (const [id, spec] of Object.entries(meta.specs)) {
    if (spec.lifecycle === "active" || spec.lifecycle === "retired") taken.add(id);
  }
  const defs = await db
    .select()
    .from(schema.metricDefs)
    .where(eq(schema.metricDefs.workspaceId, workspace))
    .all();
  for (const def of defs) {
    if (meta.specs[def.metricId]?.lifecycle === "retired") continue;
    if (meta.specs[def.metricId]?.lifecycle === "active" || !meta.specs[def.metricId]) {
      taken.add(def.metricId);
    }
  }
  return starterProposals({
    userCount: users.length,
    activityCount: activity.length,
    revenueLanes: lanes,
    takenIds: taken,
  });
}

export async function acceptStarterProposals(
  workspace: string,
  ids?: string[]
): Promise<DefinedMetricRow[]> {
  const proposals = await listStarterProposals(workspace);
  const wanted = ids && ids.length > 0 ? new Set(ids) : null;
  const chosen = proposals.filter((row) => !wanted || wanted.has(row.id));
  if (chosen.length === 0) {
    throw new WbrBuilderError("No starter metrics to accept");
  }
  const written: DefinedMetricRow[] = [];
  for (const proposal of chosen) {
    written.push(await defineMetric(workspace, proposal, { lifecycle: "active" }));
  }
  return written;
}

export function deckViewUrl(baseUrl: string, workspace: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  return `${origin}/dashboard?workspace=${encodeURIComponent(workspace)}&view=wbr`;
}

export function definedMetricPayload(row: DefinedMetricRow) {
  return {
    id: row.metricId,
    name: row.name,
    section: row.section,
    sectionOrder: row.sectionOrder,
    owner: row.owner,
    type: row.type,
    unit: row.unit,
    target: row.target,
    goodDir: row.goodDir,
    source: row.source,
    lifecycle: row.lifecycle,
  };
}
