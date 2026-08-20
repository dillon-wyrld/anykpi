/**
 * GitHub connector — releases, stars, and commit cadence.
 *
 * Token via the sources store (ANY-46). Never logs credentials.
 * Releases land as calendar rows. Star count and weekly commit
 * cadence land as WBR read-model rows (existing metric tables).
 */

import { and, eq } from "drizzle-orm";
import type { SyncResult } from "@/core/contracts";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import type { SourceConfig } from "@/core/sources";
import { upsertSyncState } from "@/core/upsert";
import { resolveCredentials } from "./credentials";
import { failedSync } from "./http-status";
import type { SyncOpts } from "./types";

export const GITHUB_SOURCE = "github";
export const GITHUB_NAME = "GitHub";
export const GITHUB_API = "https://api.github.com";
export const GITHUB_COLOR = "#24292f";
export const GITHUB_RELEASE_EMOJI = "🚢";
export const GITHUB_RELEASE_TYPE = "launch";
export const GITHUB_STARS_NAME = "Stars";
export const GITHUB_COMMITS_NAME = "Weekly commits";
export const GITHUB_WBR_SECTION = "eng";
export const GITHUB_WBR_SECTION_ORDER = "04";
export const GITHUB_RELEASE_PAGE_SIZE = 100;

export type GitHubRepoRef = { owner: string; repo: string };

export type GitHubRepo = {
  full_name?: string;
  stargazers_count?: number;
};

export type GitHubRelease = {
  id?: number;
  tag_name?: string | null;
  name?: string | null;
  draft?: boolean | null;
  prerelease?: boolean | null;
  published_at?: string | null;
};

export type GitHubCommitWeek = {
  total?: number;
  week?: number;
};

export function parseRepo(config: SourceConfig): GitHubRepoRef | null {
  const combined = (config.repo || config.projectId || config.repository || "").trim();
  const spec = combined.includes("/")
    ? combined
    : config.owner && (config.repo || config.projectId)
      ? `${config.owner}/${config.repo || config.projectId}`
      : combined;
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(spec);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export function githubToken(config: SourceConfig): string | undefined {
  return config.token || config.apiKey || config.secretKey;
}

export function releaseTitle(release: GitHubRelease): string | null {
  const tag = release.tag_name?.trim();
  if (!tag) return null;
  return `Release ${tag}`;
}

export function starsMetricId(workspaceId: string): string {
  return `${workspaceId}:github:stars`;
}

export function commitsMetricId(workspaceId: string): string {
  return `${workspaceId}:github:commits`;
}

export function utcWeekStart(at: Date = new Date()): Date {
  const utc = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return utc;
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "ANYKPI/0.1 (self-hosted; +https://github.com/dillon-wyrld/anykpi)",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function repoUrl(ref: GitHubRepoRef): string {
  return `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
}

function releasesUrl(ref: GitHubRepoRef): string {
  const url = new URL(`${repoUrl(ref)}/releases`);
  url.searchParams.set("per_page", String(GITHUB_RELEASE_PAGE_SIZE));
  return url.toString();
}

function commitActivityUrl(ref: GitHubRepoRef): string {
  return `${repoUrl(ref)}/stats/commit_activity`;
}

async function replaceCalendarReleases(
  workspaceId: string,
  releases: GitHubRelease[],
  now: Date
): Promise<number> {
  await db
    .delete(schema.calEvents)
    .where(
      and(eq(schema.calEvents.workspaceId, workspaceId), eq(schema.calEvents.source, GITHUB_SOURCE))
    );

  let written = 0;
  for (const release of releases) {
    if (release.draft) continue;
    const title = releaseTitle(release);
    if (!title || !release.published_at) continue;
    const eventDate = new Date(release.published_at);
    if (Number.isNaN(eventDate.getTime())) continue;
    const isFuture = eventDate.getTime() > now.getTime();

    await db.insert(schema.calEvents).values({
      source: GITHUB_SOURCE,
      sourceName: GITHUB_NAME,
      sourceColor: GITHUB_COLOR,
      type: GITHUB_RELEASE_TYPE,
      emoji: GITHUB_RELEASE_EMOJI,
      title,
      badge: isFuture ? "cut" : "shipped",
      eventDate,
      isFuture,
      workspaceId,
    });
    written += 1;
  }
  return written;
}

async function upsertWbrMetric(opts: {
  metricId: string;
  name: string;
  owner: string;
  unit: string;
  target: number;
  points: Array<{ timestamp: Date; value: number }>;
  workspaceId: string;
}): Promise<void> {
  await db
    .insert(schema.metricDefs)
    .values({
      metricId: opts.metricId,
      name: opts.name,
      section: GITHUB_WBR_SECTION,
      sectionOrder: GITHUB_WBR_SECTION_ORDER,
      owner: opts.owner,
      type: "input",
      unit: opts.unit,
      target: opts.target,
      goodDir: "up",
      status: "ok",
      statusReason: null,
      workspaceId: opts.workspaceId,
    })
    .onConflictDoUpdate({
      target: [schema.metricDefs.workspaceId, schema.metricDefs.metricId],
      set: {
        name: opts.name,
        section: GITHUB_WBR_SECTION,
        sectionOrder: GITHUB_WBR_SECTION_ORDER,
        owner: opts.owner,
        type: "input",
        unit: opts.unit,
        target: opts.target,
        goodDir: "up",
        status: "ok",
        workspaceId: opts.workspaceId,
      },
    });

  await db
    .delete(schema.metricPoints)
    .where(
      and(
        eq(schema.metricPoints.workspaceId, opts.workspaceId),
        eq(schema.metricPoints.metricId, opts.metricId)
      )
    );

  for (const point of opts.points) {
    await db.insert(schema.metricPoints).values({
      metricId: opts.metricId,
      timestamp: point.timestamp,
      value: point.value,
      grain: "week",
      workspaceId: opts.workspaceId,
    });
  }
}

async function writeWbrContext(
  workspaceId: string,
  stars: number,
  weeks: GitHubCommitWeek[],
  now: Date
): Promise<number> {
  let written = 0;
  await upsertWbrMetric({
    metricId: starsMetricId(workspaceId),
    name: GITHUB_STARS_NAME,
    owner: "🐙",
    unit: "",
    target: 0,
    points: [{ timestamp: utcWeekStart(now), value: stars }],
    workspaceId,
  });
  written += 1;

  const commitPoints = weeks
    .filter((week) => typeof week.week === "number" && week.week > 0)
    .map((week) => ({
      timestamp: new Date(week.week! * 1000),
      value: typeof week.total === "number" ? week.total : 0,
    }))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .slice(-6);

  if (commitPoints.length > 0) {
    await upsertWbrMetric({
      metricId: commitsMetricId(workspaceId),
      name: GITHUB_COMMITS_NAME,
      owner: "🐙",
      unit: "",
      target: 0,
      points: commitPoints,
      workspaceId,
    });
    written += 1;
  }

  return written;
}

export async function syncGitHub(
  workspaceId: string = "live",
  opts?: SyncOpts
): Promise<SyncResult> {
  const credentials = resolveCredentials(GITHUB_SOURCE, opts?.config);
  const token = githubToken(credentials);
  if (!token) {
    throw new Error("GitHub token is required");
  }
  const ref = parseRepo(credentials);
  if (!ref) {
    throw new Error("GitHub repository is required");
  }

  const headers = authHeaders(token);

  try {
    const repoResponse = await fetch(repoUrl(ref), { headers });
    if (!repoResponse.ok) {
      return failedSync({
        source: GITHUB_SOURCE,
        sourceName: GITHUB_NAME,
        workspaceId,
        status: repoResponse.status,
      });
    }
    const repo = (await repoResponse.json()) as GitHubRepo;
    const stars =
      typeof repo.stargazers_count === "number" && Number.isFinite(repo.stargazers_count)
        ? repo.stargazers_count
        : 0;

    const releasesResponse = await fetch(releasesUrl(ref), { headers });
    if (!releasesResponse.ok) {
      return failedSync({
        source: GITHUB_SOURCE,
        sourceName: GITHUB_NAME,
        workspaceId,
        status: releasesResponse.status,
      });
    }
    const releasesRaw = (await releasesResponse.json()) as unknown;
    const releases = Array.isArray(releasesRaw) ? (releasesRaw as GitHubRelease[]) : [];

    let commitWeeks: GitHubCommitWeek[] = [];
    const commitsResponse = await fetch(commitActivityUrl(ref), { headers });
    if (commitsResponse.status === 202) {
      commitWeeks = [];
    } else if (!commitsResponse.ok) {
      return failedSync({
        source: GITHUB_SOURCE,
        sourceName: GITHUB_NAME,
        workspaceId,
        status: commitsResponse.status,
      });
    } else {
      const commitsRaw = (await commitsResponse.json()) as unknown;
      commitWeeks = Array.isArray(commitsRaw) ? (commitsRaw as GitHubCommitWeek[]) : [];
    }

    const now = new Date();
    const calendarRows = await replaceCalendarReleases(workspaceId, releases, now);
    const contextRows = await writeWbrContext(workspaceId, stars, commitWeeks, now);
    const rowsSynced = calendarRows + contextRows;

    await upsertSyncState({
      source: GITHUB_SOURCE,
      sourceName: GITHUB_NAME,
      lastSync: now,
      status: "success",
      workspaceId,
    });

    return { rowsSynced, nextCursor: null, health: "ok" };
  } catch (error) {
    await upsertSyncState({
      source: GITHUB_SOURCE,
      sourceName: GITHUB_NAME,
      lastSync: new Date(),
      status: "error",
      error: "sync failed",
      workspaceId,
    });
    throw error;
  }
}
