"use client";

import { useEffect, useState } from "react";

interface PMFRun {
  id: string;
  target: string;
  targetEmoji: string;
  status: "running" | "complete";
  cardsCount: number;
  queuedCount: number;
}

interface PMFProps {
  workspace: string;
}

export default function PMF({ workspace }: PMFProps) {
  const [runs, setRuns] = useState<PMFRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/views/pmf?workspace=${workspace}`)
      .then((res) => res.json())
      .then((data) => {
        setRuns(data.runs || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [workspace]);

  if (loading) {
    return <div className="text-sub">Loading...</div>;
  }

  const queuedTotal = runs.reduce((sum, r) => sum + r.queuedCount, 0);

  return (
    <div className="space-y-4">
      {queuedTotal > 0 && (
        <div className="bg-amber/10 border-l-3 border-amber rounded-lg p-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📬</span>
            <div>
              <div className="text-sm font-semibold">{queuedTotal} queued</div>
              <div className="text-xs text-sub">Nothing sends on its own</div>
            </div>
          </div>
        </div>
      )}

      {runs.length === 0 ? (
        <div className="bg-panel border border-border rounded-lg p-8 text-center">
          <div className="text-4xl mb-2">✨</div>
          <div className="text-sm text-sub">Click ✨ on any user or group to start research</div>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <div key={run.id} className="bg-panel border border-border rounded-lg p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{run.targetEmoji}</span>
                <div className="flex-1">
                  <div className="font-semibold">{run.target}</div>
                  <div className="text-xs text-sub">
                    {run.cardsCount} cards · {run.queuedCount} queued
                  </div>
                </div>
                <div className={`text-xs px-2 py-1 rounded ${run.status === "running" ? "bg-accent-soft text-accent" : "bg-green-soft text-green"}`}>
                  {run.status}
                </div>
              </div>
              <div className="text-sm text-sub">
                Research complete. Review cards and drafts in queue.
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
