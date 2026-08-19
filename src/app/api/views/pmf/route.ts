import { NextRequest, NextResponse } from "next/server";

/**
 * PMF+ View API
 * 
 * Returns simulated research runs with queued drafts.
 * Nothing sends on its own - all drafts wait in queue.
 */

interface PMFRun {
  id: string;
  target: string;
  targetEmoji: string;
  status: "running" | "complete";
  cardsCount: number;
  queuedCount: number;
  cards?: Array<{
    name: string;
    emoji: string;
    headline: string;
    sources: string[];
  }>;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspace = searchParams.get("workspace") || "demo";

  // For demo workspace, show simulated PMF research runs
  if (workspace === "demo") {
    const runs: PMFRun[] = [
      {
        id: "run_dave_group",
        target: "Power Users (Dave, Mia, Nova)",
        targetEmoji: "🔥",
        status: "complete",
        cardsCount: 3,
        queuedCount: 2,
        cards: [
          {
            name: "Dave",
            emoji: "🧢",
            headline: "Backend eng, posts on HN weekly",
            sources: ["github", "hn", "twitter"]
          },
          {
            name: "Mia",
            emoji: "🎧",
            headline: "Product designer, runs local meetup",
            sources: ["dribbble", "twitter", "medium"]
          },
          {
            name: "Nova",
            emoji: "🚀",
            headline: "Founder, public build log",
            sources: ["twitter", "substack"]
          }
        ]
      }
    ];

    return NextResponse.json({ runs });
  }

  // For live workspace, return empty (no auto-research without explicit trigger)
  return NextResponse.json({ runs: [] });
}
