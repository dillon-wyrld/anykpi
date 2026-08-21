import { describe, expect, it } from "vitest";
import {
  askDashboardPath,
  askFilterLabel,
  filtersOf,
  parseAskQuery,
  userMatchesFilters,
  type AskUser,
} from "./ask";
import { decodeViewState } from "./view-state";

/**
 * Named cast from spec/prototype.html `buildData` (seed 20260806).
 * Canon pin: iOS in France is Jo / Zara / Ines / Axel / Sky.
 */
const CANON: AskUser[] = [
  { name: "Dave", platform: "ios", country: "US", incomeK: 95, isNew: false, paid: false, churned: false, lastSeen: 0, active: 40 },
  { name: "Mia", platform: "android", country: "BR", incomeK: 153, isNew: false, paid: false, churned: false, lastSeen: 0, active: 20 },
  { name: "Jo", platform: "ios", country: "FR", incomeK: 75, isNew: false, paid: true, churned: true, lastSeen: 108, active: 8 },
  { name: "Rex", platform: "web", country: "US", incomeK: 120, isNew: false, paid: true, churned: false, lastSeen: 19, active: 12 },
  { name: "Zara", platform: "ios", country: "FR", incomeK: 28, isNew: false, paid: false, churned: false, lastSeen: 0, active: 18 },
  { name: "Kai", platform: "android", country: "DE", incomeK: 43, isNew: false, paid: false, churned: false, lastSeen: 2, active: 22 },
  { name: "Nova", platform: "web", country: "US", incomeK: 88, isNew: false, paid: true, churned: false, lastSeen: 0, active: 40 },
  { name: "Leo", platform: "ios", country: "GB", incomeK: 97, isNew: false, paid: true, churned: true, lastSeen: 52, active: 6 },
  { name: "Ava", platform: "ios", country: "US", incomeK: 109, isNew: true, paid: true, churned: false, lastSeen: 0, active: 4 },
  { name: "Sam", platform: "web", country: "JP", incomeK: 60, isNew: true, paid: false, churned: false, lastSeen: 1, active: 3 },
  { name: "Ines", platform: "ios", country: "FR", incomeK: 135, isNew: false, paid: true, churned: false, lastSeen: 2, active: 24 },
  { name: "Tom", platform: "web", country: "US", incomeK: 150, isNew: false, paid: true, churned: false, lastSeen: 0, active: 10 },
  { name: "Yuki", platform: "android", country: "DE", incomeK: 95, isNew: false, paid: true, churned: false, lastSeen: 0, active: 16 },
  { name: "Omar", platform: "web", country: "GB", incomeK: 51, isNew: false, paid: false, churned: false, lastSeen: 7, active: 8 },
  { name: "Lena", platform: "ios", country: "GB", incomeK: 64, isNew: false, paid: false, churned: false, lastSeen: 0, active: 40 },
  { name: "Max", platform: "ios", country: "US", incomeK: 145, isNew: false, paid: true, churned: false, lastSeen: 0, active: 40 },
  { name: "Noa", platform: "android", country: "CA", incomeK: 120, isNew: false, paid: false, churned: false, lastSeen: 0, active: 9 },
  { name: "Iris", platform: "android", country: "US", incomeK: 68, isNew: false, paid: true, churned: false, lastSeen: 3, active: 20 },
  { name: "Finn", platform: "web", country: "BR", incomeK: 121, isNew: false, paid: true, churned: false, lastSeen: 0, active: 16 },
  { name: "Ruby", platform: "web", country: "US", incomeK: 101, isNew: false, paid: false, churned: false, lastSeen: 0, active: 14 },
  { name: "Theo", platform: "ios", country: "US", incomeK: 82, isNew: false, paid: false, churned: false, lastSeen: 8, active: 11 },
  { name: "Cleo", platform: "android", country: "US", incomeK: 50, isNew: false, paid: false, churned: false, lastSeen: 4, active: 18 },
  { name: "Axel", platform: "ios", country: "FR", incomeK: 77, isNew: false, paid: true, churned: false, lastSeen: 3, active: 22 },
  { name: "June", platform: "ios", country: "GB", incomeK: 102, isNew: false, paid: false, churned: false, lastSeen: 9, active: 7 },
  { name: "Remy", platform: "ios", country: "US", incomeK: 123, isNew: false, paid: false, churned: false, lastSeen: 0, active: 40 },
  { name: "Sky", platform: "ios", country: "FR", incomeK: 32, isNew: false, paid: false, churned: false, lastSeen: 2, active: 20 },
  { name: "Wren", platform: "ios", country: "US", incomeK: 104, isNew: false, paid: false, churned: false, lastSeen: 7, active: 10 },
  { name: "Ezra", platform: "ios", country: "CA", incomeK: 33, isNew: false, paid: false, churned: false, lastSeen: 1, active: 15 },
  { name: "Lola", platform: "ios", country: "GB", incomeK: 104, isNew: false, paid: true, churned: false, lastSeen: 14, active: 6 },
  { name: "Nico", platform: "web", country: "JP", incomeK: 64, isNew: false, paid: false, churned: false, lastSeen: 0, active: 12 },
  { name: "Vera", platform: "web", country: "BR", incomeK: 140, isNew: false, paid: false, churned: false, lastSeen: 0, active: 40 },
  { name: "Otis", platform: "ios", country: "JP", incomeK: 87, isNew: false, paid: true, churned: false, lastSeen: 16, active: 5 },
  { name: "Pia", platform: "web", country: "IN", incomeK: 40, isNew: false, paid: false, churned: false, lastSeen: 3, active: 18 },
  { name: "Gus", platform: "ios", country: "CA", incomeK: 29, isNew: false, paid: false, churned: false, lastSeen: 0, active: 16 },
  { name: "Mara", platform: "ios", country: "DE", incomeK: 37, isNew: false, paid: true, churned: false, lastSeen: 2, active: 8 },
  { name: "Zeke", platform: "ios", country: "DE", incomeK: 58, isNew: false, paid: false, churned: false, lastSeen: 7, active: 8 },
];

function namesFor(phrase: string): string[] {
  const state = parseAskQuery(phrase);
  expect(state, phrase).not.toBeNull();
  return CANON.filter((user) => userMatchesFilters(user, filtersOf(state!))).map(
    (user) => user.name as string
  );
}

describe("parseAskQuery — canonical phrases", () => {
  it('maps "ios users in france" to Jo, Zara, Ines, Axel, Sky', () => {
    const state = parseAskQuery("ios users in france");
    expect(state).toMatchObject({
      view: "dotplot",
      groupBy: "none",
    });
    expect(filtersOf(state!)).toEqual([
      { field: "platform", operator: "eq", value: "ios" },
      { field: "country", operator: "eq", value: "FR" },
    ]);
    expect(namesFor("ios users in france")).toEqual([
      "Jo",
      "Zara",
      "Ines",
      "Axel",
      "Sky",
    ]);
  });

  it('does not treat "users" as country US (word-boundary)', () => {
    const state = parseAskQuery("ios users");
    expect(filtersOf(state!)).toEqual([
      { field: "platform", operator: "eq", value: "ios" },
    ]);
    expect(namesFor("ios users")).toContain("Dave");
    expect(namesFor("ios users")).toContain("Jo");
    expect(namesFor("ios users")).not.toEqual(namesFor("ios users in the us"));
  });

  it('maps "are we smiling yet?" to cohorts', () => {
    expect(parseAskQuery("are we smiling yet?")).toEqual({ view: "cohorts" });
    expect(parseAskQuery("market fit")).toEqual({ view: "cohorts" });
    expect(parseAskQuery("pmf")).toEqual({ view: "cohorts" });
  });

  it('maps "who churned this week" to quiet users on the dot plot', () => {
    const state = parseAskQuery("who churned this week");
    expect(state).toMatchObject({
      view: "dotplot",
      groupBy: "none",
    });
    expect(filtersOf(state!)).toEqual([
      { field: "churnRisk", operator: "eq", value: 1 },
    ]);
    expect(namesFor("who churned this week")).toEqual([
      "Jo",
      "Rex",
      "Leo",
      "Theo",
      "June",
      "Lola",
      "Otis",
    ]);
  });

  it("routes section phrases to the answering view", () => {
    expect(parseAskQuery("show me the cohorts")).toEqual({ view: "cohorts" });
    expect(parseAskQuery("weekly review")).toEqual({ view: "wbr" });
    expect(parseAskQuery("revenue")).toEqual({ view: "wbr" });
    expect(parseAskQuery("calendar")).toEqual({ view: "calendar" });
    expect(parseAskQuery("next launch")).toEqual({ view: "calendar" });
    expect(parseAskQuery("b2b seats")).toEqual({
      view: "dotplot",
      groupBy: "account",
    });
    expect(parseAskQuery("initech risk")).toEqual({
      view: "dotplot",
      groupBy: "account",
    });
  });

  it("starts a PMF run from an explicit intent, not a bare pmf", () => {
    expect(parseAskQuery("run pmf on churned users")).toEqual({
      view: "pmf",
      filters: [{ field: "churned", operator: "eq", value: 1 }],
    });
    expect(parseAskQuery("pmf cards")).toEqual({ view: "pmf" });
    expect(parseAskQuery("research")).toEqual({ view: "pmf" });
    expect(parseAskQuery("are we smiling yet?")).toEqual({ view: "cohorts" });
  });

  it("parses income and newbie attribute filters", () => {
    expect(filtersOf(parseAskQuery("users over 100k")!)).toEqual([
      { field: "incomeK", operator: "gt", value: 100 },
    ]);
    expect(namesFor("users over 100k")).toEqual(
      CANON.filter((user) => (user.incomeK ?? 0) > 100).map((user) => user.name)
    );
    expect(namesFor("newbies")).toEqual(["Ava", "Sam"]);
  });

  it("misses phrases it cannot map", () => {
    expect(parseAskQuery("")).toBeNull();
    expect(parseAskQuery("   ")).toBeNull();
    expect(parseAskQuery("asdf")).toBeNull();
    expect(parseAskQuery("hello there")).toBeNull();
  });
});

describe("ask view-state URL", () => {
  it("encodes section, filters, and group into a dashboard path", () => {
    const state = parseAskQuery("ios users in france");
    expect(state).not.toBeNull();
    const path = askDashboardPath("demo", state!);
    const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    expect(params.get("workspace")).toBe("demo");
    expect(params.get("view")).toBe("dotplot");
    expect(params.get("g")).toBe("none");
    const filters = filtersOf(state!);
    expect(params.get("f")).toBe(
      [askFilterLabel(filters[0]), askFilterLabel(filters[1])].join("|")
    );
    expect(params.get("f")).toContain("platform is ios");
    expect(params.get("f")).toContain("country is 🇫🇷FR");
    const decoded = decodeViewState(params.get("state")!);
    expect(decoded).toEqual(state);
  });

  it("keeps wall mode when asked from a wall URL", () => {
    const path = askDashboardPath("demo", { view: "cohorts" }, { wall: true });
    expect(path).toContain("w=1");
    expect(path).toContain("view=cohorts");
  });
});
