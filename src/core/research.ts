/**
 * PMF+ web research — explicit, disclosed, locally cached.
 *
 * Nothing leaves the machine until the founder approves the outgoing
 * fields. Loading a view, listing candidates, and the disclosure step
 * never call fetch. Results persist beside the SQLite file
 * (`research-cache.json`) so ANY-12 can keep owning schema.ts.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import type {
  ResearchClaim,
  ResearchOutgoingField,
  ResearchResult,
} from "@/core/contracts";

export const RESEARCH_OUTGOING_FIELD_NAMES = ["name", "country"] as const;
export type ResearchOutgoingFieldName = (typeof RESEARCH_OUTGOING_FIELD_NAMES)[number];

/** Public encyclopedia OpenSearch. The only default egress target. */
export const PUBLIC_RESEARCH_ENDPOINT = "https://en.wikipedia.org/w/api.php";
export const PUBLIC_RESEARCH_SOURCE = "public encyclopedia";

export type ResearchSubject = {
  personId: string;
  name: string;
  country?: string | null;
  email?: string | null;
  emoji?: string | null;
  platform?: string | null;
};

export type ResearchFetch = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export type ResearchDenied = {
  ok: false;
  error: string;
};

export type ResearchOk = {
  ok: true;
  result: ResearchResult;
};

export type ResearchOutcome = ResearchDenied | ResearchOk;

export type RunResearchOptions = {
  workspace: string;
  subject: ResearchSubject;
  approvedFields: ResearchOutgoingField[];
  fetch?: ResearchFetch;
  now?: Date;
  refresh?: boolean;
  cachePath?: string;
};

type CacheFile = {
  version: 1;
  entries: Record<string, ResearchResult>;
};

const NEVER_LEAVE = new Set(["email", "personId", "person_id", "income", "incomeBand"]);

export function researchCachePath(
  databasePath = process.env.DATABASE_PATH ||
    resolve(process.cwd(), "data", "anykpi.db")
): string {
  if (process.env.RESEARCH_CACHE_PATH) {
    return process.env.RESEARCH_CACHE_PATH;
  }
  return join(dirname(resolve(databasePath)), "research-cache.json");
}

function subjectValue(
  subject: ResearchSubject,
  field: ResearchOutgoingFieldName
): string | null {
  if (field === "name") {
    const value = subject.name.trim();
    return value.length > 0 ? value : null;
  }
  const value = subject.country?.trim();
  return value ? value : null;
}

/**
 * Fields that would leave, listed verbatim. Email, person id, and income
 * are never candidates — they cannot be approved out.
 */
export function listOutgoingFields(subject: ResearchSubject): ResearchOutgoingField[] {
  const outgoing: ResearchOutgoingField[] = [];
  for (const field of RESEARCH_OUTGOING_FIELD_NAMES) {
    const value = subjectValue(subject, field);
    if (value === null) continue;
    outgoing.push({ field, value });
  }
  return outgoing;
}

export function discloseResearch(subject: ResearchSubject): {
  personId: string;
  outgoing: ResearchOutgoingField[];
} {
  return {
    personId: subject.personId,
    outgoing: listOutgoingFields(subject),
  };
}

export function buildResearchQuery(approved: ResearchOutgoingField[]): string {
  return approved
    .map((field) => field.value.trim())
    .filter((value) => value.length > 0)
    .join(" ");
}

export function buildResearchUrl(query: string): string {
  const url = new URL(PUBLIC_RESEARCH_ENDPOINT);
  url.searchParams.set("action", "opensearch");
  url.searchParams.set("search", query);
  url.searchParams.set("limit", "5");
  url.searchParams.set("namespace", "0");
  url.searchParams.set("format", "json");
  return url.toString();
}

export function cacheKey(
  workspace: string,
  personId: string,
  outgoing: ResearchOutgoingField[]
): string {
  const payload = outgoing.map((field) => `${field.field}=${field.value}`).join("|");
  const digest = createHash("sha256").update(payload).digest("hex").slice(0, 16);
  return `${workspace}:${personId}:${digest}`;
}

/**
 * Approved list must be a non-empty subset of the disclosure, values
 * matching verbatim. Name is required. Unknown or mismatched fields fail
 * closed — no query is built.
 */
export function approveOutgoingFields(
  subject: ResearchSubject,
  approved: ResearchOutgoingField[]
): ResearchOutgoingField[] | null {
  if (approved.length === 0) return null;

  const allowed = listOutgoingFields(subject);
  const byField = new Map(allowed.map((field) => [field.field, field]));
  const seen = new Set<string>();
  const accepted: ResearchOutgoingField[] = [];

  for (const field of approved) {
    if (NEVER_LEAVE.has(field.field)) return null;
    const match = byField.get(field.field);
    if (!match) return null;
    if (match.value !== field.value) return null;
    if (seen.has(field.field)) return null;
    seen.add(field.field);
    accepted.push(match);
  }

  const name = accepted.find((field) => field.field === "name");
  if (!name || name.value.trim().length === 0) return null;
  return accepted;
}

function emptyCache(): CacheFile {
  return { version: 1, entries: {} };
}

function readCacheFile(path: string): CacheFile {
  if (!existsSync(path)) return emptyCache();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
    if (parsed.version !== 1 || typeof parsed.entries !== "object" || !parsed.entries) {
      return emptyCache();
    }
    return parsed;
  } catch {
    return emptyCache();
  }
}

function writeCacheFile(path: string, cache: CacheFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2), "utf8");
}

export function readCachedResearch(
  workspace: string,
  personId: string,
  outgoing: ResearchOutgoingField[],
  cachePath = researchCachePath()
): ResearchResult | null {
  const cache = readCacheFile(cachePath);
  const entry = cache.entries[cacheKey(workspace, personId, outgoing)];
  if (!entry) return null;
  return { ...entry, cached: true };
}

export function writeCachedResearch(
  result: ResearchResult,
  cachePath = researchCachePath()
): void {
  const cache = readCacheFile(cachePath);
  cache.entries[cacheKey(result.workspace, result.personId, result.outgoing)] = {
    ...result,
    cached: true,
  };
  writeCacheFile(cachePath, cache);
}

export function listCachedResearch(
  workspace: string,
  cachePath = researchCachePath()
): ResearchResult[] {
  const cache = readCacheFile(cachePath);
  const prefix = `${workspace}:`;
  return Object.entries(cache.entries)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, entry]) => ({ ...entry, cached: true }))
    .sort((a, b) => (a.queriedAt < b.queriedAt ? 1 : -1));
}

export function parseOpenSearchPayload(payload: unknown): ResearchClaim[] {
  if (!Array.isArray(payload) || payload.length < 4) return [];
  const titles = payload[1];
  const descriptions = payload[2];
  const urls = payload[3];
  if (!Array.isArray(titles)) return [];

  const claims: ResearchClaim[] = [];
  for (let i = 0; i < titles.length && claims.length < 5; i++) {
    const title = titles[i];
    if (typeof title !== "string" || title.trim().length === 0) continue;
    const url = Array.isArray(urls) && typeof urls[i] === "string" ? urls[i] : undefined;
    const description =
      Array.isArray(descriptions) && typeof descriptions[i] === "string"
        ? descriptions[i]
        : "";
    let hostname = PUBLIC_RESEARCH_SOURCE;
    if (url) {
      try {
        hostname = new URL(url).hostname;
      } catch {
        hostname = PUBLIC_RESEARCH_SOURCE;
      }
    }
    claims.push({
      title: description.trim().length > 0 ? `${title} — ${description.trim()}` : title,
      source: hostname,
      url,
      confidence: i === 0 ? "medium" : "low",
    });
  }
  return claims;
}

function defaultHeaders(): HeadersInit {
  return {
    Accept: "application/json",
    "User-Agent": "ANYKPI/0.1 (self-hosted research; +https://github.com/dillon-wyrld/anykpi)",
  };
}

/**
 * The only function that may call fetch. Refuses (and does not touch
 * the network) unless `approvedFields` match the disclosure verbatim.
 */
export async function runResearch(options: RunResearchOptions): Promise<ResearchOutcome> {
  const approved = approveOutgoingFields(options.subject, options.approvedFields);
  if (!approved) {
    return {
      ok: false,
      error: "Approve the outgoing fields before any query is made.",
    };
  }

  const query = buildResearchQuery(approved);
  if (query.length === 0) {
    return {
      ok: false,
      error: "Approve the outgoing fields before any query is made.",
    };
  }

  const path = options.cachePath ?? researchCachePath();
  if (!options.refresh) {
    const cached = readCachedResearch(
      options.workspace,
      options.subject.personId,
      approved,
      path
    );
    if (cached) {
      return { ok: true, result: cached };
    }
  }

  const fetchImpl = options.fetch ?? fetch;
  const url = buildResearchUrl(query);
  let claims: ResearchClaim[] = [];
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: defaultHeaders(),
    });
    if (response.ok) {
      claims = parseOpenSearchPayload(await response.json());
    }
  } catch {
    return { ok: false, error: "Public source did not respond." };
  }

  const result: ResearchResult = {
    personId: options.subject.personId,
    name: options.subject.name,
    workspace: options.workspace,
    queriedAt: (options.now ?? new Date()).toISOString(),
    query,
    outgoing: approved,
    claims,
    verified: claims.length > 0,
    cached: false,
    source: PUBLIC_RESEARCH_SOURCE,
  };
  writeCachedResearch(result, path);
  return { ok: true, result };
}
