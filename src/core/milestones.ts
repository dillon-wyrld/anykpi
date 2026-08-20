/**
 * Milestone detector — earned one-shot moments from the read models.
 *
 * Pinned rules: Nth signup (100 / 1,000 / 10,000), a new longest streak,
 * company birthday, first cohort smile (a flattened retention curve).
 *
 * Identity is `(workspaceId, kind, subject)`. Re-running detection yields
 * the same keys; calendar merge and persist skip any key already present.
 * Nothing here loops or projects a future pace — only moments already earned.
 */

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import {
  anniversaryOnOrBefore,
  DEFAULT_HOME_TIMEZONE,
  loadHomeTimezone,
} from "@/core/day";
import {
  buildCohortRows,
  cohortWindow,
  type CohortRow,
  type CohortUser,
} from "@/core/views/cohort-math";

export const SIGNUP_THRESHOLDS = [100, 1_000, 10_000] as const;

export const MILESTONE_SOURCE = "anykpi";
export const MILESTONE_SOURCE_NAME = "ANYKPI";
export const MILESTONE_SOURCE_COLOR = "#5e6ad2";
export const MILESTONE_TYPE = "milestone";

export const MILESTONE_RULES = {
  nth_signup: "Nth signup",
  longest_streak: "New longest streak",
  company_birthday: "Company birthday",
  first_smile: "First cohort smile",
} as const;

export type MilestoneKind = keyof typeof MILESTONE_RULES;

export const MILESTONE_EMOJI: Record<MilestoneKind, string> = {
  nth_signup: "🎯",
  longest_streak: "🔥",
  company_birthday: "🎂",
  first_smile: "😊",
};

const DAY_MS = 86_400_000;
const MIN_STREAK = 2;

export interface MilestonePerson {
  personId: string;
  signupDate: Date | null;
}

export interface MilestoneActivity {
  personId: string;
  timestamp: Date;
}

export interface MilestoneCohort {
  label: string;
  week: number;
  smileDetected: boolean;
  retention: number[];
}

export interface DetectMilestonesInput {
  workspaceId: string;
  users: MilestonePerson[];
  activity: MilestoneActivity[];
  foundedAt?: Date | null;
  asOf?: Date;
  /** Workspace home timezone; defaults to UTC so existing UTC fixtures stay put. */
  timeZone?: string;
  /** Injected smile rows for unit tests; live detection builds these. */
  cohorts?: MilestoneCohort[];
  cohortBaseDate?: Date;
}

export interface DetectedMilestone {
  workspaceId: string;
  kind: MilestoneKind;
  subject: string;
  key: string;
  rule: string;
  title: string;
  emoji: string;
  occurredAt: Date;
}

export interface MilestoneEventLike {
  source: string;
  type: string;
  title: string;
  eventDate?: Date;
  date?: Date | string;
}

export function milestoneKey(
  workspaceId: string,
  kind: MilestoneKind,
  subject: string
): string {
  return `${workspaceId}:${kind}:${subject}`;
}

export function foundedAtConfigKey(workspaceId: string): string {
  return `founded_at:${workspaceId}`;
}

export function companyNameConfigKey(workspaceId: string): string {
  return `company_name:${workspaceId}`;
}

export function homeCityConfigKey(workspaceId: string): string {
  return `home_city:${workspaceId}`;
}

export function utcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export function formatNthSignupTitle(n: number): string {
  return `${n.toLocaleString("en-US")}th signup`;
}

export function formatLongestStreakTitle(days: number): string {
  return `New longest streak of ${days} days`;
}

export function formatBirthdayTitle(): string {
  return MILESTONE_RULES.company_birthday;
}

export function formatFirstSmileTitle(): string {
  return MILESTONE_RULES.first_smile;
}

export function parseMilestoneIdentity(
  event: MilestoneEventLike
): { kind: MilestoneKind; subject: string } | null {
  if (event.source !== MILESTONE_SOURCE || event.type !== MILESTONE_TYPE) {
    return null;
  }

  const nth = event.title.match(/^([\d,]+)th signup$/);
  if (nth) {
    return { kind: "nth_signup", subject: nth[1].replace(/,/g, "") };
  }

  const streak = event.title.match(/^New longest streak of (\d+) days$/);
  if (streak) {
    return { kind: "longest_streak", subject: streak[1] };
  }

  if (event.title === MILESTONE_RULES.first_smile) {
    return { kind: "first_smile", subject: "first" };
  }

  if (event.title === MILESTONE_RULES.company_birthday) {
    const raw = event.eventDate ?? event.date;
    if (!raw) return null;
    const when = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(when.getTime())) return null;
    return {
      kind: "company_birthday",
      subject: String(when.getUTCFullYear()),
    };
  }

  return null;
}

export function longestRunOfDays(dayMs: number[]): {
  length: number;
  endedAt: Date;
} | null {
  if (dayMs.length === 0) return null;
  const days = [...dayMs].sort((a, b) => a - b);
  let best = 1;
  let bestEnd = days[0];
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i] === days[i - 1] + DAY_MS) {
      run += 1;
      if (run > best) {
        best = run;
        bestEnd = days[i];
      }
    } else {
      run = 1;
    }
  }
  return { length: best, endedAt: new Date(bestEnd) };
}

function sortSignups(users: MilestonePerson[]): Array<MilestonePerson & { signupDate: Date }> {
  return users
    .filter((u): u is MilestonePerson & { signupDate: Date } => u.signupDate != null)
    .sort((a, b) => {
      const delta = a.signupDate.getTime() - b.signupDate.getTime();
      return delta !== 0 ? delta : a.personId.localeCompare(b.personId);
    });
}

function daysByPerson(activity: MilestoneActivity[]): Map<string, number[]> {
  const sets = new Map<string, Set<number>>();
  for (const row of activity) {
    const day = utcMidnight(row.timestamp).getTime();
    const set = sets.get(row.personId);
    if (set) set.add(day);
    else sets.set(row.personId, new Set([day]));
  }
  const out = new Map<string, number[]>();
  for (const [personId, set] of sets) {
    out.set(personId, Array.from(set).sort((a, b) => a - b));
  }
  return out;
}

function buildSmileCohorts(
  users: MilestonePerson[],
  activity: MilestoneActivity[]
): { rows: CohortRow[]; baseDate: Date } {
  const { baseDate, totalDays } = cohortWindow([
    ...users.map((u) => u.signupDate),
    ...activity.map((a) => a.timestamp),
  ]);

  const offsets = new Map<string, boolean[]>();
  for (const user of users) {
    if (!user.signupDate) continue;
    offsets.set(user.personId, Array.from({ length: totalDays }, () => false));
  }
  for (const row of activity) {
    const days = offsets.get(row.personId);
    if (!days) continue;
    const index = Math.floor(
      (row.timestamp.getTime() - baseDate.getTime()) / DAY_MS
    );
    if (index >= 0 && index < days.length) days[index] = true;
  }

  const cohortUsers: CohortUser[] = users
    .filter((u) => u.signupDate)
    .map((user) => ({
      personId: user.personId,
      name: user.personId,
      emoji: "",
      signupDay: Math.floor(
        (user.signupDate!.getTime() - baseDate.getTime()) / DAY_MS
      ),
      dailyActivity: offsets.get(user.personId) ?? [],
    }));

  return { rows: buildCohortRows(cohortUsers, "week", totalDays), baseDate };
}

function detectNthSignups(
  input: DetectMilestonesInput,
  asOf: Date
): DetectedMilestone[] {
  const signedUp = sortSignups(input.users).filter((u) => u.signupDate <= asOf);
  const out: DetectedMilestone[] = [];
  for (const n of SIGNUP_THRESHOLDS) {
    const person = signedUp[n - 1];
    if (!person) continue;
    out.push({
      workspaceId: input.workspaceId,
      kind: "nth_signup",
      subject: String(n),
      key: milestoneKey(input.workspaceId, "nth_signup", String(n)),
      rule: MILESTONE_RULES.nth_signup,
      title: formatNthSignupTitle(n),
      emoji: MILESTONE_EMOJI.nth_signup,
      occurredAt: person.signupDate,
    });
  }
  return out;
}

function detectLongestStreak(
  input: DetectMilestonesInput,
  asOf: Date
): DetectedMilestone | null {
  const asOfDay = utcMidnight(asOf).getTime();
  const byPerson = daysByPerson(
    input.activity.filter((row) => row.timestamp <= asOf)
  );

  let best: { length: number; endedAt: Date; personId: string } | null = null;
  for (const [personId, days] of byPerson) {
    const run = longestRunOfDays(days.filter((day) => day <= asOfDay));
    if (!run || run.length < MIN_STREAK) continue;
    if (
      !best ||
      run.length > best.length ||
      (run.length === best.length &&
        (run.endedAt.getTime() < best.endedAt.getTime() ||
          (run.endedAt.getTime() === best.endedAt.getTime() &&
            personId.localeCompare(best.personId) < 0)))
    ) {
      best = { ...run, personId };
    }
  }
  if (!best) return null;

  const subject = String(best.length);
  return {
    workspaceId: input.workspaceId,
    kind: "longest_streak",
    subject,
    key: milestoneKey(input.workspaceId, "longest_streak", subject),
    rule: MILESTONE_RULES.longest_streak,
    title: formatLongestStreakTitle(best.length),
    emoji: MILESTONE_EMOJI.longest_streak,
    occurredAt: best.endedAt,
  };
}

function detectCompanyBirthday(
  input: DetectMilestonesInput,
  asOf: Date
): DetectedMilestone | null {
  const foundedAt = input.foundedAt ?? sortSignups(input.users)[0]?.signupDate;
  if (!foundedAt) return null;
  const anniversary = anniversaryOnOrBefore(
    foundedAt,
    asOf,
    input.timeZone ?? DEFAULT_HOME_TIMEZONE
  );
  if (!anniversary) return null;
  const subject = String(anniversary.getUTCFullYear());
  return {
    workspaceId: input.workspaceId,
    kind: "company_birthday",
    subject,
    key: milestoneKey(input.workspaceId, "company_birthday", subject),
    rule: MILESTONE_RULES.company_birthday,
    title: formatBirthdayTitle(),
    emoji: MILESTONE_EMOJI.company_birthday,
    occurredAt: anniversary,
  };
}

function detectFirstSmile(
  input: DetectMilestonesInput,
  asOf: Date
): DetectedMilestone | null {
  let smiling: MilestoneCohort | undefined;
  let baseDate: Date | undefined = input.cohortBaseDate;

  if (input.cohorts) {
    smiling = input.cohorts.find((row) => row.smileDetected);
  } else {
    const built = buildSmileCohorts(input.users, input.activity);
    baseDate = built.baseDate;
    smiling = built.rows.find((row) => row.smileDetected);
  }
  if (!smiling) return null;

  const periods = Math.max(4, smiling.retention.length);
  const earnedOffset = (smiling.week + periods - 1) * 7;
  const fromCohort = baseDate
    ? new Date(utcMidnight(baseDate).getTime() + earnedOffset * DAY_MS)
    : asOf;
  const occurredAt = fromCohort.getTime() <= asOf.getTime() ? fromCohort : asOf;

  return {
    workspaceId: input.workspaceId,
    kind: "first_smile",
    subject: "first",
    key: milestoneKey(input.workspaceId, "first_smile", "first"),
    rule: MILESTONE_RULES.first_smile,
    title: formatFirstSmileTitle(),
    emoji: MILESTONE_EMOJI.first_smile,
    occurredAt,
  };
}

/**
 * Pure detector. Same facts in → same `(workspaceId, kind, subject)` keys out.
 */
export function detectMilestones(input: DetectMilestonesInput): DetectedMilestone[] {
  const asOf = input.asOf ?? new Date();
  const found = [
    ...detectNthSignups(input, asOf),
    detectLongestStreak(input, asOf),
    detectCompanyBirthday(input, asOf),
    detectFirstSmile(input, asOf),
  ].filter((row): row is DetectedMilestone => row !== null);

  const seen = new Set<string>();
  const unique: DetectedMilestone[] = [];
  for (const row of found) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    unique.push(row);
  }
  return unique;
}

/** Keep the first event for each milestone key; later copies are dropped. */
export function dedupeMilestones<T extends { key: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    out.push(row);
  }
  return out;
}

export function mergeMilestones<T extends { key: string }>(
  existing: T[],
  detected: T[]
): T[] {
  const seen = new Set(existing.map((row) => row.key));
  const out = [...existing];
  for (const row of detected) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    out.push(row);
  }
  return out;
}

export function eventMilestoneKey(
  event: MilestoneEventLike,
  workspaceId: string
): string | null {
  const identity = parseMilestoneIdentity(event);
  if (!identity) return null;
  return milestoneKey(workspaceId, identity.kind, identity.subject);
}

export function syntheticMilestoneId(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const id = Math.abs(hash) || 1;
  return -id;
}

export async function loadFoundedAt(workspaceId: string): Promise<Date | null> {
  const row = await db
    .select()
    .from(schema.config)
    .where(eq(schema.config.key, foundedAtConfigKey(workspaceId)))
    .get();
  if (!row?.value) return null;
  const parsed = new Date(row.value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function detectWorkspaceMilestones(
  workspaceId: string,
  asOf: Date = new Date()
): Promise<DetectedMilestone[]> {
  const [users, activity, foundedAt, timeZone] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.workspaceId, workspaceId)).all(),
    db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, workspaceId))
      .all(),
    loadFoundedAt(workspaceId),
    loadHomeTimezone(workspaceId),
  ]);

  return detectMilestones({
    workspaceId,
    users: users.map((u) => ({
      personId: u.personId,
      signupDate: u.signupDate,
    })),
    activity: activity.map((a) => ({
      personId: a.personId,
      timestamp: a.timestamp,
    })),
    foundedAt,
    asOf,
    timeZone,
  });
}

export function milestoneToCalValues(
  milestone: DetectedMilestone,
  now: Date = new Date()
) {
  return {
    source: MILESTONE_SOURCE,
    sourceName: MILESTONE_SOURCE_NAME,
    sourceColor: MILESTONE_SOURCE_COLOR,
    type: MILESTONE_TYPE,
    emoji: milestone.emoji,
    title: milestone.title,
    badge: milestone.rule,
    eventDate: milestone.occurredAt,
    isFuture: milestone.occurredAt.getTime() > now.getTime(),
    workspaceId: milestone.workspaceId,
  };
}

/**
 * Write newly earned milestones as calendar rows. Existing rows with the
 * same `(workspaceId, kind, subject)` key are left untouched.
 */
export async function persistWorkspaceMilestones(
  workspaceId: string,
  asOf: Date = new Date()
): Promise<{ detected: DetectedMilestone[]; inserted: DetectedMilestone[] }> {
  const detected = await detectWorkspaceMilestones(workspaceId, asOf);
  if (detected.length === 0) {
    return { detected, inserted: [] };
  }

  const existing = await db
    .select()
    .from(schema.calEvents)
    .where(eq(schema.calEvents.workspaceId, workspaceId))
    .all();
  const seen = new Set(
    existing
      .map((event) => eventMilestoneKey(event, workspaceId))
      .filter((key): key is string => key !== null)
  );

  const inserted: DetectedMilestone[] = [];
  for (const milestone of detected) {
    if (seen.has(milestone.key)) continue;
    seen.add(milestone.key);
    await db.insert(schema.calEvents).values(milestoneToCalValues(milestone, asOf));
    inserted.push(milestone);
  }
  return { detected, inserted };
}
