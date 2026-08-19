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
    .all();

  const metricPoints = await db
    .select()
    .from(schema.metricPoints)
    .where(eq(schema.metricPoints.workspaceId, workspace))
    .all();

  const metrics = metricDefs.map((def) => {
    const weekPoints = metricPoints
      .filter((p) => p.metricId === def.metricId && p.grain === "week")
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 12);

    const monthPoints = metricPoints
      .filter((p) => p.metricId === def.metricId && p.grain === "month")
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 12);

    const current = weekPoints[0]?.value || 0;
    const lastWeek = weekPoints[1]?.value || current;
    const lastYear = weekPoints[11]?.value || current;

    const wow = lastWeek !== 0 ? ((current - lastWeek) / lastWeek) * 100 : 0;
    const yoy = lastYear !== 0 ? ((current - lastYear) / lastYear) * 100 : 0;

    const recentValues = weekPoints.slice(0, 3).map((p) => p.value || 0);
    
    // Use stored status from generator
    const status = def.status as "on" | "watch" | "off" || "on";

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
      goodDir: def.goodDir,
      weeks: weekPoints.reverse().map(p => Math.round((p.value || 0) * 100) / 100),
      months: monthPoints.reverse().map(p => Math.round((p.value || 0) * 100) / 100),
      source: "read model",
      syncAge: "live"
    };
  });

  // Sort by section order
  metrics.sort((a, b) => a.sectionOrder.localeCompare(b.sectionOrder));

  return NextResponse.json({ metrics });
}
