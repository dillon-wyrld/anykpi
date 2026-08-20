import { NextRequest, NextResponse } from "next/server";
import {
  CompanyProfileSchema,
  CompanyProfileUpdateSchema,
} from "@/core/contracts";
import { AUDIT_ACTIONS, recordWriteAudit } from "@/core/audit";
import {
  CompanyProfileError,
  loadCompanyProfile,
  saveCompanyProfile,
} from "@/core/company-profile";
import {
  badRequest,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readJsonBounded,
} from "@/core/errors";
import { gate } from "@/core/session-auth";

function requestedWorkspace(request: NextRequest, body?: { workspaceId?: string; workspace?: string }) {
  const { searchParams } = new URL(request.url);
  return (
    body?.workspaceId ||
    body?.workspace ||
    searchParams.get("workspace") ||
    searchParams.get("workspaceId") ||
    "demo"
  );
}

/**
 * GET /api/v1/config
 *
 * Company profile for a workspace (name, founded date, home city).
 * Demo stays public-read.
 */
export async function GET(request: NextRequest) {
  try {
    const requested = requestedWorkspace(request);
    const gated = await gate(request, { workspace: requested, write: false });
    if (!gated.ok) return gated.response;

    const profile = await loadCompanyProfile(gated.workspace);
    return NextResponse.json(CompanyProfileSchema.parse(profile));
  } catch {
    logServerError("Load company profile failed");
    return internalError();
  }
}

/**
 * PATCH /api/v1/config
 *
 * Update company name, founded date, and/or home city. Write-gated.
 * A founded date in the future is refused.
 */
export async function PATCH(request: NextRequest) {
  try {
    let raw: unknown = {};
    try {
      raw = await readJsonBounded(request);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return payloadTooLarge();
      if (error instanceof SyntaxError) return badRequest("Invalid JSON body");
      throw error;
    }

    const parsed = CompanyProfileUpdateSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Bad Request");
    }

    const gated = await gate(request, {
      workspace: requestedWorkspace(request, parsed.data),
      write: true,
    });
    if (!gated.ok) return gated.response;

    const profile = await saveCompanyProfile(gated.workspace, {
      companyName: parsed.data.companyName,
      foundedAt: parsed.data.foundedAt,
      homeCity: parsed.data.homeCity,
    });

    await recordWriteAudit(
      gated.auth,
      gated.workspace,
      AUDIT_ACTIONS.configSave,
      "company_profile"
    );

    return NextResponse.json(CompanyProfileSchema.parse(profile));
  } catch (error) {
    if (error instanceof CompanyProfileError) {
      return badRequest(error.message);
    }
    logServerError("Save company profile failed");
    return internalError();
  }
}
