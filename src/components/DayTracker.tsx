"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CompanyProfileSchema,
  OverviewResponseSchema,
  type CompanyProfile,
  type OverviewResponse,
} from "@/core/contracts";
import { useFreshness } from "@/components/useFreshness";
import { useWorkspaceSession } from "@/components/WorkspaceSession";
import {
  buildDayTrackerSnapshot,
  defaultShownKeys,
  railMarkerPercent,
  resolveShownKeys,
  type DayTrackerCity,
  type DayTrackerSnapshot,
} from "@/components/day-tracker";
import { createDayTrackerTicker } from "@/components/day-tracker-tick";
import {
  markCelebrated,
  shouldFireCelebration,
} from "@/core/daytrack-celebrate";
import "./daytrack.css";

const SHOWN_STORAGE = "anykpi.shownCities.";
const CELEBRATED_STORAGE = "anykpi.celebratedDays.";
const CONFETTI = ["🎉", "✨", "🎉", "✨", "🎉"] as const;

function cityByKey(
  cities: DayTrackerCity[],
  key: string
): DayTrackerCity | undefined {
  return cities.find((row) => row.key === key);
}

function readLocalList(prefix: string, workspace: string): string[] | undefined {
  try {
    const raw = window.localStorage.getItem(prefix + workspace);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((row) => typeof row !== "string")) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function writeLocalList(prefix: string, workspace: string, keys: string[]): void {
  try {
    window.localStorage.setItem(prefix + workspace, JSON.stringify(keys));
  } catch {
    // quota / private mode — in-memory + server persist still apply
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function DayTracker({ workspace }: { workspace: string }) {
  const session = useWorkspaceSession();
  const ready = workspace === "demo" || session?.status === "in";
  const [snap, setSnap] = useState<DayTrackerSnapshot | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const shownRef = useRef<string[] | undefined>(undefined);
  const celebratedRef = useRef<string[]>([]);
  const claimedRef = useRef<Set<string>>(new Set());
  const sigRef = useRef<string>("");
  const profileRef = useRef<CompanyProfile | null>(null);
  const overviewRef = useRef<OverviewResponse | null>(null);

  const paint = useCallback(
    (profile: CompanyProfile | null, overview: OverviewResponse | null, now: Date) => {
      const next = buildDayTrackerSnapshot({
        workspace,
        profile,
        overview,
        now,
        shownKeys: shownRef.current,
      });
      if (shownRef.current === undefined) {
        shownRef.current = next.shownKeys;
      }
      if (next.signature === sigRef.current) return;
      sigRef.current = next.signature;
      setSnap(next);
    },
    [workspace]
  );

  const persistShown = useCallback(
    (keys: string[]) => {
      writeLocalList(SHOWN_STORAGE, workspace, keys);
      void fetch("/api/v1/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace, shownCities: keys }),
      });
    },
    [workspace]
  );

  const persistCelebrated = useCallback(
    (keys: string[]) => {
      writeLocalList(CELEBRATED_STORAGE, workspace, keys);
      void fetch("/api/v1/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace,
          celebratedMilestoneKeys: keys,
        }),
      });
    },
    [workspace]
  );

  const load = useCallback(async () => {
    if (!ready) return;
    const query = `workspace=${encodeURIComponent(workspace)}`;
    const [profileRes, overviewRes] = await Promise.all([
      fetch(`/api/v1/config?${query}`),
      fetch(`/api/v1/overview?${query}`),
    ]);
    const profile = profileRes.ok
      ? CompanyProfileSchema.parse(await profileRes.json())
      : profileRef.current;
    const overview = overviewRes.ok
      ? OverviewResponseSchema.parse(await overviewRes.json())
      : overviewRef.current;
    if (profile) {
      profileRef.current = profile;
      celebratedRef.current = profile.celebratedMilestoneKeys;
      const localCelebrated = readLocalList(CELEBRATED_STORAGE, workspace) ?? [];
      for (const key of localCelebrated) {
        if (!celebratedRef.current.includes(key)) {
          celebratedRef.current = markCelebrated(celebratedRef.current, key);
        }
      }
      if (shownRef.current === undefined) {
        shownRef.current =
          profile.shownCities ?? readLocalList(SHOWN_STORAGE, workspace);
      }
    }
    if (overview) overviewRef.current = overview;
    paint(profile, overview, new Date());
  }, [paint, ready, workspace]);

  useEffect(() => {
    if (!ready) return;
    shownRef.current = undefined;
    celebratedRef.current = [];
    claimedRef.current = new Set();
    sigRef.current = "";
    profileRef.current = null;
    overviewRef.current = null;
    setSnap(null);
    setPickerOpen(false);
    setCelebrating(false);

    const ticker = createDayTrackerTicker({
      isHidden: () => document.visibilityState === "hidden",
      onTick: async () => {
        await load();
      },
    });
    const onVisibility = () => ticker.handleVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    void ticker.mount();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      ticker.dispose();
    };
  }, [load, ready, workspace]);

  useFreshness({
    workspace,
    watch: ["ingest", "sources"],
    onStale: () => {
      if (document.visibilityState === "hidden") return;
      void load();
    },
  });

  useEffect(() => {
    const key = snap?.milestone?.key;
    if (
      !key ||
      claimedRef.current.has(key) ||
      !shouldFireCelebration({
        milestoneKey: key,
        celebratedKeys: celebratedRef.current,
        reducedMotion: prefersReducedMotion(),
      })
    ) {
      return;
    }
    claimedRef.current.add(key);
    celebratedRef.current = markCelebrated(celebratedRef.current, key);
    persistCelebrated(celebratedRef.current);
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), 1600);
    return () => window.clearTimeout(timer);
  }, [persistCelebrated, snap?.milestone?.key]);

  if (!ready || !snap) return null;
  const current = snap;

  const shown = current.shownKeys
    .map((key) => cityByKey(current.cities, key))
    .filter((row): row is DayTrackerCity => row != null);
  const hidden = current.cities.filter((row) => !current.shownKeys.includes(row.key));
  const removable = shown.filter((row) => !row.home);

  function applyShown(next: string[]) {
    const resolved = resolveShownKeys(next, current.cities);
    shownRef.current = resolved;
    sigRef.current = "";
    persistShown(resolved);
    paint(profileRef.current, overviewRef.current, new Date());
  }

  function togglePicker() {
    setPickerOpen((open) => !open);
  }

  function addCity(key: string) {
    applyShown([...(shownRef.current ?? current.shownKeys), key]);
  }

  function removeCity(key: string) {
    const next = (shownRef.current ?? current.shownKeys).filter((k) => k !== key);
    applyShown(next.length > 0 ? next : defaultShownKeys(current.cities));
  }

  return (
    <div
      className={`daytrack${celebrating ? " celebrate" : ""}`}
      id="daytrack"
      data-testid="daytrack"
      data-milestone-key={current.milestone?.key ?? ""}
      data-milestone-source={current.milestone?.source ?? ""}
      data-milestone-title={current.milestone?.title ?? ""}
    >
      {celebrating
        ? CONFETTI.map((mark, index) => (
            <span
              key={`${mark}-${index}`}
              className="confetti"
              data-testid="daytrack-celebrate"
              style={{
                left: `${18 + index * 14}%`,
                animationDelay: `${index * 0.08}s`,
              }}
            >
              {mark}
            </span>
          ))
        : null}
      <div className="dthead">
        <span className="dayn-lb" data-testid="daytrack-label">
          {current.dayLabel}
        </span>
        {current.milestone ? (
          <span className="dtchip" data-testid="daytrack-milestone">
            {current.milestone.title}
          </span>
        ) : null}
        {current.demo ? (
          <span className="dtchip" data-testid="daytrack-demo">
            demo
          </span>
        ) : current.freshnessLabel ? (
          <span className="dtchip" data-testid="daytrack-freshness">
            {current.freshnessLabel}
          </span>
        ) : null}
      </div>
      <div className="dphero">
        <b>
          Day <span data-testid="daytrack-day">{current.dayN}</span>
        </b>
        <span data-testid="daytrack-left">{current.timeLeftLabel} left</span>
      </div>
      {current.foundedLine ? (
        <div className="dpsub" data-testid="daytrack-founded">
          {current.foundedLine}
        </div>
      ) : null}
      <div className="dpgrid">
        {current.stats.map((stat) => (
          <div className="dpst" key={stat.label} data-testid={`daytrack-stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <div>
              <div className="dayn-lb">{stat.label}</div>
              <div
                className="v"
                data-testid={stat.label === "Online" ? "daytrack-online" : undefined}
              >
                {stat.value}
              </div>
            </div>
            <div
              className="dprail"
              style={{ "--p": `${railMarkerPercent(stat.pct).toFixed(1)}%` } as CSSProperties}
            >
              <i />
            </div>
          </div>
        ))}
      </div>
      <div className="dptz">
        <div className="tzhd">
          <span className="dayn-lb">Online · past hr</span>
          <button
            type="button"
            className={`tzgear${pickerOpen ? " on" : ""}`}
            data-testid="daytrack-gear"
            aria-expanded={pickerOpen}
            aria-label="choose which timezones to show"
            title="choose which timezones to show"
            onClick={togglePicker}
          >
            <svg
              viewBox="0 0 16 16"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M2 5h4.6M10 5h4M2 11h3M8.4 11h5.6" />
              <circle cx="8.3" cy="5" r="1.7" />
              <circle cx="6.7" cy="11" r="1.7" />
            </svg>
          </button>
        </div>
        {shown.map((city) => (
          <div
            key={city.key}
            className={`tzrow${city.asleep ? " asleep" : ""}`}
            data-testid={`daytrack-city-${city.short.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <div className="tzhead">
              <b>
                {city.flag} {city.short}
              </b>
              <s>
                {city.online}/{city.users}
              </s>
              <span
                className={`udelta${city.cameOnline || city.droppedOff ? "" : " quiet"}`}
                title={`past hour in ${city.city}: ${city.cameOnline} came online, ${city.droppedOff} dropped off`}
              >
                <b>+{city.cameOnline}</b>
                <i>−{city.droppedOff}</i>
              </span>
            </div>
            <div
              className="tzbar"
              style={{ "--x": `${city.needle.toFixed(2)}%` } as CSSProperties}
              title={`${city.city} — ${city.clock} local · ${city.online} of ${city.users} online`}
            >
              <u />
              <em className={city.anchor}>
                {city.night ? "🌙 " : ""}
                {city.clock}
              </em>
            </div>
          </div>
        ))}
        <div className="tzax">
          <b>12a</b>
          <b>6a</b>
          <b>12p</b>
          <b>6p</b>
          <b>12a</b>
        </div>
        <div className={`tzadd${pickerOpen ? " open" : ""}`}>
          {hidden.map((city) => (
            <button
              key={`add-${city.key}`}
              type="button"
              title={`add ${city.city}`}
              data-testid={`daytrack-add-${city.short.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={() => addCity(city.key)}
            >
              + {city.short} {city.users}
            </button>
          ))}
          {removable.map((city) => (
            <button
              key={`rm-${city.key}`}
              type="button"
              className="rm"
              title={`hide ${city.city}`}
              data-testid={`daytrack-hide-${city.short.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={() => removeCity(city.key)}
            >
              {city.short} ×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
