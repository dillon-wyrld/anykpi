import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth";
import { internalError, logServerError } from "@/core/errors";

/**
 * PMF+ View API
 * 
 * Returns simulated research runs with persona findings.
 * For demo workspace, shows pre-generated cards.
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspace = searchParams.get("workspace") || "demo";
  const denied = await requireAuth(request, { workspace, write: false });
  if (denied) return denied;

  try {

  // For demo workspace, show simulated PMF research runs
  if (workspace === "demo") {
    const runs = [
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
            { name: "Weekender", count: 1 }
          ],
          stillHere: 3,
          gone: 0,
          resonatingWith: "Daily"
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
              { type: "github", value: "gh/dave" }
            ],
            claims: [
              { title: "Maintains an OSS analytics lib", source: "github bio", confidence: "high", content: false },
              { title: "Posts on HN weekly", source: "hn profile", confidence: "high", content: true }
            ],
            behavior: "on a 42-day streak",
            signal: "7 active days a week, peak use is 7-9am (before standup)",
            read: "this lives in his morning routine, between coffee and meetings. reliable, sticky behavior.",
            play: "ask what else he's tried that didn't stick — the opposite pattern tells you what this does differently.",
            questions: [
              "Does this connect to your github work at all, or is it separate?",
              "You seem to have a rhythm with this — what keeps it going?",
              "If it disappeared tomorrow, what would you miss?"
            ]
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
              { type: "dribbble", value: "mia" }
            ],
            claims: [
              { title: "Runs a local design meetup", source: "meetup.com", confidence: "high", content: false },
              { title: "Writes about UX patterns", source: "medium", confidence: "medium", content: true }
            ],
            behavior: "in every weekend, invisible on weekdays",
            signal: "Saturday/Sunday only, 2-4pm blocks",
            read: "weekends are when this actually fits for her. not a work tool — something else.",
            play: "what would make this useful on a Tuesday? or is weekend-only the right fit?",
            questions: [
              "When you pass something from here on to someone, who is it usually?",
              "What would make this useful on a Tuesday?",
              "What's the moment you reach for it?"
            ]
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
              { type: "substack", value: "nova.substack.com" }
            ],
            claims: [
              { title: "Building in public, 18-month log", source: "substack", confidence: "high", content: true },
              { title: "Raised pre-seed Q3 last year", source: "crunchbase", confidence: "high", content: false }
            ],
            behavior: "on a 28-day streak",
            signal: "Mon-Fri, heavy burst days around Wed/Thu",
            read: "crunch tool more than daily habit — intensity spikes mid-week, probably matches her sprint rhythm.",
            play: "learn when the spikes happen: is it team sync prep, investor updates, or something else?",
            questions: [
              "This seems to matter a lot some weeks and not at all in others — what starts a week like that?",
              "What tipped you into paying?",
              "If we changed one thing this month, what should it be?"
            ]
          }
        ],
        queue: []
      }
    ];

    return NextResponse.json({ runs });
  }

  // For live workspace, return empty (no auto-research without explicit trigger)
  return NextResponse.json({ runs: [] });
  } catch {
    logServerError("PMF view failed");
    return internalError();
  }
}
