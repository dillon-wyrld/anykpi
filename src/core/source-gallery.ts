/**
 * First-run source gallery. Claims must match `src/connectors/`:
 * shipped ids are the registry; roadmap cards carry a ticket label.
 *
 * Safe for client pages — no database imports.
 */

export const GALLERY_CATEGORIES = [
  "analytics",
  "revenue",
  "banking",
  "calendar",
  "code",
] as const;

export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];

export type GalleryStatus = "shipped" | "roadmap";

export type GalleryCard = {
  id: string;
  name: string;
  logo: string;
  valueProp: string;
  category: GalleryCategory;
  status: GalleryStatus;
  /** Roadmap cards must name the ticket that owns the connector. */
  ticket?: string;
};

/** Registry sources in `src/connectors/`. Drift-tested against `registry`. */
export const SHIPPED_SOURCE_IDS = [
  "posthog",
  "mixpanel",
  "amplitude",
  "stripe",
  "revenuecat",
  "mercury",
  "ics",
  "github",
] as const;

export type ShippedSourceId = (typeof SHIPPED_SOURCE_IDS)[number];

export const SHIPPED_GALLERY: GalleryCard[] = [
  {
    id: "posthog",
    name: "PostHog",
    logo: "📊",
    valueProp: "Product analytics you already run. Syncs summaries; never writes back.",
    category: "analytics",
    status: "shipped",
  },
  {
    id: "mixpanel",
    name: "Mixpanel",
    logo: "📈",
    valueProp: "Product analytics. Syncs summaries; never writes back.",
    category: "analytics",
    status: "shipped",
  },
  {
    id: "amplitude",
    name: "Amplitude",
    logo: "📉",
    valueProp: "Digital analytics. Syncs summaries; never writes back.",
    category: "analytics",
    status: "shipped",
  },
  {
    id: "stripe",
    name: "Stripe",
    logo: "💳",
    valueProp: "Restricted read-only key for subscription backfill and minutes-fresh MRR.",
    category: "revenue",
    status: "shipped",
  },
  {
    id: "revenuecat",
    name: "RevenueCat",
    logo: "📱",
    valueProp: "Mobile subscription data for calendar and metrics.",
    category: "revenue",
    status: "shipped",
  },
  {
    id: "mercury",
    name: "Mercury",
    logo: "🏦",
    valueProp: "Banking data for payroll and runway tracking.",
    category: "banking",
    status: "shipped",
  },
  {
    id: "ics",
    name: "Calendar",
    logo: "📅",
    valueProp: "Paste a read-only calendar URL. Nothing is written back.",
    category: "calendar",
    status: "shipped",
  },
  {
    id: "github",
    name: "GitHub",
    logo: "🚀",
    valueProp: "Release tracking for calendar ship days.",
    category: "code",
    status: "shipped",
  },
];

/**
 * Planned sources that are not in `src/connectors/` yet.
 * Every card must set `ticket` (drift-tested).
 */
export const ROADMAP_GALLERY: GalleryCard[] = [];

export const GALLERY_CARDS: GalleryCard[] = [...SHIPPED_GALLERY, ...ROADMAP_GALLERY];

export const CATEGORY_LABELS: Record<GalleryCategory, string> = {
  analytics: "Analytics",
  revenue: "Revenue",
  banking: "Banking",
  calendar: "Calendar",
  code: "Code",
};

export function shippedSourceIds(): string[] {
  return SHIPPED_GALLERY.map((card) => card.id).sort();
}

export function filterGallery(
  cards: GalleryCard[],
  query: string,
  category: GalleryCategory | "all"
): GalleryCard[] {
  const needle = query.trim().toLowerCase();
  return cards.filter((card) => {
    if (category !== "all" && card.category !== category) return false;
    if (!needle) return true;
    return (
      card.name.toLowerCase().includes(needle) ||
      card.valueProp.toLowerCase().includes(needle) ||
      card.id.toLowerCase().includes(needle)
    );
  });
}

export function statusLabel(card: GalleryCard): string {
  if (card.status === "shipped") return "Shipped";
  return card.ticket ? `Roadmap · ${card.ticket}` : "Roadmap";
}
