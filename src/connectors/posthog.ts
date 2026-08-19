import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";

interface PostHogConfig {
  apiKey: string;
  projectId: string;
  workspaceId: string;
}

export async function syncPostHog(config: PostHogConfig): Promise<void> {
  const { apiKey, projectId, workspaceId } = config;

  try {
    const baseUrl = "https://app.posthog.com/api";

    const personsResponse = await fetch(
      `${baseUrl}/projects/${projectId}/persons?limit=1000`,
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

      await db
        .insert(schema.users)
        .values({
          personId,
          name: person.properties?.name || person.properties?.email || person.distinct_ids[0],
          email: person.properties?.email,
          platform: person.properties?.platform || person.properties?.$initial_os,
          country: person.properties?.country || person.properties?.$geoip_country_code,
          signupDate: person.created_at ? new Date(person.created_at) : new Date(),
          emoji: person.properties?.emoji || "👤",
          traits: JSON.stringify(person.properties || {}),
          workspaceId,
        })
        .onConflictDoUpdate({
          target: schema.users.personId,
          set: {
            name: person.properties?.name || person.properties?.email || person.distinct_ids[0],
            email: person.properties?.email,
            platform: person.properties?.platform || person.properties?.$initial_os,
            traits: JSON.stringify(person.properties || {}),
          },
        })
        .run();
    }

    const eventsResponse = await fetch(
      `${baseUrl}/projects/${projectId}/events?limit=10000`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (eventsResponse.ok) {
      const eventsData = await eventsResponse.json();

      for (const event of eventsData.results || []) {
        const personId = `person_${event.distinct_id}`;
        const eventDate = new Date(event.timestamp);
        const dateKey = new Date(eventDate);
        dateKey.setHours(0, 0, 0, 0);

        const existing = await db
          .select()
          .from(schema.activity)
          .where(
            eq(schema.activity.personId, personId) &&
              eq(schema.activity.date, dateKey) &&
              eq(schema.activity.workspaceId, workspaceId)
          )
          .get();

        if (existing) {
          await db
            .update(schema.activity)
            .set({
              coreCount: existing.coreCount + 1,
              minutes: existing.minutes + 1,
            })
            .where(eq(schema.activity.id, existing.id))
            .run();
        } else {
          await db.insert(schema.activity).run({
            personId,
            date: dateKey,
            coreCount: 1,
            searchCount: 0,
            shareCount: 0,
            payCount: 0,
            minutes: 1,
            workspaceId,
          });
        }
      }
    }

    await db
      .insert(schema.syncState)
      .values({
        connector: "posthog",
        lastSyncedAt: new Date(),
        status: "success",
        stats: JSON.stringify({
          users: personsData.results?.length || 0,
        }),
        workspaceId,
      })
      .onConflictDoUpdate({
        target: schema.syncState.connector,
        set: {
          lastSyncedAt: new Date(),
          status: "success",
          stats: JSON.stringify({
            users: personsData.results?.length || 0,
          }),
        },
      })
      .run();
  } catch (error) {
    console.error("PostHog sync error:", error);

    await db
      .insert(schema.syncState)
      .values({
        connector: "posthog",
        lastSyncedAt: new Date(),
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        workspaceId,
      })
      .onConflictDoUpdate({
        target: schema.syncState.connector,
        set: {
          lastSyncedAt: new Date(),
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      })
      .run();

    throw error;
  }
}
