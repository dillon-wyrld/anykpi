import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq, and } from "drizzle-orm";

const VALUE_EVENT_CLASSES = ["core", "search", "share", "pay"];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, event, properties, timestamp, workspaceId = "live" } = body;

    if (!userId || !event) {
      return NextResponse.json(
        { error: "userId and event are required" },
        { status: 400 }
      );
    }

    const personId = `person_${userId}`;
    const eventDate = new Date(timestamp || Date.now());
    const dateKey = new Date(eventDate);
    dateKey.setHours(0, 0, 0, 0);

    const config = await db
      .select()
      .from(schema.config)
      .where(
        and(
          eq(schema.config.key, "value_events"),
          eq(schema.config.workspaceId, workspaceId)
        )
      )
      .get();

    const valueEvents = config ? JSON.parse(config.value) : {};

    let eventClass = null;
    for (const [className, eventList] of Object.entries(valueEvents) as [string, string[]][]) {
      if (eventList.includes(event)) {
        eventClass = className;
        break;
      }
    }

    const existing = await db
      .select()
      .from(schema.activity)
      .where(
        and(
          eq(schema.activity.personId, personId),
          eq(schema.activity.date, dateKey),
          eq(schema.activity.workspaceId, workspaceId)
        )
      )
      .get();

    if (existing) {
      const updates: any = {
        minutes: existing.minutes + (properties?.duration || 1),
      };

      if (eventClass) {
        const countKey = `${eventClass}Count` as keyof typeof existing;
        updates[countKey] = ((existing[countKey] as number) || 0) + 1;
      }

      await db
        .update(schema.activity)
        .set(updates)
        .where(eq(schema.activity.id, existing.id))
        .run();
    } else {
      const counts: any = {
        coreCount: 0,
        searchCount: 0,
        shareCount: 0,
        payCount: 0,
      };

      if (eventClass) {
        counts[`${eventClass}Count`] = 1;
      }

      await db.insert(schema.activity).run({
        personId,
        date: dateKey,
        ...counts,
        minutes: properties?.duration || 1,
        workspaceId,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Event error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
