import { z } from "zod";

const FilterSchema = z.object({
  field: z.string(),
  operator: z.enum(["eq", "ne", "in", "gt", "lt", "gte", "lte"]),
  value: z.union([z.string(), z.number(), z.array(z.string())]),
});

const DotPlotStateSchema = z.object({
  view: z.literal("dotplot"),
  filters: z.array(FilterSchema).optional(),
  groupBy: z.enum(["none", "platform", "country", "cohort", "account"]).optional(),
  zoom: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    users: z.array(z.string()).optional(),
  }).optional(),
});

const CohortsStateSchema = z.object({
  view: z.literal("cohorts"),
  grain: z.enum(["week", "month"]).optional(),
  filters: z.array(FilterSchema).optional(),
});

const WBRStateSchema = z.object({
  view: z.literal("wbr"),
  mode: z.enum(["deck", "focus", "table"]).optional(),
  metricId: z.string().optional(),
  filters: z.array(FilterSchema).optional(),
});

const CalendarStateSchema = z.object({
  view: z.literal("calendar"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sources: z.array(z.string()).optional(),
});

const PMFStateSchema = z.object({
  view: z.literal("pmf"),
  userIds: z.array(z.string()).optional(),
  filters: z.array(FilterSchema).optional(),
});

export const ViewStateSchema = z.union([
  DotPlotStateSchema,
  CohortsStateSchema,
  WBRStateSchema,
  CalendarStateSchema,
  PMFStateSchema,
]);

export type ViewState = z.infer<typeof ViewStateSchema>;
export type Filter = z.infer<typeof FilterSchema>;

export function encodeViewState(state: ViewState): string {
  const json = JSON.stringify(state);
  if (typeof window !== "undefined") {
    return btoa(json);
  }
  return Buffer.from(json).toString("base64");
}

export function decodeViewState(encoded: string): ViewState | null {
  try {
    let json: string;
    if (typeof window !== "undefined") {
      json = atob(encoded);
    } else {
      json = Buffer.from(encoded, "base64").toString("utf-8");
    }
    const parsed = JSON.parse(json);
    return ViewStateSchema.parse(parsed);
  } catch {
    return null;
  }
}

export function buildViewUrl(baseUrl: string, state: ViewState): string {
  const encoded = encodeViewState(state);
  return `${baseUrl}?state=${encoded}`;
}
