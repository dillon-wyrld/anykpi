"use client";

import { useMemo, useState } from "react";
import {
  CATEGORY_LABELS,
  filterGallery,
  GALLERY_CARDS,
  GALLERY_CATEGORIES,
  statusLabel,
  type GalleryCard,
  type GalleryCategory,
} from "@/core/source-gallery";

export function SourceGallery({
  onPick,
}: {
  onPick: (card: GalleryCard) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<GalleryCategory | "all">("all");
  const cards = useMemo(
    () => filterGallery(GALLERY_CARDS, query, category),
    [query, category]
  );

  return (
    <div className="space-y-4" data-testid="source-gallery">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sources"
          aria-label="Search sources"
          data-testid="gallery-search"
          className="flex-1 px-3 py-2 text-sm bg-bg border border-border rounded"
        />
      </div>
      <div className="flex flex-wrap gap-2" data-testid="gallery-chips">
        <button
          type="button"
          onClick={() => setCategory("all")}
          className={`text-xs font-mono uppercase tracking-wider rounded px-2 py-1 border ${
            category === "all" ? "border-accent text-accent bg-accent-soft" : "border-border text-sub"
          }`}
        >
          All
        </button>
        {GALLERY_CATEGORIES.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setCategory(id)}
            className={`text-xs font-mono uppercase tracking-wider rounded px-2 py-1 border ${
              category === id ? "border-accent text-accent bg-accent-soft" : "border-border text-sub"
            }`}
          >
            {CATEGORY_LABELS[id]}
          </button>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            data-testid={`gallery-card-${card.id}`}
            data-status={card.status}
            onClick={() => onPick(card)}
            className="bg-panel border border-border rounded-lg p-5 text-left hover:border-accent"
          >
            <div className="flex items-start gap-3">
              <span className="text-3xl" aria-hidden>
                {card.logo}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-base">{card.name}</h3>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-faint border border-border rounded px-1.5 py-0.5">
                    {statusLabel(card)}
                  </span>
                </div>
                <p className="text-sm text-sub mt-1">{card.valueProp}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
      {cards.length === 0 && (
        <p className="text-sm text-sub">No sources match that search.</p>
      )}
    </div>
  );
}
