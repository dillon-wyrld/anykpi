import { db } from "@/core/db";
import * as schema from "@/core/schema";
import type { SyncResult } from "@/core/contracts";
import { eq, and } from "drizzle-orm";

export async function syncAmplitude(
  workspaceId: string = "live",
  _opts?: { cursor?: string }
): Promise<SyncResult> {
  const apiKey = process.env.AMPLITUDE_API_KEY;
  const secretKey = process.env.AMPLITUDE_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error("AMPLITUDE_API_KEY and AMPLITUDE_SECRET_KEY are required");
  }

  const auth = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");

  let rowsSynced = 0;

  try {
    // Sync users
    const usersResponse = await fetch(
      "https://amplitude.com/api/2/usersearch",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_search: {
            limit: 1000,
          },
        }),
      }
    );

    if (!usersResponse.ok) {
      throw new Error(`Amplitude API error: ${usersResponse.statusText}`);
    }

    const usersData = await usersResponse.json();

    for (const user of usersData.data || []) {
      const personId = `person_${user.user_id || user.amplitude_id}`;
      
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
          name: user.user_properties?.name || user.user_id || user.amplitude_id,
          email: user.user_properties?.email || null,
          emoji: user.user_properties?.emoji || null,
          platform: user.platform || null,
          country: user.country || null,
          signupDate: user.user_properties?.created_at ? new Date(user.user_properties.created_at) : new Date(),
          cluster: null,
          accountId: null,
          workspaceId,
        });
        rowsSynced += 1;
      }
    }

    // Sync events
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const eventsResponse = await fetch(
      `https://amplitude.com/api/2/export?start=${startDate}&end=${endDate}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    if (!eventsResponse.ok) {
      throw new Error(`Amplitude export API error: ${eventsResponse.statusText}`);
    }

    const eventsText = await eventsResponse.text();
    const events = eventsText.split('\n').filter(Boolean).map(line => JSON.parse(line));

    for (const event of events) {
      const personId = `person_${event.user_id || event.amplitude_id}`;
      const eventDate = new Date(event.event_time);
      
      // Map event to class
      let eventClass: 'core' | 'search' | 'share' | 'pay' = 'core';
      const eventLower = event.event_type.toLowerCase();
      
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
        eventName: event.event_type,
        eventClass,
        platform: event.platform || null,
        workspaceId,
      });
      rowsSynced += 1;
    }

    // Update sync state
    await db
      .insert(schema.syncState)
      .values({
        source: "amplitude",
        sourceName: "Amplitude",
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

    console.log("Amplitude sync complete");
    // Full-snapshot connector: ignore cursor, no incremental watermark yet.
    return { rowsSynced, nextCursor: null, health: "ok" };
  } catch (error) {
    console.error("Amplitude sync failed");

    await db
      .insert(schema.syncState)
      .values({
        source: "amplitude",
        sourceName: "Amplitude",
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
