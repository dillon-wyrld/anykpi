import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import {
  buildCohortRows,
  cohortWindow,
  type CohortUser,
} from "@/core/views/cohort-math";
import { filterPayerUsers, isPayerRow } from "@/core/views/revenue-math";

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

export type LoadCohortsOptions = {
  /** When true, keep only people who appear on the person-revenue join. */
  payers?: boolean;
};

export async function loadCohortsView(
  workspace: string,
  grainParam = "week",
  options: LoadCohortsOptions = {}
) {
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

  const revenueRows = await db
    .select()
    .from(schema.personRevenue)
    .where(eq(schema.personRevenue.workspaceId, workspace))
    .all();

  const payerIds = revenueRows.filter(isPayerRow).map((row) => row.personId);
  const scopedUsers = options.payers ? filterPayerUsers(users, payerIds) : users;
  const payerSet = new Set(payerIds);

  const { baseDate, totalDays } = cohortWindow([
    ...scopedUsers.map((u) => u.signupDate),
    ...activities.map((a) => a.timestamp),
  ]);

  const enrichedUsers: Array<CohortUser & { isPayer: boolean }> = scopedUsers
    .filter((u) => u.signupDate)
    .map((user) => {
      const signupDay = Math.floor(
        (user.signupDate!.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000)
      );

      const dailyActivity = Array.from({ length: totalDays }, () => false);

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
        emoji: user.emoji ?? "",
        signupDay,
        dailyActivity,
        isPayer: payerSet.has(user.personId),
      };
    });

  return {
    cohorts: buildCohortRows(enrichedUsers, grainParam, totalDays),
    users: enrichedUsers,
    baseDate: baseDate.toISOString(),
    totalDays,
    payers: Boolean(options.payers),
  };
}
