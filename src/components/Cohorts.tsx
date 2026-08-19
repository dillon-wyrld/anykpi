"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  SMILE_COPY_DECAY,
  SMILE_COPY_LEVEL,
  CO_MINN,
  bestVintage,
  cohortBenchmark,
  findLeak,
  loyalCoreCount,
  smileTest,
} from "@/core/views/cohort-math";

interface User {
  personId: string;
  name: string;
  emoji: string;
  signupDay: number;
  dailyActivity: boolean[];
}

interface CohortRow {
  week: number;
  label: string;
  size: number;
  retention: number[];
  counts: number[];
  users?: User[]; // Optional - only for client-side loyal core calc
  state: "young" | "smile" | "low" | "sliding";
  grade: {
    slope: number;
    floor: number;
    decay: number;
    thin?: boolean;
  };
}

interface ViewState {
  grain: "day" | "week" | "biweek" | "month" | "quarter";
  cell: "pct" | "num" | "emoji";
  celebrate: boolean;
  align: "signup" | "cal";
}

interface CohortsProps {
  workspace: string;
}

const GRAINS = {
  day: { d: 1, name: "Daily", short: "1d", unit: "day", units: "days", per: "day", pre: "D", cols: 15 },
  week: { d: 7, name: "Weekly", short: "1w", unit: "week", units: "weeks", per: "wk", pre: "W", cols: 13 },
  biweek: { d: 14, name: "Biweekly", short: "2w", unit: "2 weeks", units: "2-week periods", per: "p", pre: "W", cols: 13 },
  month: { d: 28, name: "Monthly", short: "1mo", unit: "month", units: "months", per: "mo", pre: "M", cols: 13 },
  quarter: { d: 91, name: "Quarterly", short: "1q", unit: "quarter", units: "quarters", per: "Q", pre: "Q", cols: 8 },
};

const CO_DECAY = SMILE_COPY_DECAY;
const CO_LEVEL = SMILE_COPY_LEVEL;

const CO_W = 720;
const CO_H = 390;
const CO_PL = 36;
const CO_PR = 26;
const CO_PB = 42;
const CO_PT = 18;

function emojiFor(p: number): string {
  return p > 60 ? "🔥" : p > 45 ? "😄" : p > 30 ? "🙂" : p > 20 ? "😐" : p > 10 ? "🥱" : "💀";
}

function encodeViewState(vs: ViewState): string {
  const params = new URLSearchParams();
  if (vs.grain !== "week") params.set("g", vs.grain);
  if (vs.cell !== "pct") params.set("c", vs.cell);
  if (!vs.celebrate) params.set("cel", "0");
  if (vs.align !== "signup") params.set("a", vs.align);
  const str = params.toString();
  return str ? `?${str}` : "";
}

function decodeViewState(searchParams: URLSearchParams): Partial<ViewState> {
  const vs: Partial<ViewState> = {};
  if (searchParams.has("g")) vs.grain = searchParams.get("g") as any;
  if (searchParams.has("c")) vs.cell = searchParams.get("c") as any;
  if (searchParams.has("cel")) vs.celebrate = searchParams.get("cel") === "1";
  if (searchParams.has("a")) vs.align = searchParams.get("a") as any;
  return vs;
}

export default function Cohorts({ workspace }: CohortsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const defaultViewState: ViewState = {
    grain: "week",
    cell: "pct",
    celebrate: true,
    align: "signup",
  };
  
  const urlState = decodeViewState(searchParams);
  const [viewState, setViewState] = useState<ViewState>({
    ...defaultViewState,
    ...urlState,
  });

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [cohortRows, setCohortRows] = useState<CohortRow[]>([]);
  const [highlightedRow, setHighlightedRow] = useState(-1);
  const [showConfetti, setShowConfetti] = useState(false);
  const [confettiTriggered, setConfettiTriggered] = useState(false);
  const initialSyncDone = useRef(false);
  
  const curvesRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    fetch(`/api/views/cohorts?workspace=${workspace}&grain=${viewState.grain}`)
      .then((res) => res.json())
      .then((data) => {
        setUsers(data.users || []);
        setCohortRows(data.cohorts || []); // Use precomputed cohorts from server
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [workspace, viewState.grain]);

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
    const viewStateKeys = ['g', 'c', 'cel', 'a'];
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
    const smilingCount = cohortRows.filter((r) => r.state === "smile").length;
    if (smilingCount >= 3 && viewState.celebrate && !confettiTriggered) {
      setShowConfetti(true);
      setConfettiTriggered(true);
      setTimeout(() => setShowConfetti(false), 1800);
    }
  }, [cohortRows, viewState.celebrate, confettiTriggered]);

  const renderCurves = useCallback(() => {
    if (cohortRows.length === 0) return null;
    
    const grain = GRAINS[viewState.grain];
    const maxObs = Math.max(...cohortRows.map((r) => r.retention.length));
    
    const coX = (p: number) => CO_PL + (p / Math.max(1, maxObs - 1)) * (CO_W - CO_PL - CO_PR);
    const coY = (pct: number) => CO_H - CO_PB - (pct / 100) * (CO_H - CO_PB - CO_PT);

    return (
      <svg
        ref={curvesRef}
        viewBox={`0 0 ${CO_W} ${CO_H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Retention curves for ${cohortRows.length} ${grain.name.toLowerCase()} cohorts`}
      >
        {[0, 25, 50, 75, 100].map((pct) => (
          <g key={pct}>
            <text
              x={CO_PL - 8}
              y={coY(pct) + 3.5}
              fontSize="10"
              fill="var(--sub)"
              textAnchor="end"
            >
              {pct}%
            </text>
            <line
              x1={CO_PL}
              y1={coY(pct)}
              x2={CO_W - CO_PR}
              y2={coY(pct)}
              stroke="var(--border)"
              strokeWidth="0.6"
            />
          </g>
        ))}
        
        <line
          x1={CO_PL}
          y1={coY(CO_LEVEL)}
          x2={CO_W - CO_PR}
          y2={coY(CO_LEVEL)}
          stroke="var(--green)"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.75"
        />
        <text
          x={CO_W - CO_PR - 4}
          y={coY(CO_LEVEL) - 5}
          fontSize="10"
          fill="var(--green)"
          textAnchor="end"
          stroke="var(--panel)"
          strokeWidth="3.5"
          paintOrder="stroke"
        >
          flat above {CO_LEVEL}% is a smile
        </text>
        
        {cohortRows.map((row) => {
          const points = row.retention
            .map((v, p) => `${coX(p)},${coY(v)}`)
            .join(" ");
          const isHighlighted = row.week === highlightedRow;
          const stateClass = viewState.celebrate && row.state === "smile" ? "celebrate" : "";
          
          return (
            <polyline
              key={row.week}
              points={points}
              fill="none"
              stroke={
                isHighlighted
                  ? "var(--accent)"
                  : row.state === "smile" && viewState.celebrate
                  ? "var(--green)"
                  : row.state === "low"
                  ? "var(--amber)"
                  : "#dedee2"
              }
              strokeWidth={isHighlighted ? "2.4" : row.state === "smile" && viewState.celebrate ? "1.5" : "1"}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={isHighlighted ? "1" : row.state === "smile" && viewState.celebrate ? "0.55" : "0.6"}
              className={`cursor-pointer transition-all ${stateClass}`}
              onMouseEnter={() => setHighlightedRow(row.week)}
              onMouseLeave={() => setHighlightedRow(-1)}
              data-cohort={row.week}
            />
          );
        })}
        
        <text
          x={CO_W / 2}
          y={CO_H - 8}
          fontSize="10.5"
          fill="var(--sub)"
          textAnchor="middle"
        >
          {grain.units} since signup — a tail that flattens above the line means they stayed
        </text>
      </svg>
    );
  }, [cohortRows, viewState.grain, viewState.celebrate, highlightedRow]);

  const renderInsights = useCallback(() => {
    if (cohortRows.length === 0) return null;
    
    const grain = GRAINS[viewState.grain];
    const { aged, smilers, pmfLit } = smileTest(cohortRows);
    const loyalCore = loyalCoreCount(
      users,
      cohortRows,
      GRAINS[viewState.grain]?.d || 7
    );
    const leak = findLeak(cohortRows);
    const vintage = bestVintage(cohortRows, CO_MINN);
    
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div
          className={`bg-panel border rounded-lg p-3 transition-all ${
            pmfLit && viewState.celebrate
              ? "border-green bg-green-50 cursor-pointer hover:shadow-md"
              : "border-border"
          }`}
        >
          <div className="text-[10px] uppercase tracking-wider text-sub mb-1">The smile test</div>
          <div className="text-lg font-semibold">
            {aged === 0 ? "—" : `${smilers} of ${aged}`}
          </div>
          <div className="text-xs text-sub mt-1">
            {aged === 0
              ? `needs 4+ ${grain.units} of history`
              : `losing under ${(CO_DECAY * 100).toFixed(1)}% of base/week & above ${CO_LEVEL}%`}
          </div>
          {pmfLit && viewState.celebrate && <div className="text-xl mt-1">😁</div>}
        </div>
        
        <div className="bg-panel border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-sub mb-1">The leak</div>
          <div className="text-lg font-semibold">
            {leak && leak.worst
              ? `${grain.per} ${leak.worst.p - 1}→${leak.worst.p}`
              : "—"}
          </div>
          <div className="text-xs text-sub mt-1">
            {leak && leak.worst
              ? `−${leak.worst.drop.toFixed(0)} pts · worst drop after ${grain.unit} 0`
              : `needs 3+ ${grain.units} to find the second drop`}
          </div>
        </div>
        
        <div className="bg-panel border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-sub mb-1">Best vintage</div>
          <div className="text-lg font-semibold">
            {vintage !== null ? vintage.vintage.label : "—"}
          </div>
          <div className="text-xs text-sub mt-1">
            {vintage !== null
              ? `${vintage.vintage.retention[vintage.period]}% at ${grain.per} ${vintage.period} · ${vintage.vintage.size} joined`
              : `no ${grain.unit} has ${CO_MINN}+ signups yet`}
          </div>
        </div>
        
        <div className="bg-panel border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-sub mb-1">Loyal core 🏝️</div>
          <div className="text-lg font-semibold">{loyalCore} users</div>
          <div className="text-xs text-sub mt-1">never churned · active every week, 8+ weeks</div>
        </div>
      </div>
    );
  }, [cohortRows, users, viewState.grain, viewState.celebrate]);

  const renderTable = useCallback(() => {
    if (cohortRows.length === 0) return null;
    
    const grain = GRAINS[viewState.grain];
    const cols = Math.min(grain.cols, Math.max(...cohortRows.map((r) => r.retention.length)));
    
    const maxVal = Math.max(...cohortRows.flatMap((r) => r.retention.slice(1)));
    const heatOpacity = (v: number) => 0.05 + 0.8 * Math.pow(Math.max(0, v) / Math.max(1, maxVal), 0.85);
    const benchmark = cohortBenchmark(cohortRows, cols);
    
    return (
      <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-panel z-10">
            <tr className="border-b border-rule">
              <th className="text-left py-2 px-3 font-mono text-[10px] text-faint uppercase tracking-wider bg-panel">
                Cohort
              </th>
              {Array.from({ length: cols }, (_, i) => (
                <th
                  key={i}
                  className="text-center py-2 px-2 font-mono text-[10px] text-faint uppercase tracking-wider bg-panel"
                >
                  {grain.per}
                  {i}
                </th>
              ))}
            </tr>
            <tr className="sticky top-[32px] bg-panel border-b border-rule z-10">
              <td className="text-left py-1 px-3 text-[9.5px] text-sub uppercase tracking-wider">
                Benchmark
              </td>
              {benchmark.slice(0, cols).map((pct, i) => (
                <td key={i} className="text-center py-1 px-2 text-[10px] text-sub font-semibold tabular-nums">
                  {viewState.cell === "emoji" ? emojiFor(pct) : viewState.cell === "num" ? "—" : `${pct}%`}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohortRows.map((row) => (
              <tr
                key={row.week}
                className={`border-b border-rule cursor-pointer transition-colors ${
                  highlightedRow === row.week ? "bg-accent-soft" : "hover:bg-panel-2"
                }`}
                onMouseEnter={() => setHighlightedRow(row.week)}
                onMouseLeave={() => setHighlightedRow(-1)}
                data-cohort={row.week}
              >
                <td className="py-2 px-3 whitespace-nowrap">
                  <div className="font-mono text-xs font-semibold">{row.label}</div>
                  <div className="text-[10px] text-sub">{row.size} joined</div>
                </td>
                {row.retention.slice(0, cols).map((val, i) => {
                  const bgColor =
                    i === 0
                      ? "rgb(94, 106, 210)"
                      : `rgba(94, 106, 210, ${heatOpacity(val).toFixed(2)})`;
                  const textColor = i === 0 || val > 60 ? "#fff" : "inherit";
                  
                  return (
                    <td
                      key={i}
                      className="text-center py-2 px-2 font-mono tabular-nums font-semibold"
                      style={{ backgroundColor: bgColor, color: textColor }}
                    >
                      {viewState.cell === "pct"
                        ? `${val}%`
                        : viewState.cell === "num"
                        ? row.counts[i]
                        : emojiFor(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }, [cohortRows, viewState.cell, viewState.grain, highlightedRow]);

  if (loading) {
    return <div className="text-sub">Loading...</div>;
  }

  const grain = GRAINS[viewState.grain];
  const totalUsers = cohortRows.reduce((sum, r) => sum + r.size, 0);

  return (
    <div className="space-y-4 relative">
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50">
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              key={i}
              className="absolute text-2xl"
              style={{
                left: `${Math.random() * 100}%`,
                top: `-20px`,
                animation: `fall ${2 + Math.random()}s ease-out ${Math.random() * 0.5}s forwards`,
              }}
            >
              {["🎉", "✨", "😊", "🎊", "⭐"][Math.floor(Math.random() * 5)]}
            </div>
          ))}
        </div>
      )}
      
      <style jsx>{`
        @keyframes fall {
          0% {
            transform: translateY(0) rotate(0);
            opacity: 1;
          }
          100% {
            transform: translateY(calc(100vh + 50px)) rotate(${Math.random() * 360}deg);
            opacity: 0;
          }
        }
      `}</style>
      
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Cohort retention</h2>
        <span className="text-sm text-sub">
          {cohortRows.length} {grain.name.toLowerCase()} cohorts · {totalUsers} users
        </span>
        <span style={{ flex: 1 }} />
        
        <div className="flex gap-1 border border-border rounded-lg overflow-hidden">
          {Object.entries(GRAINS).map(([key, g]) => (
            <button
              key={key}
              onClick={() => setViewState({ ...viewState, grain: key as any })}
              className={`px-3 py-1.5 text-xs font-medium ${
                viewState.grain === key
                  ? "bg-accent text-white"
                  : "bg-panel text-sub hover:text-text"
              } ${key !== "day" ? "border-l border-border" : ""}`}
              title={`${g.name} cohorts, ${g.units} since signup`}
            >
              {g.short}
            </button>
          ))}
        </div>
        
        <div className="flex gap-1 border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setViewState({ ...viewState, align: "signup" })}
            className={`px-3 py-1.5 text-xs font-medium ${
              viewState.align === "signup"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            Since signup
          </button>
          <button
            onClick={() => setViewState({ ...viewState, align: "cal" })}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.align === "cal"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            Calendar
          </button>
        </div>
        
        <div className="flex gap-1 border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setViewState({ ...viewState, cell: "pct" })}
            className={`px-3 py-1.5 text-xs font-medium ${
              viewState.cell === "pct"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            %
          </button>
          <button
            onClick={() => setViewState({ ...viewState, cell: "num" })}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.cell === "num"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            #
          </button>
          <button
            onClick={() => setViewState({ ...viewState, cell: "emoji" })}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.cell === "emoji"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            🔥
          </button>
        </div>
        
        <button
          onClick={() => setViewState({ ...viewState, celebrate: !viewState.celebrate })}
          className={`px-3 py-1.5 text-xs font-medium border border-border rounded-lg ${
            viewState.celebrate ? "bg-accent text-white" : "bg-panel text-sub hover:text-text"
          }`}
        >
          🎉 celebrate smiles
        </button>
      </div>

      {renderInsights()}
      
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-4 items-start">
        <div className="bg-panel border border-border rounded-lg p-3 overflow-hidden">
          {renderTable()}
        </div>
        
        <div className="bg-panel border border-border rounded-lg p-3 sticky top-0">
          <div className="mb-2 flex items-center gap-3 text-xs text-sub flex-wrap">
            {viewState.celebrate && (
              <>
                <span className="flex items-center gap-2">
                  <i className="inline-block w-3 h-0.5 rounded-full bg-green" />
                  smiling
                </span>
                <span className="flex items-center gap-2">
                  <i className="inline-block w-3 h-0.5 rounded-full bg-amber" />
                  flat but low
                </span>
              </>
            )}
            <span className="flex items-center gap-2">
              <i className="inline-block w-3 h-0.5 rounded-full bg-gray-300" />
              sliding
            </span>
            <span className="ml-auto">hover a row or curve to trace one</span>
          </div>
          {renderCurves()}
        </div>
      </div>
    </div>
  );
}
