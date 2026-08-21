/**
 * Designed empty states for the five dashboard views.
 * One card: what the view will show + a single next action.
 *
 * First-run setup (ANY-59) is `/connect?setup=1`. That query is ignored
 * until the wizard lands; `/connect` stays the settings page.
 */

export const VIEW_IDS = [
  "dotplot",
  "cohorts",
  "wbr",
  "calendar",
  "pmf",
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

export type ViewEmptyCopy = {
  title: string;
  what: string;
  action: string;
};

export const VIEW_EMPTY_COPY: Record<ViewId, ViewEmptyCopy> = {
  dotplot: {
    title: "Dot plot",
    what: "Every person as a row of days — who showed up, who faded, who just arrived.",
    action: "Connect a source",
  },
  cohorts: {
    title: "Cohort retention",
    what: "Retention by signup week, and whether the curve smiles.",
    action: "Connect a source",
  },
  wbr: {
    title: "Weekly Business Review",
    what: "The weekly scorecard — finance, acquisition, activation, retention, and what is off.",
    action: "Connect a source",
  },
  calendar: {
    title: "Calendar",
    what: "Launches, rituals, and milestones from the tools you already use. Read-only — nothing here is typed in.",
    action: "Connect a source",
  },
  pmf: {
    title: "PMF+",
    what: "Who to talk to next, and drafts you approve before anything sends.",
    action: "Connect a source",
  },
};

/** First-run wizard when present; `/connect` otherwise still loads. */
export function viewEmptyActionHref(workspace?: string): string {
  const params = new URLSearchParams({ setup: "1" });
  if (workspace) params.set("workspace", workspace);
  return `/connect?${params.toString()}`;
}

export function viewEmptyTestId(view: ViewId): string {
  return `view-empty-${view}`;
}

export function viewEmptyActionTestId(view: ViewId): string {
  return `view-empty-${view}-action`;
}
