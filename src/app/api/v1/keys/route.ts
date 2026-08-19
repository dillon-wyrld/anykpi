import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/core/db';
import * as schema from '@/core/schema';
import { nanoid } from 'nanoid';
import { APIKeyCreateRequestSchema, APIKeyResponseSchema } from '@/core/contracts';
import { createHash } from 'crypto';

/**
 * POST /api/v1/keys
 * 
 * Generate new API key for agent access
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const params = APIKeyCreateRequestSchema.parse(body);
    
    const keyId = `ak_${nanoid(24)}`;
    const rawKey = `${keyId}.${nanoid(32)}`;
    const hashedKey = createHash('sha256').update(rawKey).digest('hex');
    
    await db.insert(schema.apiKeys).values({
      id: keyId,
      hashedKey,
      name: params.name,
      createdAt: new Date(),
    });
    
    const response = APIKeyResponseSchema.parse({
      id: keyId,
      key: rawKey, // Only returned once
      name: params.name,
      createdAt: new Date().toISOString(),
    });
    
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('parse')) {
      return NextResponse.json(
        { error: 'Bad Request', message: error.message, statusCode: 400 },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal Server Error', message: error instanceof Error ? error.message : 'Unknown error', statusCode: 500 },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/keys
 * 
 * List API keys (without revealing the actual key)
 */
export async function GET() {
  try {
    const keys = await db.select().from(schema.apiKeys).all();
    
    const response = keys.map(k => APIKeyResponseSchema.parse({
      id: k.id,
      name: k.name,
      createdAt: k.createdAt.toISOString(),
      // key is omitted for security
    }));
    
    return NextResponse.json({ keys: response });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error', message: error instanceof Error ? error.message : 'Unknown error', statusCode: 500 },
      { status: 500 }
    );
  }
}
