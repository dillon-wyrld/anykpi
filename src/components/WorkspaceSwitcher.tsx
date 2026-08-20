"use client";

import { useEffect, useState } from "react";

type CatalogRow = {
  id: string;
  name: string;
};

export function WorkspaceSwitcher({
  workspace,
  view,
}: {
  workspace: string;
  view: string;
}) {
  const [rows, setRows] = useState<CatalogRow[]>([
    { id: "demo", name: "Demo" },
    { id: "live", name: "Live" },
  ]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/workspaces")
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { workspaces?: CatalogRow[] };
        if (!cancelled && Array.isArray(data.workspaces) && data.workspaces.length > 0) {
          setRows(data.workspaces.map((row) => ({ id: row.id, name: row.name })));
        }
      })
      .catch(() => {
        // Keep the demo / live fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = rows.some((row) => row.id === workspace)
    ? rows
    : [...rows, { id: workspace, name: workspace }];

  return (
    <div className="px-2 mb-2">
      <div className="eyebrow text-[9px] mb-1">Workspace</div>
      <select
        aria-label="Workspace"
        value={workspace}
        onChange={(event) => {
          const next = event.target.value;
          window.location.href = `/dashboard?workspace=${encodeURIComponent(next)}&view=${encodeURIComponent(view)}`;
        }}
        className="w-full text-xs bg-panel border border-border rounded px-2 py-1 font-mono"
      >
        {options.map((row) => (
          <option key={row.id} value={row.id}>
            {row.id}
          </option>
        ))}
      </select>
    </div>
  );
}
