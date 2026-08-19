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
  const [showConfetti, setShowConfetti] = useState(false);
  const [confettiShown, setConfettiShown] = useState(false);

  useEffect(() => {
    fetch(`/api/views/cohorts?workspace=${workspace}`)
      .then((res) => res.json())
      .then((data) => {
        setCohorts(data.cohorts || []);
        setLoading(false);
        
        // Trigger confetti once if smile detected
        const smilingCount = (data.cohorts || []).filter((c: CohortData) => c.smileDetected).length;
        if (smilingCount >= 3 && !confettiShown) {
          setShowConfetti(true);
          setConfettiShown(true);
          setTimeout(() => setShowConfetti(false), 2500);
        }
      })
      .catch(() => setLoading(false));
  }, [workspace, confettiShown]);

  if (loading) {
    return <div className="text-sub">Loading...</div>;
  }

  const smilingCount = cohorts.filter((c) => c.smileDetected).length;
  const hasSmile = smilingCount >= 3;

  return (
    <div className="space-y-4 relative">
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50">
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              key={i}
              className="absolute text-2xl animate-confetti"
              style={{
                left: `${Math.random() * 100}%`,
                top: `-20px`,
                animationDelay: `${Math.random() * 0.5}s`,
                animationDuration: `${2 + Math.random()}s`,
              }}
            >
              {["🎉", "✨", "😊", "🎊", "⭐"][Math.floor(Math.random() * 5)]}
            </div>
          ))}
        </div>
      )}
      
      {hasSmile && (
        <div className="bg-green-soft border border-green rounded-lg p-3 flex items-center gap-3">
          <span className="text-2xl">😊</span>
          <div className="flex-1">
            <div className="font-semibold text-green text-sm">Smile detected</div>
            <div className="text-xs text-sub">{smilingCount} cohorts flattening</div>
          </div>
        </div>
      )}

      <div className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-rule bg-panel-2">
          <span className="eyebrow text-[10px]">{cohorts.length} cohorts</span>
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
