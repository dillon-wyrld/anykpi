import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workspace = searchParams.get("workspace") || "demo";

  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspace))
    .all();

  const activities = await db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspace))
    .all();

  const baseDate = new Date("2024-01-01");
  const totalDays = 168;

  const enrichedUsers = users
    .filter((u) => u.signupDate)
    .map((user) => {
      const signupDay = Math.floor(
        (user.signupDate!.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000)
      );

      const dailyActivity = new Array(totalDays).fill(false);

      activities
        .filter((a) => a.personId === user.personId)
        .forEach((activity) => {
          const dayIndex = Math.floor(
            (activity.timestamp.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000)
          );
          if (dayIndex >= 0 && dayIndex < totalDays) {
            dailyActivity[dayIndex] = true;
          }
        });

      return {
        personId: user.personId,
        name: user.name,
        emoji: user.emoji,
        signupDay,
        dailyActivity,
      };
    });

  return NextResponse.json({
    users: enrichedUsers,
    baseDate: baseDate.toISOString(),
    totalDays,
  });
}
