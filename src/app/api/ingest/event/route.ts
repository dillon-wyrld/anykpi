import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";

/**
 * POST /api/ingest/event
 * 
 * Track activity event (SDK or agent)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, event, eventName, properties, timestamp, workspaceId = "live" } = body;

    const actualEventName = eventName || event;
    
    if (!userId || !actualEventName) {
      return NextResponse.json(
        { error: "userId and event/eventName are required" },
        { status: 400 }
      );
    }

    const personId = `person_${userId}`;
    const eventDate = new Date(timestamp || Date.now());
    
    // Map event to class (could be configured via /api/v1/configure/events)
    let eventClass: 'core' | 'search' | 'share' | 'pay' = 'core';
    const eventLower = actualEventName.toLowerCase();
    
    if (eventLower.includes('search') || eventLower.includes('query')) {
      eventClass = 'search';
    } else if (eventLower.includes('share') || eventLower.includes('invite')) {
      eventClass = 'share';
    } else if (eventLower.includes('pay') || eventLower.includes('purchase') || eventLower.includes('subscribe')) {
      eventClass = 'pay';
    }

    await db.insert(schema.activity).values({
      personId,
      timestamp: eventDate,
      eventName: actualEventName,
      eventClass,
      platform: properties?.platform || 'web',
      workspaceId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Event error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
