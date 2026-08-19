import { db } from "@/core/db";
import * as schema from "@/core/schema";
import type { SyncResult } from "@/core/contracts";
import { eq, and } from "drizzle-orm";

export async function syncPostHog(
  workspaceId: string = "live",
  _opts?: { cursor?: string }
): Promise<SyncResult> {
  const apiKey = process.env.POSTHOG_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;

  if (!apiKey) {
    throw new Error("POSTHOG_API_KEY is required");
  }

  const baseUrl = process.env.POSTHOG_HOST || "https://app.posthog.com";

  let rowsSynced = 0;

  try {
    // Sync persons
    const personsResponse = await fetch(
      `${baseUrl}/api/projects/${projectId}/persons/?limit=1000`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!personsResponse.ok) {
      throw new Error(`PostHog API error: ${personsResponse.statusText}`);
    }

    const personsData = await personsResponse.json();

    for (const person of personsData.results || []) {
      const personId = `person_${person.distinct_ids[0]}`;
      
      const existing = await db
        .select()
        .from(schema.users)
        .where(
          and(
            eq(schema.users.personId, personId),
            eq(schema.users.workspaceId, workspaceId)
          )
        )
        .get();

      if (!existing) {
        await db.insert(schema.users).values({
          personId,
          name: person.properties?.name || person.distinct_ids[0],
          email: person.properties?.email || null,
          emoji: person.properties?.emoji || null,
          platform: person.properties?.platform || null,
          country: person.properties?.country || null,
          signupDate: person.created_at ? new Date(person.created_at) : new Date(),
          cluster: null,
          accountId: null,
          workspaceId,
        });
        rowsSynced += 1;
      }
    }

    // Sync events
    const eventsResponse = await fetch(
      `${baseUrl}/api/projects/${projectId}/events/?limit=10000`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!eventsResponse.ok) {
      throw new Error(`PostHog events API error: ${eventsResponse.statusText}`);
    }

    const eventsData = await eventsResponse.json();

    for (const event of eventsData.results || []) {
      const personId = `person_${event.distinct_id}`;
      const eventDate = new Date(event.timestamp);
      
      // Map event to class
      let eventClass: 'core' | 'search' | 'share' | 'pay' = 'core';
      const eventLower = event.event.toLowerCase();
      
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
        eventName: event.event,
        eventClass,
        platform: event.properties?.$device || null,
        workspaceId,
      });
      rowsSynced += 1;
    }

    // Update sync state
    await db
      .insert(schema.syncState)
      .values({
        source: "posthog",
        sourceName: "PostHog",
        lastSync: new Date(),
        status: "success",
        workspaceId,
      })
      .onConflictDoUpdate({
        target: schema.syncState.source,
        set: {
          lastSync: new Date(),
          status: "success",
        },
      });

    console.log("PostHog sync complete");
    // Full-snapshot connector: ignore cursor, no incremental watermark yet.
    return { rowsSynced, nextCursor: null, health: "ok" };
  } catch (error) {
    console.error("PostHog sync failed");

    await db
      .insert(schema.syncState)
      .values({
        source: "posthog",
        sourceName: "PostHog",
        lastSync: new Date(),
        status: "error",
        error: "sync failed",
        workspaceId,
      })
      .onConflictDoUpdate({
        target: schema.syncState.source,
        set: {
          lastSync: new Date(),
          status: "error",
          error: "sync failed",
        },
      });

    throw error;
  }
}
