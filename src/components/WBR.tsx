"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_WBR_EXCEPTION_RULES,
  sheetPct,
  sheetRoll,
  sheetTint,
  wbrBox,
  wbrStat,
  wfmt,
  wsign,
  type WbrExceptionRules,
} from "@/core/views/wbr-math";
import { useFreshness } from "@/components/useFreshness";

interface Metric {
  id: string;
  name: string;
  section: string;
  sectionOrder: string;
  owner: string;
  type: "input" | "output";
  current: number;
  target: number;
  wow: number;
  yoy: number;
  status: "ok" | "watch" | "off";
  statusReason?: string;
  unit?: string;
  goodDir: number;
  dp: number;
  weeks: number[];
  prevWeeks: number[];
  months: number[];
  prevMonths: number[];
  drivers?: string[];
  note?: { w: number; text: string };
  lifecycle?: "proposal" | "active" | "retired";
  sourceKind?: "event_count" | "revenue" | "manual" | "read_model";
}

interface ViewState {
  mode: "deck" | "focus" | "table";
  focusIndex: number;
}

interface WBRProps {
  workspace: string;
}

const SECTIONS = [
  { id: "fin", n: "01", name: "Finance", cap: "the score — reported, never debated" },
  { id: "acq", n: "02", name: "Acquisition", cap: "how many arrive" },
  { id: "act", n: "03", name: "Activation", cap: "how many reach value" },
  { id: "eng", n: "04", name: "Engagement & retention", cap: "how many stay" },
  { id: "qua", n: "05", name: "Quality & support", cap: "what it costs them to stay" },
];

const MONTHS = ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];

const TOK = { off: "⭕", watch: "👀", ok: "" };
const FLAGTXT = { off: "exceptional variation — discuss", watch: "watch", ok: "routine" };

function encodeViewState(vs: ViewState): string {
  const params = new URLSearchParams();
  if (vs.mode !== "deck") params.set("m", vs.mode);
  if (vs.focusIndex > 0) params.set("i", vs.focusIndex.toString());
  const str = params.toString();
  return str ? `?${str}` : "";
}

function decodeViewState(searchParams: URLSearchParams): Partial<ViewState> {
  const vs: Partial<ViewState> = {};
  if (searchParams.has("m")) vs.mode = searchParams.get("m") as any;
  if (searchParams.has("i")) vs.focusIndex = parseInt(searchParams.get("i")!, 10);
  return vs;
}


export default function WBR({ workspace }: WBRProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const defaultViewState: ViewState = {
    mode: "deck",
    focusIndex: 0,
  };

  const urlState = decodeViewState(searchParams);
  const [viewState, setViewState] = useState<ViewState>({
    ...defaultViewState,
    ...urlState,
  });

  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [proposals, setProposals] = useState<Metric[]>([]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    section: "acq",
    type: "input" as "input" | "output",
    unit: "",
    target: "",
    goodDir: "up" as "up" | "down",
    sourceKind: "event_count" as "event_count" | "revenue" | "manual",
    eventName: "",
    measure: "actives" as "signups" | "actives" | "retention" | "events",
    series: "mrr" as "mrr" | "new" | "churned" | "arpu" | "runway",
    csv: "",
  });
  const [exceptionRules, setExceptionRules] = useState<WbrExceptionRules>(
    DEFAULT_WBR_EXCEPTION_RULES
  );
  const [metricsWithStats, setMetricsWithStats] = useState<(Metric & { i: number; stat: ReturnType<typeof wbrStat> })[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const initialSyncDone = useRef(false);

  const loadWbr = useCallback((refresh = false) => {
    fetch(`/api/views/wbr?workspace=${workspace}`)
      .then((res) => res.json())
      .then((data) => {
        setMetrics(data.metrics || []);
        setProposals(data.proposals || []);
        if (data.exceptionRules) setExceptionRules(data.exceptionRules);
        if (!refresh) setLoading(false);
      })
      .catch(() => {
        if (!refresh) setLoading(false);
      });
  }, [workspace]);

  const mutateDeck = useCallback(
    async (method: "POST" | "PATCH", body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/v1/metrics?workspace=${encodeURIComponent(workspace)}`, {
          method,
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, workspace }),
        });
        if (!res.ok) return;
        loadWbr(true);
      } finally {
        setBusy(false);
      }
    },
    [workspace, loadWbr]
  );

  const acceptStarter = useCallback(() => {
    return mutateDeck("PATCH", { action: "accept" });
  }, [mutateDeck]);

  const saveNewMetric = useCallback(() => {
    if (!form.name.trim()) return;
    const source =
      form.sourceKind === "revenue"
        ? { kind: "revenue", series: form.series }
        : form.sourceKind === "manual"
          ? { kind: "manual" }
          : {
              kind: "event_count",
              measure: form.eventName.trim() ? "events" : form.measure,
              ...(form.eventName.trim() ? { eventName: form.eventName.trim() } : {}),
            };
    return mutateDeck("PATCH", {
      action: "define",
      name: form.name.trim(),
      section: form.section,
      type: form.type,
      unit: form.unit,
      target: form.target === "" ? 0 : Number(form.target),
      goodDir: form.goodDir,
      source,
    });
  }, [form, mutateDeck]);

  const saveTarget = useCallback(
    (id: string, target: number) => {
      return mutateDeck("PATCH", { action: "edit", id, target });
    },
    [mutateDeck]
  );

  const retire = useCallback(
    (id: string) => mutateDeck("PATCH", { action: "retire", id }),
    [mutateDeck]
  );

  const moveMetric = useCallback(
    (id: string, dir: -1 | 1) => {
      const order = metrics.map((m) => m.id);
      const i = order.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return;
      const next = [...order];
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item);
      return mutateDeck("PATCH", { action: "reorder", order: next });
    },
    [metrics, mutateDeck]
  );

  const importCsv = useCallback(
    (id: string) => {
      if (!form.csv.trim()) return;
      return mutateDeck("PATCH", { action: "import", id, csv: form.csv });
    },
    [form.csv, mutateDeck]
  );

  useEffect(() => {
    loadWbr(false);
  }, [loadWbr]);

  useFreshness({
    workspace,
    watch: ["ingest", "sources"],
    onStale: () => loadWbr(true),
  });

  useEffect(() => {
    const enriched = metrics.map((m, i) => ({
      ...m,
      i,
      stat: wbrStat(m, exceptionRules),
    }));
    setMetricsWithStats(enriched);
  }, [metrics, exceptionRules]);

  useEffect(() => {
    // Skip the URL sync on initial mount to avoid loops
    if (!initialSyncDone.current) {
      initialSyncDone.current = true;
      return;
    }
    
    const encoded = encodeViewState(viewState);
    if (!encoded) {
      // All defaults, no need to sync
      return;
    }
    
    const params = new URLSearchParams(searchParams.toString());
    const newParams = new URLSearchParams(encoded.slice(1));
    
    // Merge view-state params
    newParams.forEach((value, key) => {
      params.set(key, value);
    });
    
    // Remove view-state keys that are at defaults (not in newParams)
    const viewStateKeys = ['m', 'i'];
    viewStateKeys.forEach(key => {
      if (!newParams.has(key)) {
        params.delete(key);
      }
    });
    
    const newSearch = params.toString();
    if (newSearch !== searchParams.toString()) {
      router.replace(`/dashboard?${newSearch}`, { scroll: false });
    }
  }, [viewState, router, searchParams]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "j" && viewState.mode === "deck") {
        const exceptions = metricsWithStats.filter((m) => m.stat.k !== "ok");
        if (exceptions.length > 0) {
          setViewState({ mode: "focus", focusIndex: exceptions[0].i });
        }
      } else if (e.key === "k" && viewState.mode === "deck") {
        const exceptions = metricsWithStats.filter((m) => m.stat.k !== "ok");
        if (exceptions.length > 0) {
          setViewState({ mode: "focus", focusIndex: exceptions[exceptions.length - 1].i });
        }
      } else if (e.key === "j" && viewState.mode === "focus") {
        const next = viewState.focusIndex + 1;
        if (next < metricsWithStats.length) {
          setViewState({ ...viewState, focusIndex: next });
        }
      } else if (e.key === "k" && viewState.mode === "focus") {
        const prev = viewState.focusIndex - 1;
        if (prev >= 0) {
          setViewState({ ...viewState, focusIndex: prev });
        }
      } else if (e.key === "f") {
        if (viewState.mode === "focus") {
          setViewState({ mode: "deck", focusIndex: 0 });
        } else {
          setViewState({ mode: "focus", focusIndex: 0 });
        }
      } else if (e.key === "Escape") {
        if (viewState.mode !== "deck") {
          setViewState({ mode: "deck", focusIndex: 0 });
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [viewState, metricsWithStats]);

  const renderChart = useCallback((m: Metric & { stat: ReturnType<typeof wbrStat> }, mode: "deck" | "focus") => {
    const CH = {
      deck: { W: 300, H: 72, pad: 5, split: 110, fs: 7, dense: true },
      focus: { W: 660, H: 190, pad: 12, split: 250, fs: 10.5, dense: false },
    };

    const c = CH[mode];
    const W = c.W;
    const H = c.H;
    const pad = c.pad;
    const split = c.split;
    const fs = c.fs;

    const frame = (v: number[]) => {
      const lo = Math.min(...v);
      const hi = Math.max(...v);
      const p = (hi - lo) * 0.22 || Math.abs(hi * 0.1) || 1;
      return [lo - p, hi + p];
    };

    const [wMin, wHi] = frame([...m.weeks, ...m.prevWeeks, m.target]);
    const [mMin, mHi] = frame([...m.months, ...m.prevMonths]);
    const wMax = wHi;
    const mMax = mHi;
    const plot = H - pad * 2 - fs * 1.7;

    const wx = (i: number) => pad + (i * (split - pad * 2)) / 5;
    const wy = (v: number) => H - pad - ((v - wMin) / (wMax - wMin)) * plot;
    const mx = (i: number) => split + 14 + (i * (W - split - 26)) / 11;
    const my = (v: number) => H - pad - ((v - mMin) / (mMax - mMin)) * plot;
    const F = (v: number) => wfmt(v, m);

    const hit = m.goodDir > 0 ? m.weeks[5] >= m.target : m.weeks[5] <= m.target;
    const tc = hit ? "var(--green)" : "var(--red)";
    const lw = mode === "focus" ? 2.8 : 2;
    const gw = mode === "focus" ? 2 : 1.4;

    return (
      <svg
        width={W}
        height={H + fs * 2}
        viewBox={`0 -${fs} ${W + 2} ${H + fs * 3}`}
        style={{ overflow: "visible" }}
        role="img"
        aria-label={`${m.name}: six weeks then twelve months, against last year`}
      >
        <line
          x1={split + 4}
          y1={0}
          x2={split + 4}
          y2={H}
          stroke="var(--border)"
          strokeDasharray="3 4"
        />
        <line
          x1={pad - 1}
          y1={wy(m.target)}
          x2={wx(5) + 4}
          y2={wy(m.target)}
          stroke={tc}
          strokeWidth="1"
          strokeDasharray="2 3"
          opacity="0.5"
        />
        <path
          d={`M ${pad - 9} ${wy(m.target) - 4.5} l 8 4.5 l -8 4.5 z`}
          fill={tc}
        />
        <polyline
          points={m.prevWeeks.map((v, i) => `${wx(i)},${wy(v)}`).join(" ")}
          fill="none"
          stroke="#f2b8cf"
          strokeWidth={gw}
          opacity="0.85"
        />
        <polyline
          points={m.prevMonths.map((v, i) => `${mx(i)},${my(v)}`).join(" ")}
          fill="none"
          stroke="#f2b8cf"
          strokeWidth={gw}
          opacity="0.85"
        />
        <polyline
          points={m.weeks.map((v, i) => `${wx(i)},${wy(v)}`).join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={lw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={m.months.map((v, i) => `${mx(i)},${my(v)}`).join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={lw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {m.weeks.map((v, i) => {
          if (c.dense && i !== 0 && i !== 5) return null;
          const up = i % 2 === 1;
          return (
            <g key={`w${i}`}>
              <circle cx={wx(i)} cy={wy(v)} r={mode === "focus" ? 3.2 : 2.2} fill="var(--accent)" />
              <text
                x={i === 0 ? wx(i) + 3 : wx(i)}
                y={wy(v) + (up ? -fs + 1 : fs + 2)}
                fontSize={fs}
                textAnchor={i === 0 ? "start" : "middle"}
                fill="var(--sub)"
              >
                {F(v)}
              </text>
            </g>
          );
        })}

        {(c.dense ? [11] : [0, 3, 6, 9, 11]).map((i) => (
          <g key={`m${i}`}>
            <circle cx={mx(i)} cy={my(m.months[i])} r={mode === "focus" ? 2.8 : 2} fill="var(--accent)" />
            <text
              x={mx(i)}
              y={my(m.months[i]) - fs + 1}
              fontSize={fs}
              textAnchor={i === 11 ? "end" : i === 0 ? "start" : "middle"}
              fill="var(--sub)"
            >
              {F(m.months[i])}
            </text>
          </g>
        ))}

        <text x={pad} y={H + fs * 1.7} fontSize={fs} fill="var(--sub)" textAnchor="start">
          6 weeks
        </text>
        <text x={split + 18} y={H + fs * 1.7} fontSize={fs} fill="#d98cb3">
          last year
        </text>
        <text x={W - 4} y={H + fs * 1.7} fontSize={fs} fill="var(--sub)" textAnchor="end">
          12 months
        </text>
      </svg>
    );
  }, []);

  const renderDataSheet = useCallback((m: Metric & { stat: ReturnType<typeof wbrStat> }) => {
    const wk = [27, 28, 29, 30, 31, 32];
    const isAvg = (m.unit && m.unit !== "$") || m.dp > 0;
    const t12 = sheetRoll(m.months, m);
    const p12 = sheetRoll(m.prevMonths, m);
    const F = (v: number) => wfmt(v, m);

    return (
      <div className="overflow-x-auto my-4 border border-border rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-rule">
              <th className="text-left py-2 px-3"></th>
              <th
                className="border-l border-rule py-2 px-3 text-[10px] text-faint uppercase tracking-wider"
                colSpan={6}
                title="the trailing 6 weeks, ending last week"
              >
                Weekly
              </th>
              <th
                className="border-l border-rule py-2 px-3 text-[10px] text-faint uppercase tracking-wider"
                colSpan={12}
                title="the trailing 12 calendar months"
              >
                Monthly
              </th>
              <th
                className="border-l border-rule py-2 px-3 text-[10px] text-faint uppercase tracking-wider"
                title="trailing 12 months"
              >
                T12M
              </th>
            </tr>
            <tr className="border-b border-rule">
              <th className="text-left py-2 px-3 font-mono text-[10px] text-faint uppercase">{m.name}</th>
              {wk.map((w, i) => (
                <th
                  key={w}
                  className={`py-2 px-3 font-mono text-[10px] text-faint ${i === 0 ? "border-l border-rule" : ""} ${i === 5 ? "font-semibold text-accent" : ""}`}
                  title={`week ${w} of the year${i === 5 ? " — last week" : ""}`}
                >
                  W{w}
                </th>
              ))}
              {MONTHS.map((n, i) => (
                <th
                  key={n}
                  className={`py-2 px-3 font-mono text-[10px] text-faint ${i === 0 ? "border-l border-rule" : ""}`}
                >
                  {n}
                </th>
              ))}
              <th className="border-l border-rule py-2 px-3 font-mono text-[10px] text-faint">
                {isAvg ? "avg" : "total"}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-rule">
              <td className="text-left py-2 px-3 text-sub" title="the metric's actual value in each period">
                value
              </td>
              {m.weeks.map((v, i) => (
                <td
                  key={`w${i}`}
                  className={`text-right py-2 px-3 tabular-nums ${i === 0 ? "border-l border-rule" : ""} ${i === 5 ? "font-semibold" : ""}`}
                >
                  {F(v)}
                </td>
              ))}
              {m.months.map((v, i) => (
                <td
                  key={`m${i}`}
                  className={`text-right py-2 px-3 tabular-nums ${i === 0 ? "border-l border-rule" : ""}`}
                >
                  {F(v)}
                </td>
              ))}
              <td className="border-l border-rule text-right py-2 px-3 tabular-nums font-semibold">
                {F(t12)}
              </td>
            </tr>
            <tr className="border-b border-rule">
              <td
                className="text-left py-2 px-3 text-sub"
                title="period over period — each cell vs the period immediately before it"
              >
                % PoP
              </td>
              {m.weeks.map((v, i) => {
                const p = i ? sheetPct(v, m.weeks[i - 1]) : null;
                return (
                  <td
                    key={`wp${i}`}
                    className={`text-right py-2 px-3 tabular-nums ${i === 0 ? "border-l border-rule" : ""} ${i === 5 ? "font-semibold" : ""}`}
                    style={p !== null ? { backgroundColor: sheetTint(p, m.goodDir) } : undefined}
                  >
                    {p !== null ? wsign(p) : ""}
                  </td>
                );
              })}
              {m.months.map((v, i) => {
                const p = i ? sheetPct(v, m.months[i - 1]) : null;
                return (
                  <td
                    key={`mp${i}`}
                    className={`text-right py-2 px-3 tabular-nums ${i === 0 ? "border-l border-rule" : ""}`}
                    style={p !== null ? { backgroundColor: sheetTint(p, m.goodDir) } : undefined}
                  >
                    {p !== null ? wsign(p) : ""}
                  </td>
                );
              })}
              <td className="border-l border-rule"></td>
            </tr>
            <tr>
              <td
                className="text-left py-2 px-3 text-sub"
                title="year over year — each cell vs the same period one year earlier"
              >
                % YoY
              </td>
              {m.weeks.map((v, i) => {
                const p = sheetPct(v, m.prevWeeks[i]);
                return (
                  <td
                    key={`wy${i}`}
                    className={`text-right py-2 px-3 tabular-nums ${i === 0 ? "border-l border-rule" : ""} ${i === 5 ? "font-semibold" : ""}`}
                    style={p !== null ? { backgroundColor: sheetTint(p, m.goodDir) } : undefined}
                  >
                    {p !== null ? wsign(p) : ""}
                  </td>
                );
              })}
              {m.months.map((v, i) => {
                const p = sheetPct(v, m.prevMonths[i]);
                return (
                  <td
                    key={`my${i}`}
                    className={`text-right py-2 px-3 tabular-nums ${i === 0 ? "border-l border-rule" : ""}`}
                    style={p !== null ? { backgroundColor: sheetTint(p, m.goodDir) } : undefined}
                  >
                    {p !== null ? wsign(p) : ""}
                  </td>
                );
              })}
              <td
                className="border-l border-rule text-right py-2 px-3 tabular-nums font-semibold"
                style={{ backgroundColor: sheetTint(sheetPct(t12, p12), m.goodDir) }}
              >
                {wsign(sheetPct(t12, p12)!)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }, []);

  const renderDeck = useCallback(() => {
    const score = metricsWithStats.filter((m) => m.section === "fin");
    const exceptions = metricsWithStats.filter((m) => m.stat.k !== "ok");

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {score.map((m, i) => {
            const b = wbrBox(m);
            const att = Math.round(((b.lw - m.target) / m.target) * 100) * m.goodDir;
            return (
              <div
                key={m.id}
                className={`bg-panel border rounded-lg p-3 ${i === 0 ? "md:col-span-2" : ""}`}
              >
                <div className="text-[10px] uppercase tracking-wider text-sub mb-1">
                  {i === 0 ? "the score · " : ""}
                  {m.name}
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {wfmt(b.lw, m)}
                  <span
                    className="ml-2 text-lg"
                    style={{ color: b.wow * m.goodDir >= 0 ? "var(--green)" : "var(--red)" }}
                  >
                    {b.wow > 0 ? "▲" : b.wow < 0 ? "▼" : "–"}
                    {Math.abs(b.wow)}%
                  </span>
                </div>
                <div className="text-xs text-sub mt-1">
                  {b.on ? "✓" : "✕"} target {wfmt(m.target, m)} · {wsign(att)}
                </div>
              </div>
            );
          })}
        </div>

        {exceptions.length > 0 && (
          <div className="bg-panel border border-border rounded-lg p-3">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="text-sub">walk these:</span>
              {exceptions.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setViewState({ mode: "focus", focusIndex: m.i })}
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    m.stat.k === "off"
                      ? "bg-red/10 text-red hover:bg-red/20"
                      : "bg-amber/10 text-amber hover:bg-amber/20"
                  }`}
                >
                  {TOK[m.stat.k]} {m.name} <span className="opacity-60">#{m.i + 1}</span>
                </button>
              ))}
              <span className="text-sub">· everything else is a one-second glance</span>
            </div>
          </div>
        )}

        {SECTIONS.map((sec) => {
          const ms = metricsWithStats.filter((m) => m.section === sec.id);
          const isCollapsed = collapsed[sec.id];

          return (
            <div key={sec.id}>
              <button
                onClick={() => setCollapsed({ ...collapsed, [sec.id]: !isCollapsed })}
                className="w-full flex items-center gap-3 py-2 px-3 bg-panel-2 border border-border rounded-lg hover:bg-panel mb-2"
              >
                <span className="text-sub">{isCollapsed ? "▸" : "▾"}</span>
                <span className="text-sub font-mono text-xs">{sec.n}</span>
                <h3 className="font-semibold">{sec.name}</h3>
                <span className="text-sm text-sub">{sec.cap}</span>
                <span className="ml-auto flex gap-1">
                  {ms.map((m) => (
                    <span
                      key={m.id}
                      className={`w-2 h-2 rounded-full ${
                        m.stat.k === "off" ? "bg-red" : m.stat.k === "watch" ? "bg-amber" : "bg-green"
                      }`}
                      title={`${m.name} — ${FLAGTXT[m.stat.k]}`}
                    />
                  ))}
                </span>
              </button>

              {!isCollapsed && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {ms.map((m) => {
                    const b = wbrBox(m);
                    return (
                      <div
                        key={m.id}
                        className={`bg-panel border rounded-lg p-3 cursor-pointer hover:border-accent ${
                          m.stat.k === "off"
                            ? "border-red/30"
                            : m.stat.k === "watch"
                            ? "border-amber/30"
                            : "border-border"
                        }`}
                        onClick={() => setViewState({ mode: "focus", focusIndex: m.i })}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{m.owner}</span>
                            <span className="font-semibold text-sm">{m.name}</span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                m.type === "input" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
                              }`}
                            >
                              {m.type}
                            </span>
                            {m.stat.k !== "ok" && (
                              <span className="text-sm">{TOK[m.stat.k]}</span>
                            )}
                            <span className="text-xs text-faint">#{m.i + 1}</span>
                          </div>
                        </div>

                        {renderChart(m, "deck")}

                        {m.note && (
                          <div className="text-xs text-sub mt-2 flex items-center gap-1">
                            <span>▲</span>
                            <span>wk {m.note.w + 1} — {m.note.text}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between mt-3 text-xs">
                          <div title="last week's value">
                            <div className="text-faint uppercase tracking-wider">LW</div>
                            <div className="font-semibold tabular-nums">{wfmt(b.lw, m)}</div>
                          </div>
                          <div title="week over week">
                            <div className="text-faint uppercase tracking-wider">WOW</div>
                            <div className="font-semibold tabular-nums">{wsign(b.wow)}</div>
                          </div>
                          <div title="year over year">
                            <div className="text-faint uppercase tracking-wider">YOY</div>
                            <div className="font-semibold tabular-nums">{wsign(b.yoy)}</div>
                          </div>
                          <div title="target">
                            <div className="text-faint uppercase tracking-wider">Target</div>
                            <div className={`font-semibold tabular-nums ${b.on ? "" : "text-red"}`}>
                              {wfmt(m.target, m)}
                            </div>
                          </div>
                        </div>

                        {m.stat.k !== "ok" && (
                          <div className="mt-2 text-xs text-sub border-t border-rule pt-2">
                            {m.stat.why}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }, [metricsWithStats, collapsed, renderChart]);

  const renderFocus = useCallback(() => {
    const m = metricsWithStats[viewState.focusIndex];
    if (!m) return null;

    const b = wbrBox(m);
    const sec = SECTIONS.find((s) => s.id === m.section)!;

    return (
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div className="bg-panel border border-border rounded-lg p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{m.owner}</span>
              <h3 className="text-xl font-semibold">{m.name}</h3>
              <span
                className={`px-2 py-1 rounded text-xs font-medium ${
                  m.type === "input" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
                }`}
              >
                {m.type}
              </span>
            </div>
            <div
              className={`px-3 py-1 rounded text-sm font-medium ${
                m.stat.k === "off"
                  ? "bg-red/10 text-red"
                  : m.stat.k === "watch"
                  ? "bg-amber/10 text-amber"
                  : "bg-green/10 text-green"
              }`}
            >
              {TOK[m.stat.k] || "✓"} {FLAGTXT[m.stat.k]}
            </div>
          </div>

          <div className="text-xs text-sub mb-3">
            graph #{m.i + 1} of {metricsWithStats.length} · {sec.n} {sec.name} · owner {m.owner} ·{" "}
            <kbd className="px-1.5 py-0.5 bg-panel-2 rounded text-[10px] border border-border">j</kbd>
            <kbd className="px-1.5 py-0.5 bg-panel-2 rounded text-[10px] border border-border ml-1">k</kbd> to walk
          </div>

          {renderChart(m, "focus")}

          {m.note && (
            <div className="text-xs text-sub mt-2 flex items-center gap-1">
              <span>▲</span>
              <span>
                week {m.note.w + 1} — {m.note.text}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between mt-4 text-sm gap-4">
            <div title="last week's value">
              <div className="text-faint uppercase tracking-wider text-[10px]">LAST WEEK</div>
              <div className="font-semibold tabular-nums">{wfmt(b.lw, m)}</div>
            </div>
            <div title="week over week">
              <div className="text-faint uppercase tracking-wider text-[10px]">WOW</div>
              <div className="font-semibold tabular-nums">{wsign(b.wow)}</div>
            </div>
            <div title="year over year">
              <div className="text-faint uppercase tracking-wider text-[10px]">YOY</div>
              <div className="font-semibold tabular-nums">{wsign(b.yoy)}</div>
            </div>
            <div title="target">
              <div className="text-faint uppercase tracking-wider text-[10px]">TARGET</div>
              <div className={`font-semibold tabular-nums ${b.on ? "" : "text-red"}`}>
                {wfmt(m.target, m)}
              </div>
            </div>
          </div>

          {renderDataSheet(m)}

          <div className="mt-4 p-3 bg-panel-2 rounded-lg text-sm">
            <div className="font-semibold mb-1">why it's {FLAGTXT[m.stat.k]}:</div>
            <div className="text-sub">{m.stat.why}</div>
          </div>

          {m.stat.k !== "ok" && m.type === "output" && (
            <div className="mt-2 p-3 bg-blue-50 rounded-lg text-sm">
              <div className="text-blue-900">
                output metric — <strong>report it, don't debate it</strong>. The discussion belongs to the inputs that move it: {m.drivers?.join(" · ")}.
              </div>
            </div>
          )}
        </div>

        <div className="bg-panel border border-border rounded-lg p-3 max-h-[80vh] overflow-y-auto">
          {SECTIONS.map((s) => {
            const sectionMetrics = metricsWithStats.filter((x) => x.section === s.id);
            return (
              <div key={s.id}>
                <div className="text-xs text-sub uppercase tracking-wider py-2">
                  {s.n} {s.name}
                </div>
                {sectionMetrics.map((x) => (
                  <button
                    key={x.id}
                    onClick={() => setViewState({ ...viewState, focusIndex: x.i })}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left mb-1 ${
                      x.i === m.i ? "bg-accent text-white" : "hover:bg-panel-2"
                    }`}
                  >
                    <span className="text-faint w-6">#{x.i + 1}</span>
                    <span className="flex-1">{x.name}</span>
                    {x.stat.k !== "ok" && (
                      <span
                        className={`w-2 h-2 rounded-full ${
                          x.stat.k === "off" ? "bg-red" : "bg-amber"
                        }`}
                      />
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }, [metricsWithStats, viewState, renderChart, renderDataSheet]);

  const renderTable = useCallback(() => {
    const wk = [27, 28, 29, 30, 31, 32];

    return (
      <div className="bg-panel border border-border rounded-lg overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel z-10">
            <tr className="border-b border-rule">
              <th className="text-left py-2 px-3 font-mono text-[10px] text-faint uppercase">Metric</th>
              <th className="text-left py-2 px-3 font-mono text-[10px] text-faint uppercase"></th>
              {wk.map((w) => (
                <th key={w} className="text-right py-2 px-3 font-mono text-[10px] text-faint uppercase">
                  W{w}
                </th>
              ))}
              <th className="text-center py-2 px-3 font-mono text-[10px] text-faint uppercase">Trend</th>
              <th className="text-right py-2 px-3 font-mono text-[10px] text-faint uppercase" title="week over week">
                WOW
              </th>
              <th className="text-right py-2 px-3 font-mono text-[10px] text-faint uppercase" title="year over year">
                YOY
              </th>
              <th className="text-right py-2 px-3 font-mono text-[10px] text-faint uppercase">Target</th>
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((sec) => {
              const ms = metricsWithStats.filter((m) => m.section === sec.id);
              return (
                <React.Fragment key={sec.id}>
                  <tr className="bg-panel-2">
                    <td colSpan={12} className="py-2 px-3 font-semibold text-sm">
                      {sec.n} · {sec.name} — {sec.cap}
                    </td>
                  </tr>
                  {ms.map((m) => {
                    const b = wbrBox(m);
                    const lo = Math.min(...m.weeks);
                    const hi = Math.max(...m.weeks);
                    const rg = hi - lo || 1;
                    const sparkline = m.weeks.map((v, i) => `${i * 8},${12 - ((v - lo) / rg) * 10}`).join(" ");

                    return (
                      <tr
                        key={m.id}
                        className="border-b border-rule hover:bg-panel-2 cursor-pointer"
                        onClick={() => setViewState({ mode: "focus", focusIndex: m.i })}
                      >
                        <td className="py-2 px-3">
                          {TOK[m.stat.k] || <span className="opacity-25">·</span>}{" "}
                          <strong className="font-medium">{m.name}</strong>{" "}
                          <span className="text-faint">#{m.i + 1}</span>
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              m.type === "input" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
                            }`}
                          >
                            {m.type}
                          </span>
                        </td>
                        {m.weeks.map((v, i) => (
                          <td
                            key={i}
                            className={`text-right py-2 px-3 tabular-nums ${i === 5 ? "font-semibold" : "text-sub"}`}
                          >
                            {wfmt(v, m)}
                          </td>
                        ))}
                        <td className="text-center py-2 px-3">
                          <svg width="42" height="14">
                            <polyline
                              points={sparkline}
                              fill="none"
                              stroke="var(--accent)"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </td>
                        <td
                          className={`text-right py-2 px-3 tabular-nums ${
                            b.wow * m.goodDir >= 0 ? "text-green" : "text-red"
                          }`}
                        >
                          {wsign(b.wow)}
                        </td>
                        <td
                          className={`text-right py-2 px-3 tabular-nums ${
                            b.yoy * m.goodDir >= 0 ? "text-green" : "text-red"
                          }`}
                        >
                          {wsign(b.yoy)}
                        </td>
                        <td className={`text-right py-2 px-3 tabular-nums ${b.on ? "text-sub" : "text-red"}`}>
                          {wfmt(m.target, m)}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }, [metricsWithStats]);

  if (loading) {
    return <div className="text-sub">Loading...</div>;
  }

  const exceptions = metricsWithStats.filter((m) => m.stat.k !== "ok");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Weekly Business Review</h2>
        <span className="text-sm text-sub">{metricsWithStats.length} metrics</span>
        {exceptions.length > 0 && (
          <span className="text-sm text-amber font-medium">
            {exceptions.length} exception{exceptions.length > 1 ? "s" : ""}
          </span>
        )}
        <span style={{ flex: 1 }} />

        <button
          type="button"
          onClick={() => setBuilderOpen(!builderOpen)}
          className={`px-3 py-1.5 text-xs font-medium border border-border rounded-lg ${
            builderOpen ? "bg-accent text-white" : "bg-panel text-sub hover:text-text"
          }`}
        >
          Edit deck
        </button>

        <div className="flex gap-1 border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setViewState({ mode: "deck", focusIndex: 0 })}
            className={`px-3 py-1.5 text-xs font-medium ${
              viewState.mode === "deck" ? "bg-accent text-white" : "bg-panel text-sub hover:text-text"
            }`}
          >
            Deck
          </button>
          <button
            onClick={() => setViewState({ mode: "focus", focusIndex: 0 })}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.mode === "focus" ? "bg-accent text-white" : "bg-panel text-sub hover:text-text"
            }`}
          >
            Focus
          </button>
          <button
            onClick={() => setViewState({ mode: "table", focusIndex: 0 })}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.mode === "table" ? "bg-accent text-white" : "bg-panel text-sub hover:text-text"
            }`}
          >
            Table
          </button>
        </div>

        <div className="text-xs text-sub flex items-center gap-2">
          <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded">j/k</kbd>
          walk ·
          <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded">f</kbd>
          focus ·
          <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded">Esc</kbd>
          deck
        </div>
      </div>

      {proposals.length > 0 && (
        <div
          className="bg-panel border border-border rounded-lg p-3 space-y-2"
          data-testid="wbr-starter"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">Starter deck</span>
            <span className="text-xs text-sub">
              Proposed from what is connected. You own the final list.
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              disabled={busy}
              onClick={acceptStarter}
              className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg disabled:opacity-50"
              data-testid="wbr-accept-starter"
            >
              Accept starter
            </button>
          </div>
          <ul className="text-sm space-y-1">
            {proposals.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span>{p.owner}</span>
                <strong>{p.name}</strong>
                <span className="text-xs text-sub">{p.sourceKind ?? "proposal"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {builderOpen && (
        <div className="bg-panel border border-border rounded-lg p-3 space-y-3" data-testid="wbr-builder">
          <div className="text-sm font-semibold">Add a metric</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <label className="space-y-1">
              <span className="text-sub">Name</span>
              <input
                className="w-full border border-border rounded px-2 py-1 bg-panel-2"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="wbr-metric-name"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sub">Section</span>
              <select
                className="w-full border border-border rounded px-2 py-1 bg-panel-2"
                value={form.section}
                onChange={(e) => setForm({ ...form, section: e.target.value })}
              >
                {SECTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sub">Type</span>
              <select
                className="w-full border border-border rounded px-2 py-1 bg-panel-2"
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as "input" | "output" })
                }
              >
                <option value="input">input</option>
                <option value="output">output</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sub">Unit</span>
              <input
                className="w-full border border-border rounded px-2 py-1 bg-panel-2"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sub">Target</span>
              <input
                className="w-full border border-border rounded px-2 py-1 bg-panel-2"
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value })}
                inputMode="decimal"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sub">Good direction</span>
              <select
                className="w-full border border-border rounded px-2 py-1 bg-panel-2"
                value={form.goodDir}
                onChange={(e) =>
                  setForm({ ...form, goodDir: e.target.value as "up" | "down" })
                }
              >
                <option value="up">up</option>
                <option value="down">down</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sub">Source</span>
              <select
                className="w-full border border-border rounded px-2 py-1 bg-panel-2"
                value={form.sourceKind}
                onChange={(e) =>
                  setForm({
                    ...form,
                    sourceKind: e.target.value as "event_count" | "revenue" | "manual",
                  })
                }
              >
                <option value="event_count">event count</option>
                <option value="revenue">revenue series</option>
                <option value="manual">manual / CSV</option>
              </select>
            </label>
            {form.sourceKind === "event_count" && (
              <>
                <label className="space-y-1">
                  <span className="text-sub">Measure</span>
                  <select
                    className="w-full border border-border rounded px-2 py-1 bg-panel-2"
                    value={form.measure}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        measure: e.target.value as typeof form.measure,
                      })
                    }
                  >
                    <option value="signups">signups</option>
                    <option value="actives">actives</option>
                    <option value="retention">retention</option>
                    <option value="events">named event</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-sub">Event name</span>
                  <input
                    className="w-full border border-border rounded px-2 py-1 bg-panel-2"
                    value={form.eventName}
                    onChange={(e) => setForm({ ...form, eventName: e.target.value })}
                  />
                </label>
              </>
            )}
            {form.sourceKind === "revenue" && (
              <label className="space-y-1">
                <span className="text-sub">Series</span>
                <select
                  className="w-full border border-border rounded px-2 py-1 bg-panel-2"
                  value={form.series}
                  onChange={(e) =>
                    setForm({ ...form, series: e.target.value as typeof form.series })
                  }
                >
                  <option value="mrr">MRR</option>
                  <option value="new">New subscriptions</option>
                  <option value="churned">Churned subscriptions</option>
                  <option value="arpu">ARPU</option>
                  <option value="runway">Runway</option>
                </select>
              </label>
            )}
          </div>
          <button
            type="button"
            disabled={busy || !form.name.trim()}
            onClick={saveNewMetric}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg disabled:opacity-50"
            data-testid="wbr-add-metric"
          >
            Add metric
          </button>

          {metrics.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-semibold">Deck order</div>
              <ul className="space-y-1">
                {metrics.map((m, i) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-2 text-xs border border-border rounded px-2 py-1"
                    data-testid={`wbr-row-${m.id}`}
                  >
                    <span className="text-faint w-6">#{i + 1}</span>
                    <span className="flex-1 font-medium">{m.name}</span>
                    <label className="flex items-center gap-1">
                      <span className="text-faint">target</span>
                      <input
                        className="w-16 border border-border rounded px-1 py-0.5 bg-panel-2 tabular-nums"
                        defaultValue={m.target}
                        onBlur={(e) => {
                          const next = Number(e.target.value);
                          if (Number.isFinite(next) && next !== m.target) {
                            saveTarget(m.id, next);
                          }
                        }}
                        data-testid={`wbr-target-${m.id}`}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={i === 0 || busy}
                      onClick={() => moveMetric(m.id, -1)}
                      className="px-1.5 py-0.5 border border-border rounded disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === metrics.length - 1 || busy}
                      onClick={() => moveMetric(m.id, 1)}
                      className="px-1.5 py-0.5 border border-border rounded disabled:opacity-40"
                    >
                      ↓
                    </button>
                    {m.sourceKind === "manual" && (
                      <button
                        type="button"
                        disabled={busy || !form.csv.trim()}
                        onClick={() => importCsv(m.id)}
                        className="px-1.5 py-0.5 border border-border rounded disabled:opacity-40"
                      >
                        Import CSV
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => retire(m.id)}
                      className="px-1.5 py-0.5 border border-border rounded text-red disabled:opacity-40"
                    >
                      Retire
                    </button>
                  </li>
                ))}
              </ul>
              <label className="block space-y-1 text-xs">
                <span className="text-sub">Manual / CSV points (timestamp,value,grain)</span>
                <textarea
                  className="w-full border border-border rounded px-2 py-1 bg-panel-2 font-mono"
                  rows={3}
                  value={form.csv}
                  onChange={(e) => setForm({ ...form, csv: e.target.value })}
                  data-testid="wbr-manual-csv"
                />
              </label>
            </div>
          )}
        </div>
      )}

      {viewState.mode === "deck" && renderDeck()}
      {viewState.mode === "focus" && renderFocus()}
      {viewState.mode === "table" && renderTable()}
    </div>
  );
}
