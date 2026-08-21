import { NextRequest, NextResponse } from "next/server";
import {
  ConnectSourceRequestSchema,
  ConnectSourceResponseSchema,
  DisconnectSourceRequestSchema,
  DisconnectSourceResponseSchema,
  SourceLifecycleRequestSchema,
  SourceLifecycleResponseSchema,
} from "@/core/contracts";
import { AUDIT_ACTIONS, recordWriteAudit } from "@/core/audit";
import { gate } from "@/core/session-auth";
import {
  badRequest,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readJsonBounded,
} from "@/core/errors";
import {
  clearSourceError,
  disconnectSource,
  hasInstanceSecret,
  pauseSource,
  resumeSource,
  saveSourceConfig,
} from "@/core/sources";

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

    await recordWriteAudit(
      gated.auth,
      workspaceId,
      AUDIT_ACTIONS.connectSave,
      parsed.data.source
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

async function readConnectBody(request: NextRequest) {
  try {
    return { ok: true as const, raw: await readJsonBounded(request) };
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return { ok: false as const, response: payloadTooLarge() };
    }
    if (error instanceof SyntaxError) {
      return { ok: false as const, response: badRequest("Invalid JSON body") };
    }
    throw error;
  }
}

/**
 * DELETE /api/v1/connect
 *
 * Remove stored credentials and sync state. Synced rows stay, still
 * tagged with this source. Write-gated.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await readConnectBody(request);
    if (!body.ok) return body.response;

    const parsed = DisconnectSourceRequestSchema.safeParse(body.raw ?? {});
    if (!parsed.success) {
      return badRequest();
    }

    const gated = await gate(request, {
      workspace: parsed.data.workspaceId,
      write: true,
    });
    if (!gated.ok) return gated.response;
    const workspaceId = gated.workspace;

    const { disconnected } = await disconnectSource(
      workspaceId,
      parsed.data.source
    );
    if (!disconnected) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    await recordWriteAudit(
      gated.auth,
      workspaceId,
      AUDIT_ACTIONS.connectDisconnect,
      parsed.data.source
    );

    return NextResponse.json(
      DisconnectSourceResponseSchema.parse({
        source: parsed.data.source,
        workspaceId,
        disconnected: true,
      })
    );
  } catch {
    logServerError("Disconnect source failed");
    return internalError();
  }
}

/**
 * PATCH /api/v1/connect
 *
 * Pause / resume scheduling, or acknowledge a stored pull error.
 * Write-gated. Encrypted config stays on pause and resume.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await readConnectBody(request);
    if (!body.ok) return body.response;

    const parsed = SourceLifecycleRequestSchema.safeParse(body.raw ?? {});
    if (!parsed.success) {
      return badRequest();
    }

    const gated = await gate(request, {
      workspace: parsed.data.workspaceId,
      write: true,
    });
    if (!gated.ok) return gated.response;
    const workspaceId = gated.workspace;
    const { source, action } = parsed.data;

    if (action === "pause") {
      const result = await pauseSource(workspaceId, source);
      if (!result.found) {
        return NextResponse.json({ error: "Not Found" }, { status: 404 });
      }
      await recordWriteAudit(
        gated.auth,
        workspaceId,
        AUDIT_ACTIONS.connectPause,
        source
      );
      return NextResponse.json(
        SourceLifecycleResponseSchema.parse({
          source,
          workspaceId,
          action,
          paused: true,
        })
      );
    }

    if (action === "resume") {
      const result = await resumeSource(workspaceId, source);
      if (!result.found) {
        return NextResponse.json({ error: "Not Found" }, { status: 404 });
      }
      await recordWriteAudit(
        gated.auth,
        workspaceId,
        AUDIT_ACTIONS.connectResume,
        source
      );
      return NextResponse.json(
        SourceLifecycleResponseSchema.parse({
          source,
          workspaceId,
          action,
          paused: false,
        })
      );
    }

    const result = await clearSourceError(workspaceId, source);
    if (!result.found) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }
    await recordWriteAudit(
      gated.auth,
      workspaceId,
      AUDIT_ACTIONS.connectClearError,
      source
    );
    return NextResponse.json(
      SourceLifecycleResponseSchema.parse({
        source,
        workspaceId,
        action,
        cleared: true,
      })
    );
  } catch {
    logServerError("Source lifecycle failed");
    return internalError();
  }
}
