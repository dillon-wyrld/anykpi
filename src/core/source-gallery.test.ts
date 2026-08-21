import { describe, expect, it } from "vitest";
import { registry } from "@/connectors";
import {
  CATEGORY_LABELS,
  filterGallery,
  GALLERY_CARDS,
  GALLERY_CATEGORIES,
  ROADMAP_GALLERY,
  SHIPPED_GALLERY,
  SHIPPED_SOURCE_IDS,
  shippedSourceIds,
  statusLabel,
} from "./source-gallery";

describe("source gallery claims match src/connectors/", () => {
  it("shipped cards are exactly the connector registry", () => {
    const registryIds = Object.keys(registry).sort();
    expect([...SHIPPED_SOURCE_IDS].sort()).toEqual(registryIds);
    expect(shippedSourceIds()).toEqual(registryIds);
    expect(SHIPPED_GALLERY.map((card) => card.id).sort()).toEqual(registryIds);
    expect(SHIPPED_GALLERY.every((card) => card.status === "shipped")).toBe(true);
    expect(SHIPPED_GALLERY.every((card) => card.ticket === undefined)).toBe(true);
  });

  it("every shipped card has a logo and a one-line value prop", () => {
    for (const card of SHIPPED_GALLERY) {
      expect(card.logo.length).toBeGreaterThan(0);
      expect(card.valueProp.trim().length).toBeGreaterThan(8);
      expect(card.valueProp).not.toMatch(/coming soon/i);
      expect(GALLERY_CATEGORIES).toContain(card.category);
    }
  });

  it("roadmap cards carry a ticket label", () => {
    for (const card of ROADMAP_GALLERY) {
      expect(card.status).toBe("roadmap");
      expect(card.ticket, `${card.id} needs a ticket`).toMatch(/^ANY-\d+$/);
      expect(statusLabel(card)).toContain(card.ticket);
    }
    expect(GALLERY_CARDS).toEqual([...SHIPPED_GALLERY, ...ROADMAP_GALLERY]);
  });

  it("registry names match gallery names", () => {
    for (const card of SHIPPED_GALLERY) {
      expect(registry[card.id]?.name).toBe(card.name);
    }
  });

  it("search and category chips filter the catalog", () => {
    expect(filterGallery(GALLERY_CARDS, "post", "all").map((c) => c.id)).toEqual([
      "posthog",
    ]);
    expect(
      filterGallery(GALLERY_CARDS, "", "revenue").map((c) => c.id).sort()
    ).toEqual(["revenuecat", "stripe"]);
    expect(filterGallery(GALLERY_CARDS, "runway", "all").map((c) => c.id)).toEqual([
      "mercury",
    ]);
    expect(filterGallery(GALLERY_CARDS, "no-such-source", "all")).toEqual([]);
    expect(CATEGORY_LABELS.analytics).toBe("Analytics");
  });
});
