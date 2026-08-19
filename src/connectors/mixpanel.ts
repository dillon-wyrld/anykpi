import { db } from "@/core/db";
import * as schema from "@/core/schema";
import type { SyncResult } from "@/core/contracts";
import { upsertSyncState } from "@/core/upsert";
import { eq, and } from "drizzle-orm";
import { failedSync } from "./http-status";

export async function syncMixpanel(
  workspaceId: string = "live",
  _opts?: { cursor?: string }
): Promise<SyncResult> {
  const projectId = process.env.MIXPANEL_PROJECT_ID;
  const apiSecret = process.env.MIXPANEL_API_SECRET;

  if (!projectId || !apiSecret) {
    throw new Error("MIXPANEL_PROJECT_ID and MIXPANEL_API_SECRET are required");
  }

  const auth = Buffer.from(`${apiSecret}:`).toString("base64");

  let rowsSynced = 0;

  try {
    // Sync users via engage endpoint
    const usersResponse = await fetch(
      `https://mixpanel.com/api/2.0/engage?project_id=${projectId}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    if (!usersResponse.ok) {
      return failedSync({
        source: "mixpanel",
        sourceName: "Mixpanel",
        workspaceId,
        status: usersResponse.status,
        rowsSynced,
      });
    }

    const usersData = await usersResponse.json();

    for (const user of usersData.results || []) {
      const personId = `person_${user.$distinct_id}`;
      
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
          name: user.$properties?.$name || user.$distinct_id,
          email: user.$properties?.$email || null,
          emoji: user.$properties?.emoji || null,
          platform: user.$properties?.platform || null,
          country: user.$properties?.$country_code || null,
          signupDate: user.$properties?.$created ? new Date(user.$properties.$created) : new Date(),
          cluster: null,
          accountId: null,
          workspaceId,
        });
        rowsSynced += 1;
      }
    }

    // Sync events via export endpoint
    const toDate = new Date().toISOString().split('T')[0];
    const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const eventsResponse = await fetch(
      `https://data.mixpanel.com/api/2.0/export?project_id=${projectId}&from_date=${fromDate}&to_date=${toDate}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    if (!eventsResponse.ok) {
      return failedSync({
        source: "mixpanel",
        sourceName: "Mixpanel",
        workspaceId,
        status: eventsResponse.status,
        rowsSynced,
      });
    }

    const eventsText = await eventsResponse.text();
    const events = eventsText.split('\n').filter(Boolean).map(line => JSON.parse(line));

    for (const event of events) {
      const personId = `person_${event.properties.distinct_id}`;
      const eventDate = new Date(event.properties.time * 1000);
      
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
        platform: event.properties.$device || null,
        workspaceId,
      });
      rowsSynced += 1;
    }

    await upsertSyncState({
      source: "mixpanel",
      sourceName: "Mixpanel",
      lastSync: new Date(),
      status: "success",
      workspaceId,
    });

    console.log("Mixpanel sync complete");
    // Full-snapshot connector: ignore cursor, no incremental watermark yet.
    return { rowsSynced, nextCursor: null, health: "ok" };
  } catch (error) {
    console.error("Mixpanel sync failed");

    await upsertSyncState({
      source: "mixpanel",
      sourceName: "Mixpanel",
      lastSync: new Date(),
      status: "error",
      error: "sync failed",
      workspaceId,
    });

    throw error;
  }
}
