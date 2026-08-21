"use client";

import { useEffect, useState } from "react";
import {
  hasRealSync,
  readBannerDismissed,
  readLabeledDemo,
  shouldShowDemoBanner,
  writeBannerDismissed,
} from "@/core/setup-flow";

type SyncBody = {
  states?: Array<{ source: string; lastSync?: string | null; status?: string }>;
};

export function DemoBanner({ workspace }: { workspace: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const dismissed = readBannerDismissed(workspace);
    const labeledDemo = workspace === "demo" || readLabeledDemo(workspace);

    void fetch(`/api/v1/sync?workspace=${encodeURIComponent(workspace)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: SyncBody | null) => {
        if (cancelled) return;
        const real = hasRealSync(workspace, data?.states ?? []);
        setVisible(
          shouldShowDemoBanner({
            workspaceId: workspace,
            dismissed,
            hasRealSync: real,
            labeledDemo,
          })
        );
      })
      .catch(() => {
        if (cancelled) return;
        setVisible(
          shouldShowDemoBanner({
            workspaceId: workspace,
            dismissed,
            hasRealSync: false,
            labeledDemo,
          })
        );
      });

    return () => {
      cancelled = true;
    };
  }, [workspace]);

  if (!visible) return null;

  return (
    <div
      data-testid="demo-banner"
      className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-accent-line bg-accent-soft px-4 py-3 text-sm"
    >
      <p>
        You&apos;re on demo data. Connect a source when you&apos;re ready — this
        banner stays until real data arrives.
      </p>
      <button
        type="button"
        data-testid="demo-banner-dismiss"
        onClick={() => {
          writeBannerDismissed(workspace);
          setVisible(false);
        }}
        className="shrink-0 text-xs font-mono uppercase tracking-wider text-sub hover:text-text"
      >
        Dismiss
      </button>
    </div>
  );
}
