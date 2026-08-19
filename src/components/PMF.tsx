"use client";

import { useEffect, useState } from "react";

interface PMFCard {
  name: string;
  emoji: string;
  headline: string;
  sources: string[];
}

interface PMFRun {
  id: string;
  target: string;
  targetEmoji: string;
  status: "running" | "complete";
  cardsCount: number;
  queuedCount: number;
  cards?: PMFCard[];
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
        <div className="space-y-6">
          {runs.map((run) => (
            <div key={run.id} className="space-y-3">
              <div className="bg-panel border border-border rounded-lg p-4">
                <div className="flex items-center gap-3">
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
              </div>

              {run.cards && run.cards.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {run.cards.map((card, idx) => (
                    <div key={idx} className="bg-panel border border-border rounded-lg p-4 hover:border-accent transition-colors">
                      <div className="flex items-start gap-3 mb-3">
                        <span className="text-3xl">{card.emoji}</span>
                        <div className="flex-1">
                          <div className="font-semibold text-lg">{card.name}</div>
                        </div>
                      </div>
                      <div className="text-sm text-sub mb-3">
                        {card.headline}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {card.sources.map((source, i) => (
                          <span
                            key={i}
                            className="text-xs px-2 py-1 rounded bg-panel-2 text-faint font-mono uppercase tracking-wider"
                          >
                            {source}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
