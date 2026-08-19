import { NextRequest, NextResponse } from "next/server";
import {
  ImportPreviewResponseSchema,
  ImportRequestSchema,
  ImportResponseSchema,
} from "@/core/contracts";
import { gate } from "@/core/auth";
import {
  badRequest,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readJsonBounded,
  tooManyRequests,
} from "@/core/errors";
import { clientKeyFrom, rateLimit } from "@/core/rate-limit";
import { formatImportErrors, runCsvImport } from "@/core/csv-import";

/** 10k-row files are well under this; keeps a single-request import viable. */
const IMPORT_MAX_BYTES = 16 * 1024 * 1024;

/**
 * POST /api/v1/import
 *
 * CSV import for users and events. Write-gated. Optional `preview`
 * returns column mapping without writing.
 */
export async function POST(request: NextRequest) {
  const limit = rateLimit(clientKeyFrom(request.headers));
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  try {
    let raw: unknown = {};
    try {
      raw = await readJsonBounded(request, IMPORT_MAX_BYTES);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return payloadTooLarge();
      if (error instanceof SyntaxError) return badRequest("Invalid JSON body");
      throw error;
    }

    const parsed = ImportRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return badRequest();
    }

    const gated = await gate(request, {
      workspace: parsed.data.workspaceId,
      write: true,
    });
    if (!gated.ok) return gated.response;
    const workspaceId = gated.workspace;

    const outcome = await runCsvImport({
      csv: parsed.data.csv,
      kind: parsed.data.kind,
      mapping: parsed.data.mapping,
      preview: parsed.data.preview,
      workspaceId,
    });

    if (outcome.status === "preview") {
      return NextResponse.json(ImportPreviewResponseSchema.parse(outcome.preview));
    }

    if (outcome.status === "invalid") {
      return NextResponse.json(
        {
          error: formatImportErrors(outcome.errors),
          errors: outcome.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(ImportResponseSchema.parse(outcome.result));
  } catch {
    logServerError("CSV import failed");
    return internalError();
  }
}
