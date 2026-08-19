import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";

interface MixpanelConfig {
  projectId: string;
  apiSecret: string;
  workspaceId: string;
}

export async function syncMixpanel(config: MixpanelConfig): Promise<void> {
  const { projectId, apiSecret, workspaceId } = config;

  try {
    const baseUrl = "https://mixpanel.com/api/2.0";
    const auth = Buffer.from(`${apiSecret}:`).toString("base64");

    const usersResponse = await fetch(`${baseUrl}/engage?project_id=${projectId}`, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!usersResponse.ok) {
      throw new Error(`Mixpanel API error: ${usersResponse.statusText}`);
    }

    const usersData = await usersResponse.json();

    for (const user of usersData.results || []) {
      const personId = `person_${user.distinct_id}`;

      await db
        .insert(schema.users)
        .values({
          personId,
          name: user.$properties.$name || user.distinct_id,
          email: user.$properties.$email,
          platform: user.$properties.platform,
          country: user.$properties.country,
          signupDate: user.$properties.$created ? new Date(user.$properties.$created) : new Date(),
          traits: JSON.stringify(user.$properties),
          workspaceId,
        })
        .onConflictDoUpdate({
          target: schema.users.personId,
          set: {
            name: user.$properties.$name || user.distinct_id,
            email: user.$properties.$email,
            traits: JSON.stringify(user.$properties),
          },
        })
        .run();
    }

    await db
      .insert(schema.syncState)
      .values({
        source: "mixpanel",
        sourceName: "Mixpanel",
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
      })
      .run();
  } catch (error) {
    console.error("Mixpanel sync error:", error);

    await db
      .insert(schema.syncState)
      .values({
        source: "mixpanel",
        sourceName: "Mixpanel",
        lastSync: new Date(),
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        workspaceId,
      })
      .onConflictDoUpdate({
        target: schema.syncState.source,
        set: {
          lastSync: new Date(),
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      })
      .run();

    throw error;
  }
}
