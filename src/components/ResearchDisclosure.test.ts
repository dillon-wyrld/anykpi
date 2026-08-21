import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { asResearchCandidate, outgoingFromPerson } from "./ResearchDisclosure";

describe("outgoing fields for a research launch", () => {
  it("lists name and country, never email or person id", () => {
    expect(
      outgoingFromPerson({ name: "River", country: "GB" })
    ).toEqual([
      { field: "name", value: "River" },
      { field: "country", value: "GB" },
    ]);
    const candidate = asResearchCandidate({
      personId: "p-river",
      name: "River",
      country: "GB",
      platform: "web",
    });
    expect(candidate.outgoing.map((f) => f.field)).toEqual(["name", "country"]);
    expect(JSON.stringify(candidate.outgoing)).not.toContain("p-river");
  });
});

describe("✨ entry points", () => {
  const root = resolve(__dirname, "../..");

  it("wires ✨ on the dot-plot row, person panel, and filtered view", () => {
    const dotplot = readFileSync(resolve(root, "src/components/DotPlot.tsx"), "utf8");
    const panel = readFileSync(resolve(root, "src/components/PersonPanel.tsx"), "utf8");
    const pmf = readFileSync(resolve(root, "src/components/PMF.tsx"), "utf8");

    expect(dotplot).toContain("dotplot-research-");
    expect(dotplot).toContain("Research ${user.name}");
    expect(dotplot).toContain("dotplot-research-view");
    expect(dotplot).toContain("Research this view");

    expect(panel).toContain("person-research");
    expect(panel).toContain("Research ${title}");

    expect(pmf).toContain("pmf-research-view");
    expect(pmf).toContain("Research this view");
    expect(pmf).toContain("ResearchDisclosure");
  });
});
