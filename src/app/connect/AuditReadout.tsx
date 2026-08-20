"use client";

import { useCallback, useState } from "react";

type AuditRow = {
  id: number;
  actor: string;
  action: string;
  subject: string;
  createdAt: string;
};

/**
 * Thin /connect readout of recent writes. Uses the same API key field
 * already on the page. Session UI lives on a separate ticket.
 */
export function AuditReadout({ apiKey }: { apiKey: string }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!apiKey) {
      setError("Enter an API key to load recent writes.");
      setRows(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/audit?workspace=live&limit=20", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = (await response.json()) as {
        error?: string;
        entries?: AuditRow[];
      };
      if (!response.ok) {
        setError(data.error || "Could not load audit log");
        setRows(null);
        return;
      }
      setRows(data.entries ?? []);
    } catch {
      setError("Could not load audit log");
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  return (
    <section className="bg-panel border border-border rounded-lg p-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Recent writes</h2>
          <p className="text-sm text-sub">
            What agents and keys changed. Query{" "}
            <code className="font-mono text-xs">GET /api/v1/audit</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Loading…" : "Load audit log"}
        </button>
      </div>
      {error && <p className="text-sm text-sub">{error}</p>}
      {rows && rows.length === 0 && (
        <p className="text-sm text-sub">No writes recorded yet.</p>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-mono uppercase tracking-wider text-faint">
                <th className="pb-2 pr-3">When</th>
                <th className="pb-2 pr-3">Actor</th>
                <th className="pb-2 pr-3">Action</th>
                <th className="pb-2">Subject</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-2 pr-3 font-mono text-xs">
                    {row.createdAt.replace("T", " ").replace(/\.\d+Z$/, "Z")}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{row.actor}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{row.action}</td>
                  <td className="py-2 font-mono text-xs">{row.subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
