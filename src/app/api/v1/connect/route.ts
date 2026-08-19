import { NextRequest, NextResponse } from "next/server";
import {
  ConnectSourceRequestSchema,
  ConnectSourceResponseSchema,
} from "@/core/contracts";
import { gate } from "@/core/auth";
import {
  badRequest,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readJsonBounded,
} from "@/core/errors";
import { hasInstanceSecret, saveSourceConfig } from "@/core/sources";

/**
 * POST /api/v1/connect
 *
 * Store per-source credentials encrypted at rest. Write-gated. The
 * response never includes credentials.
 */
export async function POST(request: NextRequest) {
  try {
    let raw: unknown = {};
    try {
      raw = await readJsonBounded(request);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return payloadTooLarge();
      if (error instanceof SyntaxError) return badRequest("Invalid JSON body");
      throw error;
    }

    const parsed = ConnectSourceRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return badRequest();
    }

    const credentials = parsed.data.credentials;
    const entries = Object.entries(credentials);
    if (entries.length === 0 || entries.some(([, value]) => value.length === 0)) {
      return badRequest();
    }

    const gated = await gate(request, {
      workspace: parsed.data.workspaceId,
      write: true,
    });
    if (!gated.ok) return gated.response;
    const workspaceId = gated.workspace;

    if (!hasInstanceSecret()) {
      return NextResponse.json({ error: "set ANYKPI_SECRET" }, { status: 503 });
    }

    const { rotated } = await saveSourceConfig(
      workspaceId,
      parsed.data.source,
      credentials
    );

    const response = ConnectSourceResponseSchema.parse({
      source: parsed.data.source,
      workspaceId,
      connected: true,
      rotated,
    });

    return NextResponse.json(response, { status: rotated ? 200 : 201 });
  } catch {
    logServerError("Connect source failed");
    return internalError();
  }
}
