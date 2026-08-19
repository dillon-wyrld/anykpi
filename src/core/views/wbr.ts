import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import { getAnykpiConfig } from "@/core/config";
import {
  round2,
  seriesWowYoy,
  wbrDecimals,
  wbrGoodDir,
  wbrStat,
  type WbrExceptionRules,
} from "@/core/views/wbr-math";
import { loadRevenueLanes, wbrSectionId } from "@/core/views/revenue";

export {
  seriesPctChange,
  seriesWowYoy,
  wbrBox,
  wbrSheet,
  wbrStat,
} from "@/core/views/wbr-math";

function applyExceptionRules<
  T extends {
    weeks: number[];
    target: number;
    goodDir: number;
    type: "input" | "output";
    unit: string;
    dp: number;
    status: "ok" | "watch" | "off";
    statusReason: string | undefined;
  },
>(metric: T, rules: WbrExceptionRules): T {
  const stat = wbrStat(metric, rules);
  return {
    ...metric,
    status: stat.k,
    statusReason: stat.why,
  };
}

export async function loadWbrView(workspace: string) {
  const rules = getAnykpiConfig().wbr.exceptions;

  const metricDefs = await db
    .select()
    .from(schema.metricDefs)
    .where(eq(schema.metricDefs.workspaceId, workspace))
    .all();

  const metricPoints = await db
    .select()
    .from(schema.metricPoints)
    .where(eq(schema.metricPoints.workspaceId, workspace))
    .all();

  const fromDefs = metricDefs.map((def) => {
    const allWeeks = metricPoints
      .filter((p) => p.metricId === def.metricId && p.grain === "week")
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const allMonths = metricPoints
      .filter((p) => p.metricId === def.metricId && p.grain === "month")
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const weeks = allWeeks
      .slice(0, 6)
      .reverse()
      .map((p) => round2(p.value || 0));
    const prevWeeks = allWeeks
      .slice(52, 58)
      .reverse()
      .map((p) => round2(p.value || 0));
    const months = allMonths
      .slice(0, 12)
      .reverse()
      .map((p) => round2(p.value || 0));
    const prevMonths = allMonths
      .slice(12, 24)
      .reverse()
      .map((p) => round2(p.value || 0));

    const { current, wow, yoy } = seriesWowYoy(weeks, prevWeeks);

    const status = (def.status as "ok" | "watch" | "off") || "ok";
    const dp = wbrDecimals(def.unit);

    return {
      id: def.metricId,
      name: def.name,
      section: wbrSectionId(def.section),
      sectionOrder: def.sectionOrder,
      owner: def.owner,
      type: def.type === "output" ? "output" : "input",
      current,
      target: round2(def.target || 0),
      wow,
      yoy,
      status,
      statusReason: def.statusReason ?? undefined,
      unit: def.unit ?? "",
      goodDir: wbrGoodDir(def.goodDir),
      dp,
      weeks,
      prevWeeks,
      months,
      prevMonths,
      drivers: [],
      note: null,
      source: "read model",
      syncAge: "live",
    };
  });

  const revenueLanes = await loadRevenueLanes(workspace);
  const metrics = [...revenueLanes, ...fromDefs].map((m) =>
    applyExceptionRules(m, rules)
  );

  metrics.sort((a, b) => a.sectionOrder.localeCompare(b.sectionOrder));

  return { metrics, exceptionRules: rules };
}
