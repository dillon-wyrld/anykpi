/**
 * WBR exception engine, box scores, and the focus data sheet.
 *
 * Chart polylines and the printed table must share the same `weeks` /
 * `prevWeeks` / `months` / `prevMonths` arrays — the sheet never re-samples.
 */

export type WbrStatus = "ok" | "watch" | "off";
export type WbrType = "input" | "output";

export interface WbrMetricLike {
  weeks: number[];
  prevWeeks: number[];
  months: number[];
  prevMonths: number[];
  target: number;
  goodDir: number;
  type: WbrType;
  unit?: string;
  dp?: number;
}

export function wbrDecimals(unit: string | null | undefined): number {
  return unit === "%" || unit === "$" ? 1 : 0;
}

export function wbrGoodDir(goodDir: string | number): number {
  if (typeof goodDir === "number") return goodDir;
  return goodDir === "up" ? 1 : -1;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** API / view-builder WoW and YoY — one decimal, zero baseline → 0. */
export function seriesPctChange(current: number, baseline: number): number {
  return baseline !== 0
    ? round1(((current - baseline) / baseline) * 100)
    : 0;
}

export function seriesWowYoy(
  weeks: number[],
  prevWeeks: number[]
): { current: number; wow: number; yoy: number } {
  const current = weeks[weeks.length - 1] || 0;
  const lastWeek = weeks[weeks.length - 2] || current;
  const lastYear = prevWeeks[prevWeeks.length - 1] || current;
  return {
    current: round2(current),
    wow: seriesPctChange(current, lastWeek),
    yoy: seriesPctChange(current, lastYear),
  };
}

export function wfmt(v: number, m: Pick<WbrMetricLike, "dp" | "unit">): string {
  const dp = m.dp || 0;
  const s = Number(v).toFixed(dp);
  return (m.unit === "$" ? "$" : "") + s + (m.unit && m.unit !== "$" ? m.unit : "");
}

export function wsign(v: number): string {
  return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v) + "%";
}

export function wsd(a: number[]): number {
  const mu = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - mu) ** 2, 0) / a.length);
}

/** Documented defaults — also the contents of `anykpi.config.example.json`. */
export interface WbrExceptionRules {
  consecutiveMissesForOff: number;
  consecutiveMissesForWatch: number;
  inputThinWinStdDevs: number;
  wrongWayLookbackWeeks: number;
}

export const DEFAULT_WBR_EXCEPTION_RULES: WbrExceptionRules = {
  consecutiveMissesForOff: 2,
  consecutiveMissesForWatch: 1,
  inputThinWinStdDevs: 1,
  wrongWayLookbackWeeks: 3,
};

export type WbrStat = { k: WbrStatus; why: string; rule: string | null };

function exception(k: WbrStatus, rule: string, detail: string): WbrStat {
  return { k, rule, why: `Rule: ${rule}. ${detail}` };
}

/** The exception engine shown on the deck / focus / table. */
export function wbrStat(
  m: Pick<WbrMetricLike, "weeks" | "target" | "goodDir" | "type" | "unit" | "dp">,
  rules: WbrExceptionRules = DEFAULT_WBR_EXCEPTION_RULES
): WbrStat {
  const w = m.weeks;
  const n = w.length;
  const lw = w[n - 1];
  const t = m.target;
  const dir = m.goodDir;
  const hits = (v: number) => (dir > 0 ? v >= t : v <= t);
  const F = (v: number) => wfmt(v, m);
  const G = (v: number) =>
    m.unit === "%" ? Number(v).toFixed(m.dp || 0) + " points" : F(v);

  let miss = 0;
  for (let i = n - 1; i >= 0 && !hits(w[i]); i--) miss++;

  const lookback = Math.min(rules.wrongWayLookbackWeeks, n);
  const worse = lookback >= 2 && (lw - w[n - lookback]) * dir < 0;
  const trend = lookback >= 2 ? w.slice(n - lookback).map(F).join(" → ") : F(lw);
  const sd = wsd(w);
  const margin = Math.abs(lw - t);
  const priorMiss = w.slice(0, n - 1).filter((v) => !hits(v)).length;
  const thinWinLimit = sd * rules.inputThinWinStdDevs;

  if (miss >= rules.consecutiveMissesForOff) {
    const rule = `${rules.consecutiveMissesForOff} or more consecutive weeks off target`;
    return exception(
      "off",
      rule,
      `${miss} weeks off target${
        worse ? `, and still going the wrong way (${trend})` : ""
      }. That is exceptional variation, not the usual wobble.`
    );
  }

  if (miss >= rules.consecutiveMissesForWatch) {
    const rule =
      miss === 1 && rules.consecutiveMissesForWatch === 1
        ? "first week off target"
        : `${rules.consecutiveMissesForWatch} or more consecutive weeks off target (watch)`;
    const detail =
      miss === 1
        ? `first week off target (${F(lw)} against ${F(t)}). One week is not a trend — watch it, don't theorise about it.`
        : `${miss} weeks off target (${F(lw)} against ${F(t)}). Not yet the off threshold (${rules.consecutiveMissesForOff} weeks).`;
    return exception("watch", rule, detail);
  }

  if (m.type === "input" && margin < thinWinLimit) {
    const rule = `input on target by less than ${rules.inputThinWinStdDevs}× usual weekly wobble`;
    return exception(
      "watch",
      rule,
      `on the right side of target for the first time in ${priorMiss + 1} weeks, but by only ${G(margin)} — less than one normal week's wobble (±${G(Number(sd.toFixed(m.dp || 0)))}). Not a real win yet.`
    );
  }

  if (m.type === "input" && worse) {
    const weekWord = rules.wrongWayLookbackWeeks === 1 ? "week" : "weeks";
    const rule = `input still on target but turning the wrong way across ${rules.wrongWayLookbackWeeks} ${weekWord}`;
    return exception(
      "watch",
      rule,
      `still on target but turning the wrong way across ${rules.wrongWayLookbackWeeks} weeks (${trend}). Inputs get discussed early, while they are still cheap to move.`
    );
  }

  return {
    k: "ok",
    rule: null,
    why: `on target and inside its usual range — a one-second glance, no discussion.`,
  };
}

/** Last-week box score on every card and the table. */
export function wbrBox(
  m: Pick<WbrMetricLike, "weeks" | "prevWeeks" | "target" | "goodDir">
): { lw: number; wow: number; yoy: number; on: boolean } {
  const lw = m.weeks[5];
  const wow = Math.round(((lw - m.weeks[4]) / m.weeks[4]) * 100);
  const yoy = Math.round(((lw - m.prevWeeks[5]) / m.prevWeeks[5]) * 100);
  const on = m.goodDir > 0 ? lw >= m.target : lw <= m.target;
  return { lw, wow, yoy, on };
}

export function sheetPct(a: number, b: number): number | null {
  return b ? Math.round(((a - b) / Math.abs(b)) * 100) : null;
}

export function sheetRoll(
  values: number[],
  m: Pick<WbrMetricLike, "unit" | "dp">
): number {
  const isAvg = (m.unit && m.unit !== "$") || (m.dp ?? 0) > 0;
  const t = values.reduce((s, v) => s + v, 0);
  return isAvg ? t / values.length : t;
}

export interface WbrSheet {
  weeks: number[];
  months: number[];
  prevWeeks: number[];
  prevMonths: number[];
  weekPop: Array<number | null>;
  monthPop: Array<number | null>;
  weekYoy: Array<number | null>;
  monthYoy: Array<number | null>;
  t12: number;
  p12: number;
  t12Yoy: number | null;
}

/**
 * Focus data sheet. Values are the same arrays the 6-week / 12-month chart
 * draws; PoP / YoY / T12M are derived from those arrays only.
 */
export function wbrSheet(m: WbrMetricLike): WbrSheet {
  const t12 = sheetRoll(m.months, m);
  const p12 = sheetRoll(m.prevMonths, m);
  return {
    weeks: m.weeks,
    months: m.months,
    prevWeeks: m.prevWeeks,
    prevMonths: m.prevMonths,
    weekPop: m.weeks.map((v, i) => (i ? sheetPct(v, m.weeks[i - 1]) : null)),
    monthPop: m.months.map((v, i) => (i ? sheetPct(v, m.months[i - 1]) : null)),
    weekYoy: m.weeks.map((v, i) => sheetPct(v, m.prevWeeks[i])),
    monthYoy: m.months.map((v, i) => sheetPct(v, m.prevMonths[i])),
    t12,
    p12,
    t12Yoy: sheetPct(t12, p12),
  };
}

export function sheetTint(
  p: number | null,
  goodDir: number
): string {
  if (p === null) return "";
  const good = p * goodDir >= 0;
  const a = ((Math.min(Math.abs(p), 60) / 60) * 0.32 + 0.07).toFixed(2);
  return `rgba(${good ? "94,106,210" : "212,61,81"},${a})`;
}

export function wbrExceptions<T extends { stat: { k: WbrStatus } }>(
  metrics: T[]
): T[] {
  return metrics.filter((m) => m.stat.k !== "ok");
}
