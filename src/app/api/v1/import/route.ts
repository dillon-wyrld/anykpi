import { NextRequest, NextResponse } from "next/server";
import {
  ImportPreviewResponseSchema,
  ImportRequestSchema,
  ImportResponseSchema,
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
  tooManyRequests,
} from "@/core/errors";
import { clientKeyFrom, rateLimit } from "@/core/rate-limit";
import {
  CSV_SOURCE,
  csvSourceConfig,
  formatImportErrors,
  parseCsvSourceConfig,
  runCsvImport,
} from "@/core/csv-import";
import { hasInstanceSecret, loadSourceConfig, saveSourceConfig } from "@/core/sources";

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

    if (!parsed.data.preview && !hasInstanceSecret()) {
      return NextResponse.json({ error: "set ANYKPI_SECRET" }, { status: 503 });
    }

    const stored = parseCsvSourceConfig(await loadSourceConfig(workspaceId, CSV_SOURCE));
    const mapping =
      parsed.data.mapping && Object.keys(parsed.data.mapping).length > 0
        ? parsed.data.mapping
        : stored.mapping;

    const outcome = await runCsvImport({
      csv: parsed.data.csv,
      kind: parsed.data.kind ?? stored.kind,
      mapping,
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

    await saveSourceConfig(
      workspaceId,
      CSV_SOURCE,
      csvSourceConfig(outcome.result.kind, mapping ?? {})
    );

    await recordWriteAudit(
      gated.auth,
      workspaceId,
      AUDIT_ACTIONS.importCsv,
      outcome.result.kind
    );
    return NextResponse.json(ImportResponseSchema.parse(outcome.result));
  } catch {
    logServerError("CSV import failed");
    return internalError();
  }
}
