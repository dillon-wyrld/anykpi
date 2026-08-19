import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";

export async function loadWbrView(workspace: string) {
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

  const metrics = metricDefs.map((def) => {
    const allWeeks = metricPoints
      .filter((p) => p.metricId === def.metricId && p.grain === "week")
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const allMonths = metricPoints
      .filter((p) => p.metricId === def.metricId && p.grain === "month")
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const weeks = allWeeks.slice(0, 6).reverse().map((p) => Math.round((p.value || 0) * 100) / 100);
    const prevWeeks = allWeeks.slice(52, 58).reverse().map((p) => Math.round((p.value || 0) * 100) / 100);
    const months = allMonths.slice(0, 12).reverse().map((p) => Math.round((p.value || 0) * 100) / 100);
    const prevMonths = allMonths.slice(12, 24).reverse().map((p) => Math.round((p.value || 0) * 100) / 100);

    const current = weeks[weeks.length - 1] || 0;
    const lastWeek = weeks[weeks.length - 2] || current;
    const lastYear = prevWeeks[prevWeeks.length - 1] || current;

    const wow = lastWeek !== 0 ? Math.round(((current - lastWeek) / lastWeek) * 100 * 10) / 10 : 0;
    const yoy = lastYear !== 0 ? Math.round(((current - lastYear) / lastYear) * 100 * 10) / 10 : 0;

    const status = (def.status as "on" | "watch" | "off") || "on";
    const dp = def.unit === "%" || def.unit === "$" ? 1 : 0;

    return {
      id: def.metricId,
      name: def.name,
      section: def.section,
      sectionOrder: def.sectionOrder,
      owner: def.owner,
      type: def.type,
      current: Math.round(current * 100) / 100,
      target: Math.round((def.target || 0) * 100) / 100,
      wow: Math.round(wow * 10) / 10,
      yoy: Math.round(yoy * 10) / 10,
      status,
      statusReason: def.statusReason,
      unit: def.unit,
      goodDir: def.goodDir === "up" ? 1 : -1,
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

  metrics.sort((a, b) => a.sectionOrder.localeCompare(b.sectionOrder));

  return { metrics };
}
