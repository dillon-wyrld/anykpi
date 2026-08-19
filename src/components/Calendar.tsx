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

  return (
    <div className="space-y-4">
      <div className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
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

              return (
                <div key={dateKey} className="p-4 hover:bg-panel-2">
                  <div className="font-mono text-xs text-faint uppercase tracking-wider mb-2">
                    {format(date, "EEE, MMM d, yyyy")}
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
