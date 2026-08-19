import { NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { nanoid } from "nanoid";
import { createHash } from "crypto";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name } = body;

    const key = `ak_${nanoid(32)}`;
    const hashedKey = createHash("sha256").update(key).digest("hex");

    await db.insert(schema.apiKeys).run({
      id: nanoid(),
      hashedKey,
      name: name || "API Key",
      createdAt: new Date(),
    });

    return NextResponse.json({ key });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
