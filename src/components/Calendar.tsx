"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, addDays, startOfWeek, endOfMonth, isSameDay, differenceInDays } from "date-fns";
import {
  classifyCalendarDate,
  eventsInRange,
  rollupCalendarSources,
  startOfLocalDay,
} from "@/core/views/calendar-math";
import { FreshnessChip } from "@/components/FreshnessChip";
import { ViewEmptyState } from "@/components/ViewEmptyState";
import { useFreshness } from "@/components/useFreshness";
import { formatCompanyDayLabel } from "@/core/company-day";

interface CalendarEvent {
  id: number;
  source: string;
  sourceName: string;
  sourceColor: string;
  sourceGlyph: string;
  type: string;
  date: Date;
  title: string;
  badge: string;
  detail: string;
  isPast: boolean;
  isFuture: boolean;
  syncAge: string;
}

interface Source {
  id: string;
  name: string;
  glyph: string;
  color: string;
  syncAge: string;
  count: number;
}

interface ViewState {
  view: "week" | "month";
  offset: number;
  excludedSources: Set<string>;
  filter: "all" | "launch" | "ritual" | "milestone" | "comms";
}

interface CalendarProps {
  workspace: string;
}

const TYPES = {
  launch: "🚢 Launches",
  ritual: "📊 Rituals",
  milestone: "🎉 Milestones",
  comms: "✉️ Comms",
};

function encodeViewState(vs: ViewState): string {
  const params = new URLSearchParams();
  if (vs.view !== "week") params.set("v", vs.view);
  if (vs.offset !== 0) params.set("o", vs.offset.toString());
  if (vs.excludedSources.size > 0) params.set("x", Array.from(vs.excludedSources).join(","));
  if (vs.filter !== "all") params.set("f", vs.filter);
  const str = params.toString();
  return str ? `?${str}` : "";
}

function decodeViewState(searchParams: URLSearchParams): Partial<ViewState> {
  const vs: Partial<ViewState> = {};
  if (searchParams.has("v")) vs.view = searchParams.get("v") as any;
  if (searchParams.has("o")) vs.offset = parseInt(searchParams.get("o")!, 10);
  if (searchParams.has("x")) vs.excludedSources = new Set(searchParams.get("x")!.split(","));
  if (searchParams.has("f")) vs.filter = searchParams.get("f") as any;
  return vs;
}

export default function Calendar({ workspace }: CalendarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const today = startOfLocalDay(new Date());

  const defaultViewState: ViewState = {
    view: "week",
    offset: 0,
    excludedSources: new Set(),
    filter: "all",
  };

  const urlState = decodeViewState(searchParams);
  const [viewState, setViewState] = useState<ViewState>({
    ...defaultViewState,
    ...urlState,
    excludedSources: urlState.excludedSources || new Set(),
  });

  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [dayLabel, setDayLabel] = useState(formatCompanyDayLabel(null));
  const [loading, setLoading] = useState(true);
  const initialSyncDone = useRef(false);

  const loadCalendar = useCallback((refresh = false) => {
    fetch(`/api/views/calendar?workspace=${workspace}`)
      .then((res) => res.json())
      .then((data) => {
        const events = (data.events || []).map((e: any) => {
          const date = new Date(e.date);
          return {
            ...e,
            date,
            ...classifyCalendarDate(date, today),
          };
        });
        setAllEvents(events);
        setSources(rollupCalendarSources(events));
        if (!refresh) setLoading(false);
      })
      .catch(() => {
        if (!refresh) setLoading(false);
      });
  }, [workspace, today]);

  useEffect(() => {
    loadCalendar(false);
  }, [loadCalendar]);

  useEffect(() => {
    fetch(`/api/v1/config?workspace=${encodeURIComponent(workspace)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { dayLabel?: string } | null) => {
        if (data?.dayLabel) setDayLabel(data.dayLabel);
      })
      .catch(() => {
        // Keep the default Day of YourCo label
      });
  }, [workspace]);

  const freshnessHealth = useFreshness({
    workspace,
    watch: ["sources"],
    onStale: () => loadCalendar(true),
  });

  useEffect(() => {
    // Skip the URL sync on initial mount so workspace= and view= stay put
    if (!initialSyncDone.current) {
      initialSyncDone.current = true;
      return;
    }

    const encoded = encodeViewState(viewState);
    const params = new URLSearchParams(searchParams.toString());
    const viewStateKeys = ["v", "o", "x", "f"];

    if (encoded) {
      const newParams = new URLSearchParams(encoded.slice(1));
      newParams.forEach((value, key) => {
        params.set(key, value);
      });
      viewStateKeys.forEach((key) => {
        if (!newParams.has(key)) params.delete(key);
      });
    } else {
      viewStateKeys.forEach((key) => params.delete(key));
    }

    const newSearch = params.toString();
    if (newSearch !== searchParams.toString()) {
      router.replace(`/dashboard?${newSearch}`, { scroll: false });
    }
  }, [viewState, router, searchParams]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setViewState((vs) => ({ ...vs, offset: vs.offset - 1 }));
      } else if (e.key === "ArrowRight") {
        setViewState((vs) => ({ ...vs, offset: vs.offset + 1 }));
      } else if (e.key === "t") {
        setViewState((vs) => ({ ...vs, offset: 0 }));
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const filteredEvents = allEvents.filter((e) => {
    if (viewState.excludedSources.has(e.source)) return false;
    if (viewState.filter !== "all" && e.type !== viewState.filter) return false;
    return true;
  });

  const getDateRange = useCallback(() => {
    if (viewState.view === "week") {
      const weekStart = addDays(startOfWeek(today, { weekStartsOn: 1 }), viewState.offset * 7);
      const weekEnd = addDays(weekStart, 6);
      return { from: weekStart, to: weekEnd };
    } else {
      const monthStart = new Date(today.getFullYear(), today.getMonth() + viewState.offset, 1);
      const monthEnd = endOfMonth(monthStart);
      return { from: monthStart, to: monthEnd };
    }
  }, [viewState.view, viewState.offset, today]);

  const renderWeekView = useCallback(() => {
    const { from } = getDateRange();
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));

    return (
      <div className="grid grid-cols-7 gap-3">
        {days.map((day, i) => {
          const isToday = isSameDay(day, today);
          const dayEvents = filteredEvents.filter((e) => isSameDay(e.date, day));
          const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

          return (
            <div key={i} className={`bg-panel border rounded-lg overflow-hidden ${isToday ? "border-accent shadow-lg" : "border-border"}`}>
              <div className={`px-3 py-2 border-b ${isToday ? "bg-accent text-white" : "bg-panel-2 border-rule"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold">{WEEKDAYS[i]}</span>
                  <span className={`text-lg font-semibold ${isToday ? "text-white" : ""}`}>{day.getDate()}</span>
                </div>
                {isToday && <div className="text-[10px] uppercase tracking-wider mt-1">Today</div>}
              </div>
              <div className="p-2 space-y-2 min-h-[200px]">
                {dayEvents.length === 0 ? (
                  <div className="text-center text-sub text-xs py-8">—</div>
                ) : (
                  dayEvents.map((event) => (
                    <div
                      key={event.id}
                      className={`relative pl-3 pr-2 py-2 rounded text-xs border ${
                        event.isFuture ? "border-dashed bg-transparent" : "bg-panel-2 border-transparent"
                      } ${event.isPast ? "opacity-60" : ""}`}
                    >
                      <div
                        className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r"
                        style={{ backgroundColor: event.sourceColor }}
                      />
                      <div className="flex items-start gap-1.5">
                        <span className="text-base">{event.sourceGlyph}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium leading-tight truncate">{event.title}</div>
                          <div className="text-[10px] text-sub mt-1 flex items-center gap-1 flex-wrap">
                            <span>{event.sourceGlyph}</span>
                            <span>{event.badge}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }, [getDateRange, filteredEvents, today]);

  const renderMonthView = useCallback(() => {
    const { from, to } = getDateRange();
    const monthStart = startOfWeek(from, { weekStartsOn: 1 });
    const cells = [];
    const weeks = Math.ceil(differenceInDays(to, monthStart) / 7) + 1;

    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const day = addDays(monthStart, w * 7 + d);
        const isToday = isSameDay(day, today);
        const isOutsideMonth = day.getMonth() !== from.getMonth();
        const dayEvents = filteredEvents.filter((e) => isSameDay(e.date, day));

        cells.push(
          <div
            key={`${w}-${d}`}
            className={`bg-panel border rounded-lg p-2 min-h-[96px] overflow-hidden ${
              isToday ? "border-accent shadow-md" : isOutsideMonth ? "border-border/30 bg-transparent" : "border-border"
            }`}
          >
            <div className={`text-xs font-semibold mb-2 ${isOutsideMonth ? "text-faint" : isToday ? "text-accent" : "text-sub"}`}>
              {day.getDate()}
            </div>
            <div className="space-y-1">
              {dayEvents.slice(0, 3).map((event) => (
                <div
                  key={event.id}
                  className={`flex items-center gap-1.5 text-[10px] rounded px-2 py-1 border ${
                    event.isFuture ? "border-dashed bg-transparent" : "bg-panel-2 border-transparent"
                  }`}
                >
                  <span>{event.sourceGlyph}</span>
                  <span className="truncate flex-1">{event.title}</span>
                </div>
              ))}
              {dayEvents.length > 3 && (
                <div className="text-[10px] text-sub pl-2">+{dayEvents.length - 3} more</div>
              )}
            </div>
          </div>
        );
      }
    }

    const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    return (
      <div className="grid grid-cols-7 gap-3">
        {WEEKDAYS.map((day) => (
          <div key={day} className="text-xs text-sub text-center font-mono mb-1">
            {day}
          </div>
        ))}
        {cells}
      </div>
    );
  }, [getDateRange, filteredEvents, today]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-sub bg-panel border border-border rounded-lg p-3">
          📖 <strong>Read-only</strong> — Calendar events are synced from your existing tools. Nothing here is typed in.
        </div>
        <div className="text-sub">Loading...</div>
      </div>
    );
  }

  if (allEvents.length === 0) {
    return (
      <div className="space-y-3">
        <FreshnessChip health={freshnessHealth} />
        <ViewEmptyState view="calendar" workspace={workspace} />
      </div>
    );
  }

  const { from, to } = getDateRange();
  const rangeText =
    viewState.view === "week"
      ? `${format(from, "d MMM")} – ${format(to, "d MMM, yyyy")}`
      : format(from, "MMMM yyyy");

  const visibleCount = eventsInRange(filteredEvents, from, to).length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Calendar</h2>
        <FreshnessChip health={freshnessHealth} />

        <div className="flex gap-1 border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setViewState({ ...viewState, offset: viewState.offset - 1 })}
            className="px-3 py-1.5 text-sm font-medium bg-panel text-sub hover:text-text"
            title="earlier"
          >
            ‹
          </button>
          <button
            onClick={() => setViewState({ ...viewState, offset: 0 })}
            className={`px-3 py-1.5 text-xs font-medium border-l border-r border-border ${
              viewState.offset === 0 ? "bg-accent text-white" : "bg-panel text-sub hover:text-text"
            }`}
          >
            today
          </button>
          <button
            onClick={() => setViewState({ ...viewState, offset: viewState.offset + 1 })}
            className="px-3 py-1.5 text-sm font-medium bg-panel text-sub hover:text-text"
            title="later"
          >
            ›
          </button>
        </div>

        <span className="text-sm text-sub">{rangeText}</span>
        <span className="text-sm text-sub">·</span>
        <span className="text-sm text-sub">
          {visibleCount} event{visibleCount !== 1 ? "s" : ""}
        </span>

        <span style={{ flex: 1 }} />

        <span className="text-xs border border-border rounded-lg px-2 py-1 bg-panel">
          {dayLabel}
        </span>

        <div className="flex gap-1 border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setViewState({ ...viewState, view: "week", offset: 0 })}
            className={`px-3 py-1.5 text-xs font-medium ${
              viewState.view === "week" ? "bg-accent text-white" : "bg-panel text-sub hover:text-text"
            }`}
          >
            Week
          </button>
          <button
            onClick={() => setViewState({ ...viewState, view: "month", offset: 0 })}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.view === "month" ? "bg-accent text-white" : "bg-panel text-sub hover:text-text"
            }`}
          >
            Month
          </button>
        </div>

        <div className="text-xs text-sub flex items-center gap-2">
          <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded">←/→</kbd>
          navigate ·
          <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded">t</kbd>
          today
        </div>
      </div>

      <div className="bg-panel border border-border rounded-lg p-3">
        <div className="text-[10px] uppercase tracking-wider text-faint mb-3">Synced from</div>
        <div className="flex items-center gap-2 flex-wrap">
          {sources.map((source) => (
            <button
              key={source.id}
              onClick={() => {
                const excluded = new Set(viewState.excludedSources);
                if (excluded.has(source.id)) {
                  excluded.delete(source.id);
                } else {
                  excluded.add(source.id);
                }
                setViewState({ ...viewState, excludedSources: excluded });
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition-all ${
                viewState.excludedSources.has(source.id)
                  ? "border-border bg-transparent opacity-45"
                  : "border-border bg-panel hover:border-accent"
              }`}
              title={source.name}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: viewState.excludedSources.has(source.id) ? "#c9c9cf" : source.color }}
              />
              <span>{source.glyph}</span>
              <span className="font-medium">{source.name}</span>
              <span className="text-faint">{source.syncAge}</span>
            </button>
          ))}
          <a
            href="/connect"
            className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-dashed border-border text-xs text-accent hover:border-accent"
          >
            + connect a source
          </a>
        </div>
      </div>

      {viewState.filter !== "all" && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-sub">Filtered to:</span>
          <div className="flex items-center gap-1 px-2 py-1 bg-accent-soft rounded">
            <span>{TYPES[viewState.filter]}</span>
            <button
              onClick={() => setViewState({ ...viewState, filter: "all" })}
              className="ml-1 text-accent hover:text-red"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setViewState({ ...viewState, filter: "all" })}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
            viewState.filter === "all"
              ? "bg-accent text-white"
              : "bg-panel border border-border text-sub hover:text-text"
          }`}
        >
          All
        </button>
        {Object.entries(TYPES).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setViewState({ ...viewState, filter: key as any })}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
              viewState.filter === key
                ? "bg-accent text-white"
                : "bg-panel border border-border text-sub hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="text-xs text-sub bg-panel border border-border rounded-lg p-3">
        📖 <strong>Read-only</strong> — Calendar events are synced from your existing tools. Nothing here is typed in.
      </div>

      {viewState.view === "week" ? renderWeekView() : renderMonthView()}
    </div>
  );
}
