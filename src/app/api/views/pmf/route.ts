import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { gate } from "@/core/session-auth";
import {
  ResearchCandidateSchema,
  ResearchRunRequestSchema,
} from "@/core/contracts";
import { db } from "@/core/db";
import {
  PayloadTooLargeError,
  badRequest,
  internalError,
  logServerError,
  payloadTooLarge,
  readJsonBounded,
} from "@/core/errors";
import {
  discloseResearch,
  listCachedResearch,
  listOutgoingFields,
  runResearch,
  type ResearchSubject,
} from "@/core/research";
import * as schema from "@/core/schema";
import { demoPmfRuns, pmfRunFromResearch, type PmfRun } from "@/core/views/pmf";

function toSubject(row: {
  personId: string;
  name: string;
  country: string | null;
  email: string | null;
  emoji: string | null;
  platform: string | null;
}): ResearchSubject {
  return {
    personId: row.personId,
    name: row.name,
    country: row.country,
    email: row.email,
    emoji: row.emoji,
    platform: row.platform,
  };
}

async function loadCandidates(workspace: string) {
  const rows = await db
    .select({
      personId: schema.users.personId,
      name: schema.users.name,
      country: schema.users.country,
      emoji: schema.users.emoji,
      platform: schema.users.platform,
    })
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspace))
    .orderBy(asc(schema.users.name))
    .all();

  return rows.map((row) =>
    ResearchCandidateSchema.parse({
      personId: row.personId,
      name: row.name,
      emoji: row.emoji ?? null,
      country: row.country ?? null,
      platform: row.platform ?? null,
      outgoing: listOutgoingFields(row),
    })
  );
}

async function loadUser(workspace: string, personId: string) {
  const [row] = await db
    .select()
    .from(schema.users)
    .where(
      and(eq(schema.users.workspaceId, workspace), eq(schema.users.personId, personId))
    )
    .all();
  return row ?? null;
}

/**
 * PMF+ view. GET never researches — it returns demo cards, locally
 * cached results, and the verbatim outgoing-field list for a selected
 * person. POST is the only explicit action that may call fetch.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("workspace") || "demo";
  const gated = await gate(request, { workspace: requested, write: false });
  if (!gated.ok) return gated.response;
  const workspace = gated.workspace;

  try {
    const cachedRuns: PmfRun[] = listCachedResearch(workspace).map((result) =>
      pmfRunFromResearch(result)
    );
    const runs = workspace === "demo" ? [...cachedRuns, ...demoPmfRuns()] : cachedRuns;
    const candidates = await loadCandidates(workspace);

    const personId = searchParams.get("user");
    if (!personId) {
      return NextResponse.json({ runs, candidates });
    }

    const user = await loadUser(workspace, personId);
    if (!user) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    return NextResponse.json({
      runs,
      candidates,
      disclosure: discloseResearch(toSubject(user)),
    });
  } catch {
    logServerError("PMF view failed");
    return internalError();
  }
}

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

    const parsed = ResearchRunRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return badRequest("Approve the outgoing fields before any query is made.");
    }

    const requested = parsed.data.workspace || "demo";
    const gated = await gate(request, { workspace: requested, write: false });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;

    const user = await loadUser(workspace, parsed.data.personId);
    if (!user) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    const outcome = await runResearch({
      workspace,
      subject: toSubject(user),
      approvedFields: parsed.data.approvedFields,
      refresh: parsed.data.refresh,
    });

    if (!outcome.ok) {
      return badRequest(outcome.error);
    }

    return NextResponse.json({
      run: pmfRunFromResearch(outcome.result, {
        emoji: user.emoji,
        platform: user.platform,
      }),
      result: outcome.result,
    });
  } catch {
    logServerError("PMF research failed");
    return internalError();
  }
}
