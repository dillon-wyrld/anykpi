import {
  encodeViewState,
  type Filter,
  type ViewState,
} from "./view-state";

/**
 * Instant ask parser — port of `runQuery` in spec/prototype.html.
 *
 * Country tokens use word boundaries so "us" does not match "users".
 * Platforms stay substring matches, same as the prototype.
 * No LLM. Unparseable input is null; the bar nudges instead of narrating.
 */

const COUNTRY_ALIASES: Array<[string, string]> = [
  ["france", "FR"],
  ["fr", "FR"],
  ["us", "US"],
  ["usa", "US"],
  ["america", "US"],
  ["germany", "DE"],
  ["japan", "JP"],
  ["uk", "GB"],
  ["brazil", "BR"],
];

const COUNTRY_FLAGS: Record<string, string> = {
  US: "🇺🇸",
  FR: "🇫🇷",
  DE: "🇩🇪",
  GB: "🇬🇧",
  BR: "🇧🇷",
  JP: "🇯🇵",
  IN: "🇮🇳",
  CA: "🇨🇦",
};

const PMF_START =
  /\b(run|start|make|generate|do)\b.*\bpmf\b|\bpmf\b.*\b(cards?|runs?)\b|^research\b/;

export type AskUser = {
  name?: string | null;
  platform?: string | null;
  country?: string | null;
  incomeK?: number | null;
  isNew?: boolean;
  churned?: boolean;
  lastSeen?: number | null;
  paid?: boolean;
  active?: number | null;
};

export function askFilterLabel(filter: Filter): string {
  if (filter.field === "platform" && filter.operator === "eq") {
    return `platform is ${filter.value}`;
  }
  if (filter.field === "country" && filter.operator === "eq") {
    const code = String(filter.value);
    return `country is ${COUNTRY_FLAGS[code] ?? ""}${code}`;
  }
  if (filter.field === "incomeK" && filter.operator === "gt") {
    return `income > $${filter.value}K`;
  }
  if (filter.field === "isNew") return "is new";
  if (filter.field === "churnRisk") return "state is churn-risk";
  if (filter.field === "churned" && filter.operator === "eq") {
    return "state is churn-risk";
  }
  if (filter.field === "paid") return "is paid";
  if (filter.field === "active") return `active >= ${filter.value}`;
  return `${filter.field} ${filter.operator} ${String(filter.value)}`;
}

export function userMatchesFilter(user: AskUser, filter: Filter): boolean {
  const raw = userValue(user, filter.field);
  if (filter.field === "churnRisk") {
    return user.churned === true || (user.lastSeen ?? -1) > 7;
  }
  return compare(raw, filter.operator, filter.value);
}

export function userMatchesFilters(user: AskUser, filters: Filter[]): boolean {
  return filters.every((filter) => userMatchesFilter(user, filter));
}

export function filtersOf(state: ViewState): Filter[] {
  return "filters" in state && state.filters ? state.filters : [];
}

function userValue(user: AskUser, field: string): string | number | boolean | null {
  switch (field) {
    case "platform":
      return user.platform ?? null;
    case "country":
      return user.country ?? null;
    case "incomeK":
      return user.incomeK ?? null;
    case "isNew":
      return user.isNew === true;
    case "churned":
      return user.churned === true;
    case "paid":
      return user.paid === true;
    case "active":
      return user.active ?? null;
    case "lastSeen":
      return user.lastSeen ?? null;
    default:
      return null;
  }
}

function compare(
  raw: string | number | boolean | null,
  operator: Filter["operator"],
  value: Filter["value"]
): boolean {
  if (raw === null || raw === undefined) return false;
  if (operator === "in") {
    const set = Array.isArray(value) ? value : [String(value)];
    return set.map(String).includes(String(raw));
  }
  const left = typeof raw === "boolean" ? (raw ? 1 : 0) : raw;
  const right = typeof value === "string" && value !== "" && !Number.isNaN(Number(value))
    ? coerce(left, value)
    : (value as string | number);
  switch (operator) {
    case "eq":
      return left === right || String(left) === String(value);
    case "ne":
      return left !== right && String(left) !== String(value);
    case "gt":
      return Number(left) > Number(right);
    case "lt":
      return Number(left) < Number(right);
    case "gte":
      return Number(left) >= Number(right);
    case "lte":
      return Number(left) <= Number(right);
    default:
      return false;
  }
}

function coerce(left: string | number, value: string): string | number {
  return typeof left === "number" ? Number(value) : value;
}

function wordHas(q: string, token: string): boolean {
  return new RegExp(`\\b${token}\\b`).test(q);
}

function platformOf(q: string): "ios" | "android" | "web" | null {
  if (q.includes("ios")) return "ios";
  if (q.includes("android")) return "android";
  if (q.includes("web")) return "web";
  return null;
}

function countryOf(q: string): string | null {
  for (const [alias, code] of COUNTRY_ALIASES) {
    if (wordHas(q, alias)) return code;
  }
  return null;
}

function eqFilter(field: string, value: string | number): Filter {
  return { field, operator: "eq", value };
}

function pmfStartState(q: string): ViewState {
  if (q.includes("churn")) {
    return { view: "pmf", filters: [eqFilter("churned", 1)] };
  }
  if (q.includes("risk") || q.includes("seat")) {
    return { view: "pmf", filters: [eqFilter("atRisk", 1)] };
  }
  if (
    q.includes("ideal") ||
    q.includes("best") ||
    q.includes("power") ||
    q.includes("paying")
  ) {
    return {
      view: "pmf",
      filters: [
        eqFilter("paid", 1),
        { field: "churned", operator: "ne", value: 1 },
        { field: "active", operator: "gte", value: 15 },
      ],
    };
  }
  return { view: "pmf" };
}

/** Map a plain-English phrase to a view-state. Null = miss. */
export function parseAskQuery(input: string): ViewState | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;

  if (PMF_START.test(q)) return pmfStartState(q);

  if (q.includes("smil") || q.includes("pmf") || q.includes("market fit")) {
    return { view: "cohorts" };
  }
  if (q.includes("cohort")) return { view: "cohorts" };
  if (q.includes("wbr") || q.includes("review") || q.includes("revenue")) {
    return { view: "wbr" };
  }
  if (q.includes("calendar") || q.includes("birthday") || q.includes("launch")) {
    return { view: "calendar" };
  }
  if (
    q.includes("seat") ||
    q.includes("risk") ||
    q.includes("b2b") ||
    q.includes("initech") ||
    q.includes("globex")
  ) {
    return { view: "dotplot", groupBy: "account" };
  }
  if (q.includes("churn")) {
    return {
      view: "dotplot",
      groupBy: "none",
      filters: [eqFilter("churnRisk", 1)],
    };
  }

  const filters: Filter[] = [];
  const plat = platformOf(q);
  const ctry = countryOf(q);
  const inc = q.match(/(\d+)\s*k/);
  if (plat) filters.push(eqFilter("platform", plat));
  if (ctry) filters.push(eqFilter("country", ctry));
  if (inc && (q.includes(">") || q.includes("more than") || q.includes("over"))) {
    const amount = Number(inc[1]);
    filters.push({ field: "incomeK", operator: "gt", value: amount });
  }
  if (q.includes("new user") || q.includes("newbies")) {
    filters.push(eqFilter("isNew", 1));
  }
  if (!filters.length) return null;
  return { view: "dotplot", groupBy: "none", filters };
}

export type AskSearchExtras = {
  wall?: boolean;
};

/**
 * Dashboard path for an ask hit: section + compact params the views
 * already read, plus the view-state codec (`state=`).
 */
export function askDashboardPath(
  workspace: string,
  state: ViewState,
  extras: AskSearchExtras = {}
): string {
  const params = new URLSearchParams();
  params.set("workspace", workspace);
  params.set("view", state.view);
  if (extras.wall) params.set("w", "1");
  if (state.view === "dotplot" && state.groupBy) {
    params.set("g", state.groupBy);
  }
  if (state.view === "dotplot" && state.filters?.length) {
    params.set("f", state.filters.map(askFilterLabel).join("|"));
  }
  if (state.view === "cohorts" && state.split) {
    params.set("split", state.split);
  }
  params.set("state", encodeViewState(state));
  return `/dashboard?${params.toString()}`;
}
