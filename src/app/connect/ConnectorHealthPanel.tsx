"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  presentConnectorHealth,
  syncStatesToHealth,
  type ConnectorHealthRow,
} from "@/core/connector-health";
import type { SyncHealth } from "@/core/contracts";

type SyncStateRow = {
  source: string;
  sourceName: string;
  lastSync?: string;
  status: SyncHealth["status"];
  error?: string;
};

/**
 * Presentational list so tests can render an errored fixture without fetch.
 */
export function ConnectorHealthList({
  rows,
  syncing,
  onSync,
}: {
  rows: ConnectorHealthRow[];
  syncing: string | null;
  onSync: (source: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-sub">
        No sources have synced yet. Connect a tool, then sync now.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <article
          key={row.source}
          className="border border-border rounded-lg p-4 space-y-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-base">{row.sourceName}</h3>
              <p className="text-xs font-mono uppercase tracking-wider text-faint">
                {row.status === "error"
                  ? "Needs attention"
                  : row.status === "pending"
                    ? "Syncing"
                    : "Healthy"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSync(row.source)}
              disabled={syncing === row.source}
              className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-60"
            >
              {syncing === row.source
                ? "Syncing…"
                : `Sync ${row.sourceName} now`}
            </button>
          </div>

          <dl className="grid sm:grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs font-mono uppercase tracking-wider text-faint">
                Last sync
              </dt>
              <dd>
                {row.lastSyncLabel}
                {row.lastSynced ? (
                  <span className="block font-mono text-xs text-faint">
                    {row.lastSynced}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-mono uppercase tracking-wider text-faint">
                Rows synced
              </dt>
              <dd>{row.rowsLabel} rows</dd>
            </div>
            <div>
              <dt className="text-xs font-mono uppercase tracking-wider text-faint">
                Next run
              </dt>
              <dd>
                {row.nextRunLabel}
                {row.nextRunAt ? (
                  <span className="block font-mono text-xs text-faint">
                    {row.nextRunAt}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          {row.problem && row.nextStep ? (
            <div className="text-sm rounded-lg p-3 border border-border space-y-1">
              <p>{row.problem}</p>
              <p className="text-sub">{row.nextStep}</p>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

/**
 * Trust surface for connected sources. Reads overview.syncHealth plus
 * GET /api/v1/sync (interval + sync_state). Sync now is POST /api/v1/sync.
 */
export function ConnectorHealthPanel({
  apiKey,
  workspace,
}: {
  apiKey: string;
  workspace: string;
}) {
  const [health, setHealth] = useState<SyncHealth[] | null>(null);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [rowsSynced, setRowsSynced] = useState<Record<string, number>>({});

  const rows = useMemo(
    () =>
      health
        ? presentConnectorHealth(health, { intervalMinutes, rowsSynced })
        : null,
    [health, intervalMinutes, rowsSynced]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = `workspace=${encodeURIComponent(workspace)}`;
      const auth: Record<string, string> = apiKey
        ? { Authorization: `Bearer ${apiKey}` }
        : {};
      const [overviewRes, syncRes] = await Promise.all([
        fetch(`/api/v1/overview?${query}`, { headers: auth }),
        fetch(`/api/v1/sync?${query}`, { headers: auth }),
      ]);

      if (!overviewRes.ok && !syncRes.ok) {
        const data = (await overviewRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(
          data.error === "Unauthorized" || overviewRes.status === 401
            ? "Enter an API key to load live connector health, or switch the workspace to demo."
            : data.error || "Could not load connector health"
        );
        setHealth(null);
        return;
      }

      const overviewBody = overviewRes.ok
        ? ((await overviewRes.json()) as { syncHealth?: SyncHealth[] })
        : { syncHealth: [] };
      const syncBody = syncRes.ok
        ? ((await syncRes.json()) as {
            states?: SyncStateRow[];
            syncIntervalMinutes?: number;
          })
        : { states: [], syncIntervalMinutes: 15 };

      const nextHealth =
        overviewBody.syncHealth && overviewBody.syncHealth.length > 0
          ? overviewBody.syncHealth
          : syncStatesToHealth(syncBody.states ?? []);

      setIntervalMinutes(syncBody.syncIntervalMinutes ?? 15);
      setHealth(nextHealth);
    } catch {
      setError("Could not load connector health");
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, [apiKey, workspace]);

  useEffect(() => {
    void load();
  }, [load]);

  const syncNow = async (source: string) => {
    if (!apiKey) {
      setError("Writes need an API key. Paste it above, then sync now.");
      return;
    }
    setSyncing(source);
    setError(null);
    try {
      const response = await fetch("/api/v1/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ source, workspace }),
      });
      const data = (await response.json()) as {
        error?: string;
        results?: Array<{ source: string; rowsSynced?: number }>;
        states?: SyncStateRow[];
      };
      if (!response.ok) {
        setError(
          data.error && !/^\d{3}$/.test(data.error)
            ? data.error
            : "Could not sync. Check the API key and try again."
        );
        return;
      }
      const pulled = data.results?.[0]?.rowsSynced;
      if (pulled !== undefined) {
        setRowsSynced((prev) => ({ ...prev, [source]: pulled }));
      }
      await load();
    } catch {
      setError("Could not sync. Check the API key and try again.");
    } finally {
      setSyncing(null);
    }
  };

  return (
    <section className="bg-panel border border-border rounded-lg p-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Connector health</h2>
          <p className="text-sm text-sub">
            Last sync, rows pulled, next scheduled run, and what to do when a
            pull fails. Query{" "}
            <code className="font-mono text-xs">GET /api/v1/overview</code>{" "}
            <code className="font-mono text-xs">syncHealth</code> and{" "}
            <code className="font-mono text-xs">GET /api/v1/sync</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error && <p className="text-sm text-sub">{error}</p>}
      {rows && (
        <ConnectorHealthList
          rows={rows}
          syncing={syncing}
          onSync={(source) => void syncNow(source)}
        />
      )}
    </section>
  );
}
