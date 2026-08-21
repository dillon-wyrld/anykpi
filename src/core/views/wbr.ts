import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import { getAnykpiConfig } from "@/core/config";
import { DEMO_WORKSPACE } from "@/core/auth";
import {
  round2,
  seriesWowYoy,
  wbrDecimals,
  wbrGoodDir,
  wbrStat,
  type WbrExceptionRules,
} from "@/core/views/wbr-math";
import { loadRevenueLanes, loadRevenueSeries, wbrSectionId } from "@/core/views/revenue";
import type { RevenueLane } from "@/core/views/revenue-math";
import {
  computeEventCountSeries,
  listStarterProposals,
  loadDeckMeta,
  padSeries,
  pointsToSeries,
  revenueSeriesFor,
  type ComputedSeries,
  type MetricLifecycle,
} from "@/core/wbr-builder";
import type { MetricSource } from "@/core/contracts";

export {
  seriesPctChange,
  seriesWowYoy,
  wbrBox,
  wbrSheet,
  wbrStat,
} from "@/core/views/wbr-math";

function gradeMetric<T extends {
  weeks: number[];
  target: number;
  goodDir: number;
  type: string;
  unit: string;
  dp: number;
}>(metric: T, rules: WbrExceptionRules): T & {
  status: "ok" | "watch" | "off";
  statusReason: string;
} {
  const stat = wbrStat(
    {
      weeks: metric.weeks,
      target: metric.target,
      goodDir: metric.goodDir,
      type: metric.type === "output" ? "output" : "input",
      unit: metric.unit,
      dp: metric.dp,
    },
    rules
  );
  return { ...metric, status: stat.k, statusReason: stat.why };
}

export type WbrViewMetric = {
  id: string;
  name: string;
  section: string;
  sectionOrder: string;
  owner: string;
  type: "input" | "output";
  current: number;
  target: number;
  wow: number;
  yoy: number;
  status: "ok" | "watch" | "off";
  statusReason?: string;
  unit: string;
  goodDir: number;
  dp: number;
  weeks: number[];
  prevWeeks: number[];
  months: number[];
  prevMonths: number[];
  drivers: string[];
  note: null;
  source: string;
  syncAge: string;
  lifecycle: MetricLifecycle;
  sourceKind: "event_count" | "revenue" | "manual" | "read_model";
};

function sourceLabel(source: MetricSource | undefined): string {
  if (!source) return "read model";
  if (source.kind === "event_count") {
    if (source.eventName) return `event count · ${source.eventName}`;
    if (source.measure === "signups") return "event count · signups";
    if (source.measure === "retention") return "event count · retention";
    return "event count · actives";
  }
  if (source.kind === "revenue") return `revenue · ${source.series}`;
  return "manual";
}

function sourceKindOf(
  source: MetricSource | undefined
): WbrViewMetric["sourceKind"] {
  if (!source) return "read_model";
  return source.kind;
}

function fromSeries(
  base: {
    id: string;
    name: string;
    section: string;
    sectionOrder: string;
    owner: string;
    type: "input" | "output";
    target: number;
    unit: string;
    goodDir: number;
    source: MetricSource | undefined;
    lifecycle: MetricLifecycle;
  },
  series: ComputedSeries
): Omit<WbrViewMetric, "status" | "statusReason"> {
  const padded = padSeries(series);
  const { current, wow, yoy } = seriesWowYoy(padded.weeks, padded.prevWeeks);
  const unit = base.unit ?? "";
  return {
    id: base.id,
    name: base.name,
    section: wbrSectionId(base.section),
    sectionOrder: base.sectionOrder,
    owner: base.owner,
    type: base.type === "output" ? "output" : "input",
    current,
    target: round2(base.target || 0),
    wow,
    yoy,
    unit,
    goodDir: wbrGoodDir(base.goodDir > 0 ? "up" : "down"),
    dp: wbrDecimals(unit),
    weeks: padded.weeks,
    prevWeeks: padded.prevWeeks,
    months: padded.months,
    prevMonths: padded.prevMonths,
    drivers: [],
    note: null,
    source: sourceLabel(base.source),
    syncAge: "live",
    lifecycle: base.lifecycle,
    sourceKind: sourceKindOf(base.source),
  };
}

export async function loadWbrView(workspace: string) {
  const rules = getAnykpiConfig().wbr.exceptions;

  const [metricDefs, metricPoints, meta, users, activity, revenueSeries] =
    await Promise.all([
      db
        .select()
        .from(schema.metricDefs)
        .where(eq(schema.metricDefs.workspaceId, workspace))
        .all(),
      db
        .select()
        .from(schema.metricPoints)
        .where(eq(schema.metricPoints.workspaceId, workspace))
        .all(),
      loadDeckMeta(workspace),
      db.select().from(schema.users).where(eq(schema.users.workspaceId, workspace)).all(),
      db
        .select()
        .from(schema.activity)
        .where(eq(schema.activity.workspaceId, workspace))
        .all(),
      loadRevenueSeries(workspace),
    ]);

  const fromDefs = metricDefs
    .filter((def) => meta.specs[def.metricId]?.lifecycle !== "retired")
    .map((def) => {
      const spec = meta.specs[def.metricId];
      const source = spec?.source;
      let series: ComputedSeries;
      if (source?.kind === "event_count") {
        series = computeEventCountSeries(source, users, activity);
      } else if (source?.kind === "revenue") {
        series = revenueSeriesFor(revenueSeries, source.series);
      } else {
        series = pointsToSeries(
          metricPoints.filter((p) => p.metricId === def.metricId)
        );
      }
      return fromSeries(
        {
          id: def.metricId,
          name: def.name,
          section: def.section,
          sectionOrder: def.sectionOrder,
          owner: def.owner,
          type: def.type === "output" ? "output" : "input",
          target: def.target || 0,
          unit: def.unit ?? "",
          goodDir: wbrGoodDir(def.goodDir),
          source,
          lifecycle: spec?.lifecycle ?? "active",
        },
        series
      );
    });

  const revenueLanes = await loadRevenueLanes(workspace);
  const definedIds = new Set(fromDefs.map((m) => m.id));
  const extraLanes: RevenueLane[] =
    workspace === DEMO_WORKSPACE
      ? revenueLanes.filter((lane) => !definedIds.has(lane.id))
      : [];

  const metrics = [
    ...extraLanes.map((lane) => ({
      ...lane,
      lifecycle: "active" as const,
      sourceKind: "read_model" as const,
    })),
    ...fromDefs,
  ].map((m) => gradeMetric(m, rules));

  const order = meta.order;
  metrics.sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai >= 0 && bi >= 0 && ai !== bi) return ai - bi;
    if (ai >= 0 && bi < 0) return -1;
    if (bi >= 0 && ai < 0) return 1;
    return a.sectionOrder.localeCompare(b.sectionOrder);
  });

  const proposals = (await listStarterProposals(workspace)).map((proposal) => {
    let series: ComputedSeries;
    if (proposal.source.kind === "event_count") {
      series = computeEventCountSeries(proposal.source, users, activity);
    } else if (proposal.source.kind === "revenue") {
      series = revenueSeriesFor(revenueSeries, proposal.source.series);
    } else {
      series = { weeks: [], prevWeeks: [], months: [], prevMonths: [] };
    }
    const last = series.weeks[series.weeks.length - 1] ?? 0;
    return gradeMetric(
      fromSeries(
        {
          id: proposal.id,
          name: proposal.name,
          section: proposal.section,
          sectionOrder: proposal.section,
          owner: proposal.owner ?? "·",
          type: proposal.type,
          target: proposal.target ?? last,
          unit: proposal.unit ?? "",
          goodDir: wbrGoodDir(proposal.goodDir ?? "up"),
          source: proposal.source,
          lifecycle: "proposal",
        },
        series
      ),
      rules
    );
  });

  return { metrics, proposals, exceptionRules: rules };
}
