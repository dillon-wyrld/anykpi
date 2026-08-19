import { z } from "zod";

const FilterSchema = z.object({
  field: z.string(),
  operator: z.enum(["eq", "ne", "in", "gt", "lt", "gte", "lte"]),
  value: z.union([z.string(), z.number(), z.array(z.string())]),
});

const DotPlotStateSchema = z.object({
  view: z.literal("dotplot"),
  filters: z.array(FilterSchema).optional(),
  groupBy: z.enum(["none", "platform", "country", "cohort", "account"]).optional(),
  zoom: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    users: z.array(z.string()).optional(),
  }).optional(),
});

const CohortsStateSchema = z.object({
  view: z.literal("cohorts"),
  grain: z.enum(["week", "month"]).optional(),
  filters: z.array(FilterSchema).optional(),
});

const WBRStateSchema = z.object({
  view: z.literal("wbr"),
  mode: z.enum(["deck", "focus", "table"]).optional(),
  metricId: z.string().optional(),
  filters: z.array(FilterSchema).optional(),
});

const CalendarStateSchema = z.object({
  view: z.literal("calendar"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sources: z.array(z.string()).optional(),
});

const PMFStateSchema = z.object({
  view: z.literal("pmf"),
  userIds: z.array(z.string()).optional(),
  filters: z.array(FilterSchema).optional(),
});

export const ViewStateSchema = z.union([
  DotPlotStateSchema,
  CohortsStateSchema,
  WBRStateSchema,
  CalendarStateSchema,
  PMFStateSchema,
]);

export type ViewState = z.infer<typeof ViewStateSchema>;
export type Filter = z.infer<typeof FilterSchema>;

export function encodeViewState(state: ViewState): string {
  const json = JSON.stringify(state);
  if (typeof window !== "undefined") {
    return btoa(json);
  }
  return Buffer.from(json).toString("base64");
}

export function decodeViewState(encoded: string): ViewState | null {
  try {
    let json: string;
    if (typeof window !== "undefined") {
      json = atob(encoded);
    } else {
      json = Buffer.from(encoded, "base64").toString("utf-8");
    }
    const parsed = JSON.parse(json);
    return ViewStateSchema.parse(parsed);
  } catch {
    return null;
  }
}

export function buildViewUrl(baseUrl: string, state: ViewState): string {
  const encoded = encodeViewState(state);
  return `${baseUrl}?state=${encoded}`;
}

export type RequestLike = { headers: { get(name: string): string | null }; url?: string };

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function protocolFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const proto = new URL(url).protocol.replace(/:$/, "");
    return proto.length > 0 ? proto : null;
  } catch {
    return null;
  }
}

function originFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * Origin used in API `view_url` values.
 *
 * `PUBLIC_BASE_URL` is the only explicit override. Otherwise the origin is
 * derived from `X-Forwarded-Host` / `X-Forwarded-Proto` / `Host`.
 * `NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_API_URL` are not read — those are
 * inlined at build time and cannot configure a pulled Docker image.
 */
export function publicBaseUrl(request?: RequestLike): string {
  const pinned = process.env.PUBLIC_BASE_URL?.trim();
  if (pinned) {
    return pinned.replace(/\/+$/, "");
  }

  if (!request) {
    return "http://localhost:3000";
  }

  const host =
    firstHeaderValue(request.headers.get("x-forwarded-host")) ??
    firstHeaderValue(request.headers.get("host"));

  const proto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ??
    protocolFromUrl(request.url) ??
    (host && !/^(localhost|127\.0\.0\.1)(:|$)/i.test(host) ? "https" : "http");

  if (host) {
    return `${proto}://${host}`;
  }

  return originFromUrl(request.url) ?? "http://localhost:3000";
}

function trimOrigin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Dashboard URL that opens the person panel for one user. */
export function personViewUrl(
  baseUrl: string,
  workspace: string,
  personId: string
): string {
  const params = new URLSearchParams({
    workspace,
    view: "dotplot",
    user: personId,
  });
  return `${trimOrigin(baseUrl)}/dashboard?${params.toString()}`;
}

export function usersViewUrl(baseUrl: string, workspace: string): string {
  const params = new URLSearchParams({
    workspace,
    view: "dotplot",
  });
  return `${trimOrigin(baseUrl)}/dashboard?${params.toString()}`;
}

export type QueryUserRow = {
  personId: string;
  name: string;
  emoji?: string | null;
  platform?: string | null;
  country?: string | null;
  cluster?: string | null;
};

/** MCP `query_users` payload: each row carries a deep-link `view_url`. */
export function queryUsersPayload(
  users: QueryUserRow[],
  baseUrl: string,
  workspace: string
) {
  return {
    users: users.map((user) => ({
      personId: user.personId,
      name: user.name,
      emoji: user.emoji ?? null,
      platform: user.platform ?? null,
      country: user.country ?? null,
      cluster: user.cluster ?? null,
      view_url: personViewUrl(baseUrl, workspace, user.personId),
    })),
    view_url: usersViewUrl(baseUrl, workspace),
  };
}
