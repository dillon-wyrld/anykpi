"use client";

import { useEffect, useState } from "react";

type CatalogRow = {
  id: string;
  name: string;
};

/** Exact display-name match after trim. Mirrors REST confirmation. */
export function typedNameConfirms(typed: string, name: string): boolean {
  return typed.trim() === name;
}

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
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
  const current =
    options.find((row) => row.id === workspace) ?? { id: workspace, name: workspace };
  const confirmed = typedNameConfirms(typed, current.name);

  async function onDelete() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/workspaces", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: workspace, name: typed.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(
          typeof body.error === "string" ? body.error : "Could not delete workspace"
        );
        return;
      }
      const fallback = options.find((row) => row.id !== workspace)?.id ?? "demo";
      window.location.href = `/dashboard?workspace=${encodeURIComponent(fallback)}&view=${encodeURIComponent(view)}`;
    } catch {
      setError("Could not delete workspace");
    } finally {
      setBusy(false);
    }
  }

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

      {confirming ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] text-sub leading-snug">
            Type <span className="font-mono">{current.name}</span> to delete this
            workspace and all of its data.
          </p>
          <input
            aria-label="Type workspace name to confirm delete"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setError(null);
            }}
            className="w-full text-xs bg-panel border border-border rounded px-2 py-1 font-mono"
            autoComplete="off"
          />
          {error ? (
            <p className="text-[10px]" style={{ color: "var(--red)" }}>
              {error}
            </p>
          ) : null}
          <div className="flex gap-1">
            <button
              type="button"
              disabled={!confirmed || busy}
              onClick={() => {
                void onDelete();
              }}
              className="flex-1 text-[10px] px-2 py-1 rounded border border-border hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setTyped("");
                setError(null);
              }}
              className="text-[10px] px-2 py-1 rounded text-sub hover:bg-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-1 w-full text-left text-[10px] text-sub hover:bg-hover rounded px-0 py-1"
        >
          Delete workspace
        </button>
      )}
    </div>
  );
}
