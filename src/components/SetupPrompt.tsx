"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  hasCompanyProfile,
  hasConnectedSources,
  readSetupStatus,
  setupPath,
  shouldShowSetup,
  writeSetupStatus,
} from "@/core/setup-flow";

type ConfigBody = {
  companyName?: string;
  foundedAt?: string | null;
  homeCity?: { timezone: string; label: string } | null;
};

type SyncBody = {
  states?: Array<{ source: string }>;
};

export function SetupPrompt({ workspace }: { workspace: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const status = readSetupStatus(workspace);

    Promise.all([
      fetch(`/api/v1/config?workspace=${encodeURIComponent(workspace)}`).then(
        (response) => (response.ok ? response.json() : null)
      ),
      fetch(`/api/v1/sync?workspace=${encodeURIComponent(workspace)}`).then(
        (response) => (response.ok ? response.json() : null)
      ),
    ])
      .then(([config, sync]: [ConfigBody | null, SyncBody | null]) => {
        if (cancelled) return;
        setVisible(
          shouldShowSetup({
            workspaceId: workspace,
            status,
            hasProfile: config ? hasCompanyProfile(config) : false,
            hasConnections: hasConnectedSources(
              (sync?.states ?? []).map((row) => row.source)
            ),
          })
        );
      })
      .catch(() => {
        if (!cancelled) {
          setVisible(
            shouldShowSetup({
              workspaceId: workspace,
              status,
              hasProfile: false,
              hasConnections: false,
            })
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspace]);

  if (!visible) return null;

  return (
    <div
      data-testid="setup-prompt"
      className="mb-4 rounded-lg border border-accent-line bg-accent-soft px-4 py-4"
    >
      <h2 className="font-display text-lg font-semibold">Set up this workspace</h2>
      <p className="text-sm text-sub mt-1 mb-3">
        Three steps: company profile, a source, then first data or the labeled demo.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href={setupPath(workspace)}
          data-testid="setup-prompt-start"
          className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90"
        >
          Start setup
        </Link>
        <button
          type="button"
          data-testid="setup-prompt-skip"
          onClick={() => {
            writeSetupStatus(workspace, "skipped");
            setVisible(false);
          }}
          className="px-4 py-2 border border-border rounded text-sm hover:bg-panel-2"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
