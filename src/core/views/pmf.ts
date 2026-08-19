/**
 * PMF+ card fields and outreach copy — every number on the PMF screen.
 */

import type { ResearchResult } from "@/core/contracts";

export type PmfConfidence = "high" | "medium" | "low";
export type PmfDraftState = "waiting" | "edited" | "approved";

export interface PmfClaim {
  title: string;
  source: string;
  confidence: PmfConfidence;
  content: boolean;
}

export interface PmfPerson {
  personId: string;
  name: string;
  emoji: string;
  platform: string;
  country: string;
  income: string;
  verified: boolean;
  role?: string;
  org?: string;
  city?: string;
  interests: string[];
  links: Array<{ type: string; value: string }>;
  claims: PmfClaim[];
  behavior: string;
  signal: string;
  read: string;
  play: string;
  questions: string[];
}

export interface PmfDraft {
  personId: string;
  message: string;
  state: PmfDraftState;
}

export interface PmfGroupRollup {
  segments: Array<{ name: string; count: number }>;
  stillHere: number;
  gone: number;
  resonatingWith?: string;
}

export interface PmfRun {
  id: string;
  title: string;
  emoji: string;
  status: "researching" | "done";
  progress: number;
  totalPeople: number;
  people: PmfPerson[];
  queue: PmfDraft[];
  isGroup: boolean;
  groupRollup?: PmfGroupRollup;
}

export function pmfProgressPct(progress: number, totalPeople: number): number {
  return totalPeople ? (progress / totalPeople) * 100 : 0;
}

export function pmfCardFields(person: PmfPerson): {
  personId: string;
  name: string;
  emoji: string;
  platform: string;
  country: string;
  income: string;
  verified: boolean;
  role?: string;
  org?: string;
  city?: string;
  linkCount: number;
  claimCount: number;
  questionCount: number;
  signal: string;
  read: string;
  play: string;
  questions: string[];
} {
  return {
    personId: person.personId,
    name: person.name,
    emoji: person.emoji,
    platform: person.platform,
    country: person.country,
    income: person.income,
    verified: person.verified,
    role: person.role,
    org: person.org,
    city: person.city,
    linkCount: person.links.length,
    claimCount: person.claims.length,
    questionCount: person.questions.length,
    signal: person.signal,
    read: person.read,
    play: person.play,
    questions: person.questions,
  };
}

export function pmfRunTotals(runs: PmfRun[]): {
  runCount: number;
  peopleResearched: number;
  queuedTotal: number;
  waitingCount: number;
} {
  return {
    runCount: runs.length,
    peopleResearched: runs.reduce((sum, r) => sum + r.people.length, 0),
    queuedTotal: runs.reduce((sum, r) => sum + r.queue.length, 0),
    waitingCount: runs.reduce(
      (sum, r) => sum + r.queue.filter((d) => d.state === "waiting").length,
      0
    ),
  };
}

export function buildPmfOutreachMessage(
  person: Pick<PmfPerson, "name">,
  opts: { includeGift: boolean; giftAmount: string; giftType: string }
): string {
  const first = person.name.split(" ")[0];
  const giftLine = !opts.includeGift
    ? ""
    : opts.giftType === "swag box"
      ? " (we'll send a swag box for your trouble either way.)"
      : ` (there's a $${opts.giftAmount} ${opts.giftType} for your time too — though I'd be asking regardless.)`;

  return `hey ${first} — I'd love to understand how this is actually fitting into your week (or not fitting). any chance you'd give me 15 minutes? it would genuinely mean the world.${giftLine}`;
}

export function generatePmfQueue(
  run: PmfRun,
  opts: { includeGift: boolean; giftAmount: string; giftType: string }
): PmfDraft[] {
  return run.people.map((person) => ({
    personId: person.personId,
    message: buildPmfOutreachMessage(person, opts),
    state: "waiting" as const,
  }));
}

export function pmfRunFromResearch(
  result: ResearchResult,
  extras: { emoji?: string | null; platform?: string | null } = {}
): PmfRun {
  const links = result.claims
    .filter((claim) => claim.url)
    .map((claim) => ({ type: claim.source, value: claim.url as string }));

  return {
    id: `research_${result.workspace}_${result.personId}`,
    title: result.cached
      ? `${result.name} (cached)`
      : `${result.name}`,
    emoji: extras.emoji || "✨",
    status: "done",
    progress: 1,
    totalPeople: 1,
    isGroup: false,
    people: [
      {
        personId: result.personId,
        name: result.name,
        emoji: extras.emoji || "✨",
        platform: extras.platform || "",
        country: result.outgoing.find((field) => field.field === "country")?.value || "",
        income: "",
        verified: result.verified,
        interests: [],
        links,
        claims: result.claims.map((claim) => ({
          title: claim.title,
          source: claim.source,
          confidence: claim.confidence,
          content: Boolean(claim.url),
        })),
        behavior: "",
        signal: result.cached
          ? "cached locally — no new query left this machine"
          : "researched from a public source after the outgoing fields were approved",
        read: result.verified
          ? "public pages matched the approved fields. treat every claim as a lead, not a fact."
          : "couldn't verify — no matching public pages for the approved fields",
        play: "read the sources, then decide if a conversation is worth it",
        questions: [
          "Does any of this public work connect to how you use this?",
          "If it disappeared tomorrow, what would you miss?",
        ],
      },
    ],
    queue: [],
  };
}

export function demoPmfRuns(): PmfRun[] {
  return [
    {
      id: "run_power_users",
      title: "Power Users (Dave, Mia, Nova)",
      emoji: "🔥",
      status: "done",
      progress: 3,
      totalPeople: 3,
      isGroup: true,
      groupRollup: {
        segments: [
          { name: "Daily", count: 2 },
          { name: "Weekender", count: 1 },
        ],
        stillHere: 3,
        gone: 0,
        resonatingWith: "Daily",
      },
      people: [
        {
          personId: "dave",
          name: "Dave",
          emoji: "🧢",
          platform: "web",
          country: "US",
          income: "$95K/yr",
          verified: true,
          role: "backend engineer",
          org: "Stackline",
          city: "Austin",
          interests: ["trail running", "3D printing"],
          links: [
            { type: "linkedin", value: "in/dave" },
            { type: "github", value: "gh/dave" },
          ],
          claims: [
            {
              title: "Maintains an OSS analytics lib",
              source: "github bio",
              confidence: "high",
              content: false,
            },
            {
              title: "Posts on HN weekly",
              source: "hn profile",
              confidence: "high",
              content: true,
            },
          ],
          behavior: "on a 42-day streak",
          signal: "7 active days a week, peak use is 7-9am (before standup)",
          read: "this lives in his morning routine, between coffee and meetings. reliable, sticky behavior.",
          play: "ask what else he's tried that didn't stick — the opposite pattern tells you what this does differently.",
          questions: [
            "Does this connect to your github work at all, or is it separate?",
            "You seem to have a rhythm with this — what keeps it going?",
            "If it disappeared tomorrow, what would you miss?",
          ],
        },
        {
          personId: "mia",
          name: "Mia",
          emoji: "🎧",
          platform: "iOS",
          country: "FR",
          income: "$68K/yr",
          verified: true,
          role: "product designer",
          org: "Brightside Co",
          city: "Paris",
          interests: ["film photography", "vinyl hunting"],
          links: [
            { type: "linkedin", value: "in/mia" },
            { type: "dribbble", value: "mia" },
          ],
          claims: [
            {
              title: "Runs a local design meetup",
              source: "meetup.com",
              confidence: "high",
              content: false,
            },
            {
              title: "Writes about UX patterns",
              source: "medium",
              confidence: "medium",
              content: true,
            },
          ],
          behavior: "in every weekend, invisible on weekdays",
          signal: "Saturday/Sunday only, 2-4pm blocks",
          read: "weekends are when this actually fits for her. not a work tool — something else.",
          play: "what would make this useful on a Tuesday? or is weekend-only the right fit?",
          questions: [
            "When you pass something from here on to someone, who is it usually?",
            "What would make this useful on a Tuesday?",
            "What's the moment you reach for it?",
          ],
        },
        {
          personId: "nova",
          name: "Nova",
          emoji: "🚀",
          platform: "web",
          country: "GB",
          income: "$120K/yr",
          verified: true,
          role: "startup founder",
          org: "Loop & Lark",
          city: "London",
          interests: ["blitz chess", "gravel cycling"],
          links: [
            { type: "linkedin", value: "in/nova" },
            { type: "twitter", value: "@nova" },
            { type: "substack", value: "nova.substack.com" },
          ],
          claims: [
            {
              title: "Building in public, 18-month log",
              source: "substack",
              confidence: "high",
              content: true,
            },
            {
              title: "Raised pre-seed Q3 last year",
              source: "crunchbase",
              confidence: "high",
              content: false,
            },
          ],
          behavior: "on a 28-day streak",
          signal: "Mon-Fri, heavy burst days around Wed/Thu",
          read: "crunch tool more than daily habit — intensity spikes mid-week, probably matches her sprint rhythm.",
          play: "learn when the spikes happen: is it team sync prep, investor updates, or something else?",
          questions: [
            "This seems to matter a lot some weeks and not at all in others — what starts a week like that?",
            "What tipped you into paying?",
            "If we changed one thing this month, what should it be?",
          ],
        },
      ],
      queue: [],
    },
  ];
}
