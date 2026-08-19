"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";

interface CalendarEvent {
  id: number;
  source: string;
  type: string;
  date: Date;
  title: string;
  amount?: number;
  badge?: string;
  url?: string;
  syncAge?: string;
  syncStatus?: string;
}

interface CalendarProps {
  workspace: string;
}

export default function Calendar({ workspace }: CalendarProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/views/calendar?workspace=${workspace}`)
      .then((res) => res.json())
      .then((data) => {
        setEvents(
          (data.events || []).map((e: any) => ({
            ...e,
            date: new Date(e.date),
          }))
        );
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [workspace]);

  if (loading) {
    return <div className="text-sub">Loading...</div>;
  }

  const groupedEvents = events.reduce((acc, event) => {
    const dateKey = format(event.date, "yyyy-MM-dd");
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(event);
    return acc;
  }, {} as Record<string, CalendarEvent[]>);

  const sortedDates = Object.keys(groupedEvents).sort();
  
  const sources = Array.from(new Set(events.map(e => e.source)));
  const sourceSyncInfo = sources.map(source => {
    const event = events.find(e => e.source === source);
    return {
      source,
      syncAge: event?.syncAge || 'unknown',
      syncStatus: event?.syncStatus || 'unknown',
      count: events.filter(e => e.source === source).length
    };
  });

  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1">
          <div className="bg-panel border border-border rounded-lg shadow-sm p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-faint mb-3">Sources</div>
            <div className="space-y-3">
              {sourceSyncInfo.map(({ source, syncAge, syncStatus, count }) => (
                <div key={source} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{source}</span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        syncStatus === 'ok' ? 'bg-green' : 'bg-amber'
                      }`}
                    />
                  </div>
                  <div className="text-xs text-sub">
                    {count} events · {syncAge}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-rule bg-panel-2">
            <span className="eyebrow text-[10px]">{events.length} events · read-only</span>
          </div>

        <div className="divide-y divide-rule">
          {sortedDates.length === 0 ? (
            <div className="p-8 text-center text-sub text-sm">
              No events
            </div>
          ) : (
            sortedDates.map((dateKey) => {
              const dayEvents = groupedEvents[dateKey];
              const date = new Date(dateKey);
              const isPast = date < now;

              return (
                <div key={dateKey} className={`p-4 hover:bg-panel-2 ${isPast ? 'opacity-70' : ''}`}>
                  <div className="font-mono text-xs text-faint uppercase tracking-wider mb-2">
                    {format(date, "EEE, MMM d, yyyy")}
                    {!isPast && <span className="ml-2 text-accent">→ upcoming</span>}
                  </div>
                  <div className="space-y-2">
                    {dayEvents.map((event) => (
                      <div key={event.id} className="flex items-start gap-3">
                        {event.badge && <span className="text-xl">{event.badge}</span>}
                        <div className="flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="font-medium">{event.title}</span>
                            <span className="text-xs text-faint font-mono uppercase tracking-wider">
                              {event.source}
                            </span>
                          </div>
                          {event.amount && (
                            <div className="text-sm text-sub">
                              ${event.amount.toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

      </div>
    </div>
  );
}
