import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";

interface AmplitudeConfig {
  apiKey: string;
  secretKey: string;
  workspaceId: string;
}

export async function syncAmplitude(config: AmplitudeConfig): Promise<void> {
  const { apiKey, secretKey, workspaceId } = config;

  try {
    const baseUrl = "https://amplitude.com/api/2";
    const auth = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");

    const usersResponse = await fetch(`${baseUrl}/users`, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!usersResponse.ok) {
      throw new Error(`Amplitude API error: ${usersResponse.statusText}`);
    }

    const usersData = await usersResponse.json();

    for (const user of usersData.data || []) {
      const personId = `person_${user.user_id}`;

      await db
        .insert(schema.users)
        .values({
          personId,
          name: user.user_properties?.name || user.user_id,
          email: user.user_properties?.email,
          platform: user.platform,
          country: user.country,
          signupDate: user.user_properties?.$created
            ? new Date(user.user_properties.$created)
            : new Date(),
          traits: JSON.stringify(user.user_properties || {}),
          workspaceId,
        })
        .onConflictDoUpdate({
          target: schema.users.personId,
          set: {
            name: user.user_properties?.name || user.user_id,
            email: user.user_properties?.email,
            traits: JSON.stringify(user.user_properties || {}),
          },
        })
        .run();
    }

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
      })
      .run();
  } catch (error) {
    console.error("Amplitude sync error:", error);

    await db
      .insert(schema.syncState)
      .values({
        source: "amplitude",
        sourceName: "Amplitude",
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
