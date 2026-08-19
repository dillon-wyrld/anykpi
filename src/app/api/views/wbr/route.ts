import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq, and } from "drizzle-orm";

function wbrStat(
  current: number,
  target: number,
  recentValues: number[]
): "on" | "watch" | "off" {
  if (current >= target * 0.95) return "on";

  const missCount = recentValues.filter((v) => v < target * 0.95).length;
  if (missCount >= 2) return "off";

  return "watch";
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workspace = searchParams.get("workspace") || "demo";

  const metricDefs = await db
    .select()
    .from(schema.metricDefs)
    .where(eq(schema.metricDefs.workspaceId, workspace))
    .orderBy(schema.metricDefs.order)
    .all();

  const metricPoints = await db
    .select()
    .from(schema.metricPoints)
    .where(eq(schema.metricPoints.workspaceId, workspace))
    .all();

  const metrics = metricDefs.map((def) => {
    const points = metricPoints
      .filter((p) => p.metricId === def.id && p.grain === "week")
      .sort((a, b) => b.period.localeCompare(a.period))
      .slice(0, 12);

    const current = points[0]?.value || 0;
    const lastWeek = points[1]?.value || current;
    const lastYear = points[11]?.value || current;

    const wow = lastWeek !== 0 ? ((current - lastWeek) / lastWeek) * 100 : 0;
    const yoy = lastYear !== 0 ? ((current - lastYear) / lastYear) * 100 : 0;

    const recentValues = points.slice(0, 3).map((p) => p.value || 0);
    const status = wbrStat(current, def.target || 0, recentValues);

    return {
      id: def.id,
      name: def.name,
      section: def.section,
      current: Math.round(current),
      target: Math.round(def.target || 0),
      wow: Math.round(wow * 10) / 10,
      yoy: Math.round(yoy * 10) / 10,
      status,
      unit: def.unit,
    };
  });

  return NextResponse.json({ metrics });
}
