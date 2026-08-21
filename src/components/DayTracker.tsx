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
  type DayTrackerCity,
  type DayTrackerSnapshot,
} from "@/components/day-tracker";
import { createDayTrackerTicker } from "@/components/day-tracker-tick";
import "./daytrack.css";

function cityByKey(
  cities: DayTrackerCity[],
  key: string
): DayTrackerCity | undefined {
  return cities.find((row) => row.key === key);
}

export default function DayTracker({ workspace }: { workspace: string }) {
  const session = useWorkspaceSession();
  const ready = workspace === "demo" || session?.status === "in";
  const [snap, setSnap] = useState<DayTrackerSnapshot | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const shownRef = useRef<string[] | undefined>(undefined);
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
    if (profile) profileRef.current = profile;
    if (overview) overviewRef.current = overview;
    paint(profile, overview, new Date());
  }, [paint, ready, workspace]);

  useEffect(() => {
    if (!ready) return;
    shownRef.current = undefined;
    sigRef.current = "";
    profileRef.current = null;
    overviewRef.current = null;
    setSnap(null);
    setPickerOpen(false);

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

  if (!ready || !snap) return null;
  const current = snap;

  const shown = current.shownKeys
    .map((key) => cityByKey(current.cities, key))
    .filter((row): row is DayTrackerCity => row != null);
  const hidden = current.cities.filter((row) => !current.shownKeys.includes(row.key));
  const removable = shown.filter((row) => !row.home);

  function togglePicker() {
    setPickerOpen((open) => !open);
  }

  function addCity(key: string) {
    const next = [...(shownRef.current ?? current.shownKeys), key];
    shownRef.current = next;
    sigRef.current = "";
    paint(profileRef.current, overviewRef.current, new Date());
  }

  function removeCity(key: string) {
    const next = (shownRef.current ?? current.shownKeys).filter((k) => k !== key);
    shownRef.current = next.length > 0 ? next : defaultShownKeys(current.cities);
    sigRef.current = "";
    paint(profileRef.current, overviewRef.current, new Date());
  }

  return (
    <div className="daytrack" id="daytrack" data-testid="daytrack">
      <div className="dthead">
        <span className="dayn-lb" data-testid="daytrack-label">
          {current.dayLabel}
        </span>
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
