import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import {
  buildCohortRows,
  cohortWindow,
  type CohortUser,
} from "@/core/views/cohort-math";

export {
  CO_DECAY,
  CO_LEVEL,
  CO_MINSIZE,
  GRAINS,
  buildCohortRows,
  coFloorOf,
  coGrade,
  coSlope,
} from "@/core/views/cohort-math";

export async function loadCohortsView(workspace: string, grainParam = "week") {
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

  const { baseDate, totalDays } = cohortWindow([
    ...users.map((u) => u.signupDate),
    ...activities.map((a) => a.timestamp),
  ]);

  const enrichedUsers: CohortUser[] = users
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
            (activity.timestamp.getTime() - baseDate.getTime()) /
              (24 * 60 * 60 * 1000)
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

  return {
    cohorts: buildCohortRows(enrichedUsers, grainParam, totalDays),
    users: enrichedUsers,
    baseDate: baseDate.toISOString(),
    totalDays,
  };
}
