import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { ViewEmptyState } from "@/components/ViewEmptyState";
import {
  VIEW_EMPTY_COPY,
  VIEW_IDS,
  viewEmptyActionHref,
  viewEmptyActionTestId,
  viewEmptyTestId,
  type ViewId,
} from "@/components/view-empty-state";

const VIEW_FILES: Record<ViewId, string> = {
  dotplot: "src/components/DotPlot.tsx",
  cohorts: "src/components/Cohorts.tsx",
  wbr: "src/components/WBR.tsx",
  calendar: "src/components/Calendar.tsx",
  pmf: "src/components/PMF.tsx",
};

describe("designed empty states", () => {
  it("gives each of the five views what it will show and one next action", () => {
    expect(VIEW_IDS).toHaveLength(5);

    for (const view of VIEW_IDS) {
      const copy = VIEW_EMPTY_COPY[view];
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.what.length).toBeGreaterThan(20);
      expect(copy.action).toBe("Connect a source");

      const html = renderToStaticMarkup(
        createElement(ViewEmptyState, { view, workspace: "fresh" })
      );
      expect(html).toContain(`data-testid="${viewEmptyTestId(view)}"`);
      expect(html).toContain(copy.title);
      expect(html).toContain(copy.what);
      expect(html).toContain(copy.action);
      expect(html).toContain('href="/connect?setup=1&amp;workspace=fresh"');
      expect(html.match(/<a /g)).toHaveLength(1);
      expect(html).toContain(viewEmptyActionTestId(view));
    }
  });

  it("links into first-run setup when that path is the next action", () => {
    expect(viewEmptyActionHref("live")).toBe("/connect?setup=1&workspace=live");
    expect(viewEmptyActionHref()).toBe("/connect?setup=1");
  });

  it("wires one empty state into each view component", () => {
    const root = resolve(__dirname, "../..");
    for (const view of VIEW_IDS) {
      const source = readFileSync(resolve(root, VIEW_FILES[view]), "utf8");
      expect(source).toContain("ViewEmptyState");
      expect(source).toContain(`view="${view}"`);
    }
  });
});
