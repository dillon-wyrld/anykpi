"use client";

import { useEffect, useState } from "react";

interface CohortData {
  cohort: string;
  weeks: number[];
  smileDetected: boolean;
}

interface CohortsProps {
  workspace: string;
}

export default function Cohorts({ workspace }: CohortsProps) {
  const [cohorts, setCohorts] = useState<CohortData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/views/cohorts?workspace=${workspace}`)
      .then((res) => res.json())
      .then((data) => {
        setCohorts(data.cohorts || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [workspace]);

  if (loading) {
    return <div className="text-sub">Loading...</div>;
  }

  const smilingCount = cohorts.filter((c) => c.smileDetected).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold mb-2">Cohorts</h2>
        <p className="text-sub text-sm">
          Retention triangles and decay curves. Watch for the smile — curves that flatten instead of falling to zero.
        </p>
      </div>

      {smilingCount >= 3 && (
        <div className="bg-green-soft border border-green rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">🎉</span>
            <span className="font-semibold text-green">Product-market fit is forming</span>
          </div>
          <p className="text-sm text-sub">
            {smilingCount} cohorts are showing the smile — they're sticking around instead of dropping off.
            Go tell the group chat.
          </p>
        </div>
      )}

      <div className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-rule bg-panel-2">
          <span className="font-semibold text-sm">Weekly Cohorts</span>
        </div>

        <div className="p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule">
                <th className="text-left py-2 px-3 font-mono text-[11px] text-faint uppercase tracking-wider">
                  Cohort
                </th>
                {Array.from({ length: 8 }, (_, i) => (
                  <th
                    key={i}
                    className="text-right py-2 px-3 font-mono text-[11px] text-faint uppercase tracking-wider"
                  >
                    W{i}
                  </th>
                ))}
                <th className="text-center py-2 px-3 font-mono text-[11px] text-faint uppercase tracking-wider">
                  PMF
                </th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((cohort) => (
                <tr key={cohort.cohort} className="border-b border-rule hover:bg-panel-2">
                  <td className="py-2 px-3 font-mono text-xs">{cohort.cohort}</td>
                  {cohort.weeks.map((val, i) => (
                    <td key={i} className="text-right py-2 px-3 font-mono text-xs tabular-nums">
                      {val !== null ? `${val}%` : "—"}
                    </td>
                  ))}
                  <td className="text-center py-2 px-3">
                    {cohort.smileDetected ? (
                      <span className="text-green text-base">😊</span>
                    ) : (
                      <span className="text-faint text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-rule text-xs text-sub">
          <p>
            Each row is a signup week. Numbers show the % who came back in that week.
            The smile appears when a curve flattens — people simply keep coming back.
          </p>
        </div>
      </div>
    </div>
  );
}
