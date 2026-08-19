/**
 * Calendar past / future classification and the sync-age chip.
 *
 * The view stores `isFuture` on the row; the screen reclassifies against
 * local midnight so "today" is neither past nor future.
 */

export function startOfLocalDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

export function classifyCalendarDate(
  eventDate: Date,
  today: Date
): { isPast: boolean; isFuture: boolean; isToday: boolean } {
  const isPast = eventDate < today;
  const isFuture = eventDate > today;
  return { isPast, isFuture, isToday: !isPast && !isFuture };
}

export function formatSyncAge(
  lastSync: Date | null | undefined,
  now: Date = new Date()
): string {
  const ageMs = lastSync ? now.getTime() - lastSync.getTime() : 0;
  if (ageMs < 60000) return "live";
  if (ageMs < 3600000) return `${Math.floor(ageMs / 60000)}m ago`;
  if (ageMs < 86400000) return `${Math.floor(ageMs / 3600000)}h ago`;
  return `${Math.floor(ageMs / 86400000)}d ago`;
}

export function eventsInRange<T extends { date: Date }>(
  events: T[],
  from: Date,
  to: Date
): T[] {
  return events.filter((e) => e.date >= from && e.date <= to);
}

export interface CalendarSourceRollup {
  id: string;
  name: string;
  glyph: string;
  color: string;
  syncAge: string;
  count: number;
}

export function rollupCalendarSources(
  events: Array<{
    source: string;
    sourceName: string;
    sourceGlyph: string;
    sourceColor: string;
    syncAge: string;
  }>
): CalendarSourceRollup[] {
  const sourceMap = new Map<string, CalendarSourceRollup>();
  events.forEach((e) => {
    if (!sourceMap.has(e.source)) {
      sourceMap.set(e.source, {
        id: e.source,
        name: e.sourceName,
        glyph: e.sourceGlyph,
        color: e.sourceColor,
        syncAge: e.syncAge,
        count: 0,
      });
    }
    sourceMap.get(e.source)!.count++;
  });
  return Array.from(sourceMap.values());
}
