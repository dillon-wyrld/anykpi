import { NextRequest, NextResponse } from "next/server";
import {
  DefineMetricRequestSchema,
  DefineMetricResponseSchema,
  MetricMutationResponseSchema,
  MetricPatchRequestSchema,
} from "@/core/contracts";
import { AUDIT_ACTIONS, recordWriteAudit } from "@/core/audit";
import { gate, gateDisplayPrefs } from "@/core/session-auth";
import { publicBaseUrl } from "@/core/view-state";
import {
  badRequest,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readJsonBounded,
} from "@/core/errors";
import {
  WbrBuilderError,
  acceptStarterProposals,
  assertNoStatusField,
  deckViewUrl,
  defineMetric,
  definedMetricPayload,
  editMetric,
  importManualCsv,
  reorderMetrics,
  retireMetric,
} from "@/core/wbr-builder";

function requestedWorkspace(
  request: NextRequest,
  body?: { workspaceId?: string; workspace?: string }
) {
  const { searchParams } = new URL(request.url);
  return (
    body?.workspaceId ||
    body?.workspace ||
    searchParams.get("workspace") ||
    searchParams.get("workspaceId") ||
    "live"
  );
}

function fail(error: unknown) {
  if (error instanceof WbrBuilderError) return badRequest(error.message);
  throw error;
}

/**
 * POST /api/v1/metrics
 *
 * define_metric — write-scoped. Same validation as MCP.
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

    try {
      assertNoStatusField(raw);
    } catch (error) {
      return fail(error);
    }

    const parsed = DefineMetricRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) return badRequest();

    const gated = await gate(request, {
      workspace: requestedWorkspace(request, parsed.data),
      write: true,
    });
    if (!gated.ok) return gated.response;

    const row = await defineMetric(gated.workspace, parsed.data);
    await recordWriteAudit(
      gated.auth,
      gated.workspace,
      AUDIT_ACTIONS.metricDefine,
      row.metricId
    );

    const viewUrl = deckViewUrl(publicBaseUrl(request), gated.workspace);
    return NextResponse.json(
      DefineMetricResponseSchema.parse({
        metric: definedMetricPayload(row),
        workspace: gated.workspace,
        view_url: viewUrl,
        viewUrl,
      }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof WbrBuilderError) return badRequest(error.message);
    logServerError("Define metric failed");
    return internalError();
  }
}

/**
 * PATCH /api/v1/metrics
 *
 * Human builder: accept / edit / reorder / retire / import.
 * A signed browser session may save the deck the founder owns;
 * define_metric itself stays write-scoped on POST.
 */
export async function PATCH(request: NextRequest) {
  try {
    let raw: unknown = {};
    try {
      raw = await readJsonBounded(request, 256 * 1024);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return payloadTooLarge();
      if (error instanceof SyntaxError) return badRequest("Invalid JSON body");
      throw error;
    }

    try {
      assertNoStatusField(raw);
    } catch (error) {
      return fail(error);
    }

    const parsed = MetricPatchRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) return badRequest();

    const gated = await gateDisplayPrefs(request, {
      workspace: requestedWorkspace(request, parsed.data),
      write: true,
    });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;
    const viewUrl = deckViewUrl(publicBaseUrl(request), workspace);

    if (parsed.data.action === "define") {
      const { action: _action, ...body } = parsed.data;
      const row = await defineMetric(workspace, body);
      await recordWriteAudit(
        gated.auth,
        workspace,
        AUDIT_ACTIONS.metricDefine,
        row.metricId
      );
      return NextResponse.json(
        DefineMetricResponseSchema.parse({
          metric: definedMetricPayload(row),
          workspace,
          view_url: viewUrl,
          viewUrl,
        }),
        { status: 201 }
      );
    }

    if (parsed.data.action === "accept") {
      const rows = await acceptStarterProposals(workspace, parsed.data.ids);
      await recordWriteAudit(
        gated.auth,
        workspace,
        AUDIT_ACTIONS.metricDefine,
        rows.map((row) => row.metricId).join(",")
      );
      return NextResponse.json(
        MetricMutationResponseSchema.parse({
          ok: true,
          workspace,
          ids: rows.map((row) => row.metricId),
          view_url: viewUrl,
          viewUrl,
        })
      );
    }

    if (parsed.data.action === "retire") {
      await retireMetric(workspace, parsed.data.id);
      await recordWriteAudit(
        gated.auth,
        workspace,
        AUDIT_ACTIONS.metricDefine,
        parsed.data.id
      );
      return NextResponse.json(
        MetricMutationResponseSchema.parse({
          ok: true,
          workspace,
          ids: [parsed.data.id],
          view_url: viewUrl,
          viewUrl,
        })
      );
    }

    if (parsed.data.action === "reorder") {
      await reorderMetrics(workspace, parsed.data.order);
      await recordWriteAudit(
        gated.auth,
        workspace,
        AUDIT_ACTIONS.metricDefine,
        parsed.data.order.join(",")
      );
      return NextResponse.json(
        MetricMutationResponseSchema.parse({
          ok: true,
          workspace,
          ids: parsed.data.order,
          view_url: viewUrl,
          viewUrl,
        })
      );
    }

    if (parsed.data.action === "edit") {
      const row = await editMetric(workspace, parsed.data);
      await recordWriteAudit(
        gated.auth,
        workspace,
        AUDIT_ACTIONS.metricDefine,
        row.metricId
      );
      return NextResponse.json(
        DefineMetricResponseSchema.parse({
          metric: definedMetricPayload(row),
          workspace,
          view_url: viewUrl,
          viewUrl,
        })
      );
    }

    const result = await importManualCsv(workspace, parsed.data.id, parsed.data.csv);
    await recordWriteAudit(
      gated.auth,
      workspace,
      AUDIT_ACTIONS.metricDefine,
      parsed.data.id
    );
    return NextResponse.json(
      MetricMutationResponseSchema.parse({
        ok: true,
        workspace,
        ids: [parsed.data.id],
        imported: result.imported,
        updated: result.updated,
        view_url: viewUrl,
        viewUrl,
      })
    );
  } catch (error) {
    if (error instanceof WbrBuilderError) return badRequest(error.message);
    logServerError("WBR builder patch failed");
    return internalError();
  }
}
