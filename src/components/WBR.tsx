"use client";

import { useEffect, useState } from "react";

interface Metric {
  id: string;
  name: string;
  section: string;
  current: number;
  target: number;
  wow: number;
  yoy: number;
  status: "on" | "watch" | "off";
  unit?: string;
}

interface WBRProps {
  workspace: string;
}

export default function WBR({ workspace }: WBRProps) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/views/wbr?workspace=${workspace}`)
      .then((res) => res.json())
      .then((data) => {
        setMetrics(data.metrics || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [workspace]);

  if (loading) {
    return <div className="text-sub">Loading...</div>;
  }

  const sections = Array.from(new Set(metrics.map((m) => m.section)));
  const exceptions = metrics.filter((m) => m.status !== "on");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold mb-2">Weekly Business Review</h2>
        <p className="text-sub text-sm">
          The Amazon method: six trailing weeks beside twelve trailing months, inputs ordered before outputs.
        </p>
      </div>

      {exceptions.length > 0 && (
        <div className="bg-amber/10 border-l-2 border-amber rounded-lg p-4 space-y-2">
          <div className="font-semibold">Exceptions this week</div>
          {exceptions.map((metric) => (
            <div key={metric.id} className="text-sm">
              <span className="font-mono">{metric.name}</span>:{" "}
              <span className="text-sub">
                {metric.status === "off"
                  ? "multiple weeks under target, still falling"
                  : "fresh miss or noisy input"}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {sections.map((section) => {
          const sectionMetrics = metrics.filter((m) => m.section === section);

          return (
            <div key={section} className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-rule bg-panel-2">
                <span className="font-semibold text-sm capitalize">{section}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-rule">
                      <th className="text-left py-2 px-4 font-mono text-[11px] text-faint uppercase tracking-wider">
                        Metric
                      </th>
                      <th className="text-right py-2 px-4 font-mono text-[11px] text-faint uppercase tracking-wider">
                        Current
                      </th>
                      <th className="text-right py-2 px-4 font-mono text-[11px] text-faint uppercase tracking-wider">
                        Target
                      </th>
                      <th className="text-right py-2 px-4 font-mono text-[11px] text-faint uppercase tracking-wider">
                        WoW
                      </th>
                      <th className="text-right py-2 px-4 font-mono text-[11px] text-faint uppercase tracking-wider">
                        YoY
                      </th>
                      <th className="text-center py-2 px-4 font-mono text-[11px] text-faint uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectionMetrics.map((metric) => (
                      <tr key={metric.id} className="border-b border-rule hover:bg-panel-2">
                        <td className="py-2 px-4">{metric.name}</td>
                        <td className="text-right py-2 px-4 font-mono tabular-nums">
                          {metric.current.toLocaleString()}
                          {metric.unit}
                        </td>
                        <td className="text-right py-2 px-4 font-mono tabular-nums text-sub">
                          {metric.target.toLocaleString()}
                          {metric.unit}
                        </td>
                        <td
                          className={`text-right py-2 px-4 font-mono tabular-nums ${
                            metric.wow > 0 ? "text-green" : metric.wow < 0 ? "text-amber" : "text-sub"
                          }`}
                        >
                          {metric.wow > 0 ? "+" : ""}
                          {metric.wow}%
                        </td>
                        <td
                          className={`text-right py-2 px-4 font-mono tabular-nums ${
                            metric.yoy > 0 ? "text-green" : metric.yoy < 0 ? "text-amber" : "text-sub"
                          }`}
                        >
                          {metric.yoy > 0 ? "+" : ""}
                          {metric.yoy}%
                        </td>
                        <td className="text-center py-2 px-4">
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${
                              metric.status === "on"
                                ? "bg-green"
                                : metric.status === "watch"
                                ? "bg-amber"
                                : "bg-red-500"
                            }`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
