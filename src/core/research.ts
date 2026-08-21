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
import { operatorFetchUrlAllowed } from "@/connectors/operator-fetch";

export const RESEARCH_OUTGOING_FIELD_NAMES = ["name", "country"] as const;
export type ResearchOutgoingFieldName = (typeof RESEARCH_OUTGOING_FIELD_NAMES)[number];

/** Public encyclopedia OpenSearch. Used when no BYO web-search key is set. */
export const PUBLIC_RESEARCH_ENDPOINT = "https://en.wikipedia.org/w/api.php";
export const PUBLIC_RESEARCH_SOURCE = "public encyclopedia";

/** Default GET `?q=` web-search API. Used only when a BYO key is present. */
export const DEFAULT_WEB_SEARCH_ENDPOINT =
  "https://api.search.brave.com/res/v1/web/search";
export const WEB_SEARCH_SOURCE = "web search";

export type ResearchProviderId = "encyclopedia" | "web_search";

export type ResearchEnv = {
  ANYKPI_RESEARCH_SEARCH_KEY?: string;
  ANYKPI_RESEARCH_SEARCH_URL?: string;
};

const CLAIM_CONFIDENCE = new Set<ResearchClaim["confidence"]>([
  "high",
  "medium",
  "low",
]);

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
  /** Test seam. Production reads `process.env`. */
  env?: ResearchEnv;
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

export function researchSearchKey(
  env: ResearchEnv | NodeJS.ProcessEnv = process.env
): string | null {
  const key = env.ANYKPI_RESEARCH_SEARCH_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function resolveResearchProvider(
  env: ResearchEnv | NodeJS.ProcessEnv = process.env
): ResearchProviderId {
  return researchSearchKey(env) ? "web_search" : "encyclopedia";
}

export function researchSearchEndpoint(
  env: ResearchEnv | NodeJS.ProcessEnv = process.env
): string {
  const configured = env.ANYKPI_RESEARCH_SEARCH_URL?.trim();
  return configured && configured.length > 0
    ? configured
    : DEFAULT_WEB_SEARCH_ENDPOINT;
}

export function buildWebSearchUrl(
  query: string,
  endpoint = DEFAULT_WEB_SEARCH_ENDPOINT
): string {
  const url = new URL(endpoint);
  url.searchParams.set("q", query);
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

function asResultList(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  const brave = obj.web;
  if (brave && typeof brave === "object") {
    const results = (brave as { results?: unknown }).results;
    if (Array.isArray(results)) return results;
  }
  if (Array.isArray(obj.results)) return obj.results;
  if (Array.isArray(obj.organic)) return obj.organic;
  return [];
}

export function parseWebSearchPayload(payload: unknown): ResearchClaim[] {
  const results = asResultList(payload);
  const claims: ResearchClaim[] = [];
  for (let i = 0; i < results.length && claims.length < 5; i++) {
    const item = results[i];
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (title.length === 0) continue;
    const description =
      typeof rec.description === "string"
        ? rec.description
        : typeof rec.snippet === "string"
          ? rec.snippet
          : typeof rec.content === "string"
            ? rec.content
            : "";
    const url =
      typeof rec.url === "string"
        ? rec.url
        : typeof rec.link === "string"
          ? rec.link
          : undefined;
    let hostname = WEB_SEARCH_SOURCE;
    if (url) {
      try {
        hostname = new URL(url).hostname;
      } catch {
        hostname = WEB_SEARCH_SOURCE;
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

/**
 * Keep only sourced claims that already carry a confidence marker.
 * Never invent a title or upgrade confidence.
 */
export function bindResearchClaims(claims: ResearchClaim[]): ResearchClaim[] {
  const bound: ResearchClaim[] = [];
  for (const claim of claims) {
    if (typeof claim.title !== "string" || claim.title.trim().length === 0) continue;
    if (!CLAIM_CONFIDENCE.has(claim.confidence)) continue;
    bound.push({
      title: claim.title,
      source: claim.source,
      ...(claim.url ? { url: claim.url } : {}),
      confidence: claim.confidence,
    });
    if (bound.length >= 5) break;
  }
  return bound;
}

async function searchEncyclopedia(
  query: string,
  fetchImpl: ResearchFetch
): Promise<ResearchClaim[]> {
  const response = await fetchImpl(buildResearchUrl(query), {
    method: "GET",
    headers: defaultHeaders(),
  });
  if (!response.ok) return [];
  return bindResearchClaims(parseOpenSearchPayload(await response.json()));
}

async function searchWeb(
  query: string,
  fetchImpl: ResearchFetch,
  env: ResearchEnv | NodeJS.ProcessEnv
): Promise<ResearchClaim[]> {
  const key = researchSearchKey(env);
  if (!key) return [];
  const endpoint = researchSearchEndpoint(env);
  if (!operatorFetchUrlAllowed(endpoint)) {
    throw new Error("blocked-search-url");
  }
  const response = await fetchImpl(buildWebSearchUrl(query, endpoint), {
    method: "GET",
    headers: {
      ...defaultHeaders(),
      Authorization: `Bearer ${key}`,
      "X-Subscription-Token": key,
    },
  });
  if (!response.ok) {
    throw new Error("web-search-http");
  }
  return bindResearchClaims(parseWebSearchPayload(await response.json()));
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
  const env: ResearchEnv | NodeJS.ProcessEnv = options.env ?? process.env;
  const provider = resolveResearchProvider(env);
  let claims: ResearchClaim[] = [];
  let source = PUBLIC_RESEARCH_SOURCE;
  try {
    if (provider === "web_search") {
      try {
        claims = await searchWeb(query, fetchImpl, env);
        source = WEB_SEARCH_SOURCE;
      } catch {
        try {
          claims = await searchEncyclopedia(query, fetchImpl);
          source = PUBLIC_RESEARCH_SOURCE;
        } catch {
          return { ok: false, error: "Web search did not respond." };
        }
      }
    } else {
      claims = await searchEncyclopedia(query, fetchImpl);
    }
  } catch {
    return { ok: false, error: "Public source did not respond." };
  }

  claims = bindResearchClaims(claims);

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
    source,
  };
  writeCachedResearch(result, path);
  return { ok: true, result };
}
