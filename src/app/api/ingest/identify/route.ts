import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq, and } from "drizzle-orm";

/**
 * POST /api/ingest/identify
 * 
 * Identify or update user (SDK or agent)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, properties, workspaceId = "live" } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    const personId = `person_${userId}`;
    
    // Check if user exists
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

    if (existing) {
      // Update existing user
      const updates: any = {};
      if (properties?.name) updates.name = properties.name;
      if (properties?.email) updates.email = properties.email;
      if (properties?.platform) updates.platform = properties.platform;
      if (properties?.emoji) updates.emoji = properties.emoji;
      if (properties?.country) updates.country = properties.country;
      
      if (Object.keys(updates).length > 0) {
        await db
          .update(schema.users)
          .set(updates)
          .where(
            and(
              eq(schema.users.personId, personId),
              eq(schema.users.workspaceId, workspaceId)
            )
          );
      }
    } else {
      // Create new user
      await db.insert(schema.users).values({
        personId,
        name: properties?.name || `User ${userId}`,
        email: properties?.email || null,
        emoji: properties?.emoji || null,
        platform: properties?.platform || 'web',
        country: properties?.country || null,
        signupDate: new Date(),
        cluster: null,
        accountId: null,
        workspaceId,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Identify error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
