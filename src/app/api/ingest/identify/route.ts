import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, properties, workspaceId = "live" } = body;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const personId = `person_${userId}`;
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
      await db
        .update(schema.users)
        .set({
          name: properties?.name || existing.name,
          email: properties?.email || existing.email,
          platform: properties?.platform || existing.platform,
          country: properties?.country || existing.country,
          traits: JSON.stringify({
            ...JSON.parse(existing.traits || "{}"),
            ...properties,
          }),
        })
        .where(
          and(
            eq(schema.users.personId, personId),
            eq(schema.users.workspaceId, workspaceId)
          )
        )
        .run();
    } else {
      await db.insert(schema.users).run({
        personId,
        name: properties?.name || userId,
        email: properties?.email,
        platform: properties?.platform,
        country: properties?.country,
        emoji: properties?.emoji || "👤",
        signupDate: new Date(),
        traits: JSON.stringify(properties || {}),
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
