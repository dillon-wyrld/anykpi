"use client";

import { useEffect, useState } from "react";

interface Metric {
  id: string;
  name: string;
  section: string;
  owner: string;
  type: string;
  current: number;
  target: number;
  wow: number;
  yoy: number;
  status: "on" | "watch" | "off";
  statusReason?: string;
  unit?: string;
  goodDir: string;
  weeks: number[];
  months: number[];
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

  const renderMiniChart = (metric: Metric) => {
    const data = metric.months.length >= 6 ? metric.months : metric.weeks;
    if (!data.length) return null;

    const max = Math.max(...data, metric.target);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    
    const w = 120;
    const h = 36;
    const pad = 4;
    
    const points = data.map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    }).join(' ');

    const targetY = h - pad - ((metric.target - min) / range) * (h - pad * 2);

    return (
      <svg width={w} height={h} className="inline-block">
        <line x1={pad} y1={targetY} x2={w - pad} y2={targetY} stroke="var(--faint)" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
        <polyline 
          points={points}
          fill="none"
          stroke={metric.status === "on" ? "var(--green)" : metric.status === "watch" ? "var(--amber)" : "var(--red)"}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {data.map((v, i) => {
          const x = pad + (i / (data.length - 1)) * (w - pad * 2);
          const y = h - pad - ((v - min) / range) * (h - pad * 2);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="2"
              fill={metric.status === "on" ? "var(--green)" : metric.status === "watch" ? "var(--amber)" : "var(--red)"}
            />
          );
        })}
      </svg>
    );
  };

  return (
    <div className="space-y-4">
      {exceptions.length > 0 && (
        <div className="bg-amber/10 border-l-3 border-amber rounded-lg p-3">
          <div className="text-sm font-semibold mb-1">{exceptions.length} exception{exceptions.length > 1 ? 's' : ''}</div>
          {exceptions.map((metric) => (
            <div key={metric.id} className="text-xs text-sub">
              {metric.name}: {metric.statusReason || metric.status}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {metrics.map((metric) => (
          <div key={metric.id} className="bg-panel border border-border rounded-lg shadow-sm p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-semibold text-sm">{metric.name}</div>
                <div className="text-xs text-sub mt-0.5">
                  {metric.owner} · {metric.type}
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  metric.status === "on"
                    ? "bg-green-soft text-green"
                    : metric.status === "watch"
                    ? "bg-amber/10 text-amber"
                    : "bg-red/10 text-red"
                }`}
              >
                {metric.status}
              </span>
            </div>

            <div className="flex items-end justify-between mb-3">
              <div>
                <div className="text-2xl font-semibold tabular-nums">
                  {metric.current.toLocaleString()}
                  <span className="text-base text-sub ml-1">{metric.unit}</span>
                </div>
                <div className="text-xs text-sub mt-1">
                  target: {metric.target.toLocaleString()}{metric.unit}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-sub">WoW</div>
                <div
                  className={`text-sm font-semibold tabular-nums ${
                    metric.wow > 0 ? "text-green" : metric.wow < 0 ? "text-red" : "text-sub"
                  }`}
                >
                  {metric.wow > 0 ? "+" : ""}{metric.wow}%
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-sub">YoY</div>
                <div
                  className={`text-sm font-semibold tabular-nums ${
                    metric.yoy > 0 ? "text-green" : metric.yoy < 0 ? "text-red" : "text-sub"
                  }`}
                >
                  {metric.yoy > 0 ? "+" : ""}{metric.yoy}%
                </div>
              </div>
            </div>

            <div className="border-t border-rule pt-3">
              {renderMiniChart(metric)}
              <div className="text-xs text-sub text-center mt-1">
                {metric.months.length >= 6 ? "12 months" : "12 weeks"}
              </div>
            </div>
          </div>
        ))}
      </div>

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
                      <th className="text-center py-2 px-4 font-mono text-[11px] text-faint uppercase tracking-wider">
                        Chart
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectionMetrics.map((metric) => (
                      <tr key={metric.id} className="border-b border-rule hover:bg-panel-2">
                        <td className="py-2 px-4">
                          {metric.name}
                          <div className="text-xs text-sub">{metric.owner}</div>
                        </td>
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
