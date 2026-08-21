/**
 * Annotations — the sticker layer.
 *
 * One write path for the UI, REST, and MCP `annotate`. Pins a sticker or
 * note to a person, date, metric, or cohort. `user` stores as `person` so
 * person-delete tombstones stay honest.
 */

import { and, desc, eq } from "drizzle-orm";
import {
  AnnotateRequestSchema,
  type AnnotateRequest,
} from "@/core/contracts";
import { db } from "@/core/db";
import * as schema from "@/core/schema";

export const ANNOTATION_TYPES = ["sticker", "note"] as const;
export const ANNOTATION_TARGET_TYPES = [
  "person",
  "date",
  "metric",
  "cohort",
] as const;

export type AnnotationType = (typeof ANNOTATION_TYPES)[number];
export type AnnotationTargetType = (typeof ANNOTATION_TARGET_TYPES)[number];

export type AnnotationRow = {
  id: number;
  type: AnnotationType;
  targetType: AnnotationTargetType;
  targetId: string;
  content: string;
  createdAt: Date;
  workspaceId: string;
};

export type AnnotationPayload = {
  id: number;
  type: AnnotationType;
  targetType: AnnotationTargetType;
  targetId: string;
  content: string;
  createdAt: string;
  workspaceId: string;
};

export class AnnotateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnotateError";
  }
}

const DATE_KEY = /^(\d{4}-\d{2}-\d{2})/;

export function persistTargetType(
  input: AnnotateRequest["targetType"]
): AnnotationTargetType {
  if (input === "user" || input === "person") return "person";
  return input;
}

export function normalizeTargetId(
  targetType: AnnotationTargetType,
  raw: string
): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new AnnotateError("targetId is required");
  }
  if (targetType === "date") {
    const match = trimmed.match(DATE_KEY);
    if (!match) {
      throw new AnnotateError("date targetId must be YYYY-MM-DD");
    }
    return match[1] as string;
  }
  return trimmed;
}

export function serializeAnnotation(row: AnnotationRow): AnnotationPayload {
  return {
    id: row.id,
    type: row.type,
    targetType: row.targetType,
    targetId: row.targetId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    workspaceId: row.workspaceId,
  };
}

export function annotationViewPath(
  workspace: string,
  targetType: AnnotationTargetType,
  targetId: string
): string {
  const ws = encodeURIComponent(workspace);
  if (targetType === "date") {
    return `/dashboard?workspace=${ws}&view=calendar`;
  }
  if (targetType === "metric") {
    return `/dashboard?workspace=${ws}&view=wbr`;
  }
  if (targetType === "cohort") {
    return `/dashboard?workspace=${ws}&view=cohorts`;
  }
  return `/dashboard?workspace=${ws}&view=dotplot&user=${encodeURIComponent(targetId)}`;
}

export function annotationViewUrl(
  baseUrl: string,
  workspace: string,
  targetType: AnnotationTargetType,
  targetId: string
): string {
  const origin = baseUrl.replace(/\/+$/, "");
  return `${origin}${annotationViewPath(workspace, targetType, targetId)}`;
}

export function annotationsListViewUrl(baseUrl: string, workspace: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  return `${origin}/dashboard?workspace=${encodeURIComponent(workspace)}&view=dotplot`;
}

export async function listAnnotations(
  workspaceId: string,
  filter?: { targetType?: AnnotationTargetType; targetId?: string }
): Promise<AnnotationRow[]> {
  const clauses = [eq(schema.annotations.workspaceId, workspaceId)];
  if (filter?.targetType) {
    clauses.push(eq(schema.annotations.targetType, filter.targetType));
  }
  if (filter?.targetId) {
    clauses.push(eq(schema.annotations.targetId, filter.targetId));
  }
  const rows = await db
    .select()
    .from(schema.annotations)
    .where(and(...clauses))
    .orderBy(desc(schema.annotations.id))
    .all();
  return rows.map((row) => ({
    id: row.id,
    type: row.type as AnnotationType,
    targetType: row.targetType as AnnotationTargetType,
    targetId: row.targetId,
    content: row.content,
    createdAt: row.createdAt,
    workspaceId: row.workspaceId,
  }));
}

export async function createAnnotation(
  workspaceId: string,
  input: AnnotateRequest
): Promise<AnnotationRow> {
  const parsed = AnnotateRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new AnnotateError("Bad Request");
  }
  const targetType = persistTargetType(parsed.data.targetType);
  const targetId = normalizeTargetId(targetType, parsed.data.targetId);
  const content = parsed.data.content.trim();
  if (!content) {
    throw new AnnotateError("content is required");
  }
  const createdAt = new Date();
  const inserted = await db
    .insert(schema.annotations)
    .values({
      type: parsed.data.type,
      targetType,
      targetId,
      content,
      createdAt,
      workspaceId,
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new AnnotateError("Failed to pin annotation");
  }
  return {
    id: row.id,
    type: row.type as AnnotationType,
    targetType: row.targetType as AnnotationTargetType,
    targetId: row.targetId,
    content: row.content,
    createdAt: row.createdAt,
    workspaceId: row.workspaceId,
  };
}
