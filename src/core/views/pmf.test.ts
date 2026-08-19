import { describe, expect, it } from "vitest";
import type { ResearchResult } from "@/core/contracts";
import {
  buildPmfOutreachMessage,
  demoPmfRuns,
  generatePmfQueue,
  pmfCardFields,
  pmfProgressPct,
  pmfRunFromResearch,
  pmfRunTotals,
} from "./pmf";

describe("demo PMF card fields", () => {
  const runs = demoPmfRuns();
  const run = runs[0];
  const byId = Object.fromEntries(run.people.map((p) => [p.personId, p]));

  it("ships the power-user run with Dave, Mia, and Nova", () => {
    expect(run.id).toBe("run_power_users");
    expect(run.progress).toBe(3);
    expect(run.totalPeople).toBe(3);
    expect(pmfProgressPct(run.progress, run.totalPeople)).toBe(100);
    expect(run.people.map((p) => p.personId)).toEqual(["dave", "mia", "nova"]);
  });

  it("pins every field on Dave's card", () => {
    const card = pmfCardFields(byId.dave);
    expect(card).toMatchObject({
      name: "Dave",
      emoji: "🧢",
      platform: "web",
      country: "US",
      income: "$95K/yr",
      verified: true,
      role: "backend engineer",
      org: "Stackline",
      city: "Austin",
      linkCount: 2,
      claimCount: 2,
      questionCount: 3,
    });
    expect(card.signal).toContain("7 active days");
    expect(card.read).toContain("morning routine");
    expect(card.play).toContain("opposite pattern");
    expect(card.questions).toHaveLength(3);
  });

  it("pins Mia and Nova's on-screen identity fields", () => {
    expect(pmfCardFields(byId.mia)).toMatchObject({
      name: "Mia",
      emoji: "🎧",
      platform: "iOS",
      country: "FR",
      income: "$68K/yr",
      role: "product designer",
      city: "Paris",
    });
    expect(pmfCardFields(byId.nova)).toMatchObject({
      name: "Nova",
      emoji: "🚀",
      platform: "web",
      country: "GB",
      income: "$120K/yr",
      role: "startup founder",
      city: "London",
    });
  });

  it("rolls the group card: Daily × 2, Weekender × 1, still here 3", () => {
    expect(run.groupRollup).toEqual({
      segments: [
        { name: "Daily", count: 2 },
        { name: "Weekender", count: 1 },
      ],
      stillHere: 3,
      gone: 0,
      resonatingWith: "Daily",
    });
    expect(
      run.groupRollup!.segments.reduce((s, seg) => s + seg.count, 0)
    ).toBe(run.people.length);
  });
});

describe("research card", () => {
  it("maps a cached public-source result onto one person card", () => {
    const result: ResearchResult = {
      personId: "p-river",
      name: "River",
      workspace: "demo",
      queriedAt: "2026-08-19T12:00:00.000Z",
      query: "River GB",
      outgoing: [
        { field: "name", value: "River" },
        { field: "country", value: "GB" },
      ],
      claims: [
        {
          title: "River — a public page",
          source: "example.test",
          url: "https://example.test/wiki/River",
          confidence: "medium",
        },
      ],
      verified: true,
      cached: true,
      source: "public encyclopedia",
    };
    const run = pmfRunFromResearch(result, { emoji: "🌊", platform: "web" });
    expect(run.people).toHaveLength(1);
    expect(run.people[0]).toMatchObject({
      personId: "p-river",
      name: "River",
      country: "GB",
      platform: "web",
      verified: true,
    });
    expect(pmfCardFields(run.people[0])).toMatchObject({
      name: "River",
      country: "GB",
      claimCount: 1,
      linkCount: 1,
    });
    expect(run.people[0].signal).toContain("cached locally");
  });
});

describe("outreach + header counts", () => {
  it("writes the gift-card line and the swag-box line without sending", () => {
    const card = { name: "Dave Chen" };
    expect(
      buildPmfOutreachMessage(card, {
        includeGift: true,
        giftAmount: "25",
        giftType: "gift card",
      })
    ).toContain("hey Dave");
    expect(
      buildPmfOutreachMessage(card, {
        includeGift: true,
        giftAmount: "25",
        giftType: "gift card",
      })
    ).toContain("$25 gift card");
    expect(
      buildPmfOutreachMessage(card, {
        includeGift: true,
        giftAmount: "25",
        giftType: "swag box",
      })
    ).toContain("swag box");
    expect(
      buildPmfOutreachMessage(card, {
        includeGift: false,
        giftAmount: "25",
        giftType: "gift card",
      })
    ).not.toContain("$25");
  });

  it("queues one waiting draft per person", () => {
    const run = demoPmfRuns()[0];
    const queue = generatePmfQueue(run, {
      includeGift: true,
      giftAmount: "25",
      giftType: "gift card",
    });
    expect(queue).toHaveLength(3);
    expect(queue.every((d) => d.state === "waiting")).toBe(true);
    expect(queue.map((d) => d.personId)).toEqual(["dave", "mia", "nova"]);

    const totals = pmfRunTotals([{ ...run, queue }]);
    expect(totals).toEqual({
      runCount: 1,
      peopleResearched: 3,
      queuedTotal: 3,
      waitingCount: 3,
    });
  });
});
