/**
 * Company-profile copy and validation. No database imports — /connect
 * (a client page) uses the same Day-of label the API and CLI print.
 */

export const DEFAULT_COMPANY_NAME = "YourCo";

export const FOUNDED_AT_FUTURE_ERROR = "Founded date cannot be in the future";
export const FOUNDED_AT_INVALID_ERROR = "Founded date is not a valid date";
export const COMPANY_NAME_EMPTY_ERROR = "Company name cannot be empty";
export const HOME_CITY_TIMEZONE_ERROR =
  "Home city timezone must be a valid IANA time zone";
export const HOME_CITY_LABEL_ERROR = "Home city needs a label";

export const COMPANY_NAME_MAX = 80;
export const HOME_CITY_LABEL_MAX = 80;

export type HomeCity = {
  timezone: string;
  label: string;
};

export const HOME_CITY_PRESETS: HomeCity[] = [
  { timezone: "America/Los_Angeles", label: "San Francisco" },
  { timezone: "America/New_York", label: "New York" },
  { timezone: "America/Toronto", label: "Toronto" },
  { timezone: "Europe/London", label: "London" },
  { timezone: "Europe/Berlin", label: "Berlin" },
  { timezone: "Asia/Tokyo", label: "Tokyo" },
  { timezone: "Australia/Sydney", label: "Sydney" },
  { timezone: "UTC", label: "UTC" },
];

export const DEMO_HOME_CITY: HomeCity = HOME_CITY_PRESETS[0];

/** The chip / heading used wherever company age is shown. */
export function formatCompanyDayLabel(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return `Day of ${trimmed || DEFAULT_COMPANY_NAME}`;
}

export function utcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export function parseFoundedAt(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function foundedAtIsFuture(foundedAt: Date, asOf: Date = new Date()): boolean {
  return utcMidnight(foundedAt).getTime() > utcMidnight(asOf).getTime();
}

export function isIanaTimeZone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function parseHomeCity(raw: string | null | undefined): HomeCity | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { timezone?: unknown; label?: unknown };
    if (typeof parsed.timezone !== "string" || typeof parsed.label !== "string") {
      return null;
    }
    const timezone = parsed.timezone.trim();
    const label = parsed.label.trim();
    if (!timezone || !label || !isIanaTimeZone(timezone)) return null;
    return { timezone, label };
  } catch {
    return null;
  }
}

export function serializeHomeCity(city: HomeCity): string {
  return JSON.stringify({ timezone: city.timezone, label: city.label });
}
