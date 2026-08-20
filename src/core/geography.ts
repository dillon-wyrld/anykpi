/**
 * User geography — country and IANA timezone from real sources, then city
 * rows. Precedence: explicit property > device timezone > country-derived
 * fallback. Nothing is guessed beyond that; users with no signal stay
 * unplaced and are counted.
 */

export type GeographyInput = {
  country?: string | null;
  timezone?: string | null;
  deviceTimezone?: string | null;
};

export type ResolvedGeography = {
  country: string | null;
  timezone: string | null;
};

export type PlaceableUser = {
  personId?: string;
  country?: string | null;
  timezone?: string | null;
};

export type CityRow = {
  city: string;
  country: string;
  timezone: string;
  userCount: number;
};

export type CityPlacement = {
  cities: CityRow[];
  placed: number;
  unplaced: number;
  total: number;
};

/**
 * Representative IANA zone for an ISO 3166-1 alpha-2 country. Used only
 * when no explicit or device timezone is present — not a per-user guess.
 */
export const COUNTRY_TIMEZONES: Record<string, string> = {
  US: "America/Los_Angeles",
  CA: "America/Toronto",
  MX: "America/Mexico_City",
  BR: "America/Sao_Paulo",
  AR: "America/Argentina/Buenos_Aires",
  CL: "America/Santiago",
  CO: "America/Bogota",
  PE: "America/Lima",
  GB: "Europe/London",
  IE: "Europe/Dublin",
  FR: "Europe/Paris",
  DE: "Europe/Berlin",
  NL: "Europe/Amsterdam",
  BE: "Europe/Brussels",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  PT: "Europe/Lisbon",
  CH: "Europe/Zurich",
  AT: "Europe/Vienna",
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  DK: "Europe/Copenhagen",
  FI: "Europe/Helsinki",
  PL: "Europe/Warsaw",
  CZ: "Europe/Prague",
  IN: "Asia/Kolkata",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  CN: "Asia/Shanghai",
  HK: "Asia/Hong_Kong",
  TW: "Asia/Taipei",
  SG: "Asia/Singapore",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  ZA: "Africa/Johannesburg",
  NG: "Africa/Lagos",
  KE: "Africa/Nairobi",
  IL: "Asia/Jerusalem",
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  TR: "Europe/Istanbul",
};

const COUNTRY_ALIASES: Record<string, string> = {
  USA: "US",
  UK: "GB",
  GBR: "GB",
  "UNITED STATES": "US",
  "UNITED KINGDOM": "GB",
};

const CITY_BY_TIMEZONE: Record<string, { city: string; country: string }> = {
  "America/Los_Angeles": { city: "San Francisco", country: "US" },
  "America/New_York": { city: "New York", country: "US" },
  "America/Chicago": { city: "Chicago", country: "US" },
  "America/Denver": { city: "Denver", country: "US" },
  "America/Toronto": { city: "Toronto", country: "CA" },
  "America/Vancouver": { city: "Vancouver", country: "CA" },
  "America/Sao_Paulo": { city: "São Paulo", country: "BR" },
  "America/Mexico_City": { city: "Mexico City", country: "MX" },
  "Europe/London": { city: "London", country: "GB" },
  "Europe/Paris": { city: "Paris", country: "FR" },
  "Europe/Berlin": { city: "Berlin", country: "DE" },
  "Europe/Amsterdam": { city: "Amsterdam", country: "NL" },
  "Europe/Dublin": { city: "Dublin", country: "IE" },
  "Asia/Kolkata": { city: "Bangalore", country: "IN" },
  "Asia/Calcutta": { city: "Bangalore", country: "IN" },
  "Asia/Tokyo": { city: "Tokyo", country: "JP" },
  "Asia/Seoul": { city: "Seoul", country: "KR" },
  "Asia/Shanghai": { city: "Shanghai", country: "CN" },
  "Asia/Singapore": { city: "Singapore", country: "SG" },
  "Australia/Sydney": { city: "Sydney", country: "AU" },
  "Pacific/Auckland": { city: "Auckland", country: "NZ" },
};

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isIanaTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function normalizeCountry(value: unknown): string | null {
  const raw = asText(value);
  if (!raw) return null;
  const compact = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const upper = compact.toUpperCase();
  if (COUNTRY_ALIASES[upper]) return COUNTRY_ALIASES[upper];
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return null;
}

export function normalizeTimezone(value: unknown): string | null {
  const raw = asText(value);
  if (!raw || !isIanaTimezone(raw)) return null;
  return raw;
}

export function timezoneFromCountry(country: string | null): string | null {
  if (!country) return null;
  return COUNTRY_TIMEZONES[country] ?? null;
}

function countryFromTimezone(timezone: string | null): string | null {
  if (!timezone) return null;
  const known = CITY_BY_TIMEZONE[timezone];
  if (known) return known.country;
  const prefix = timezone.split("/")[0];
  if (prefix === "America") return null;
  return null;
}

export function resolveGeography(input: GeographyInput): ResolvedGeography {
  const country = normalizeCountry(input.country);
  const explicit = normalizeTimezone(input.timezone);
  const device = normalizeTimezone(input.deviceTimezone);
  const timezone = explicit ?? device ?? timezoneFromCountry(country);
  return {
    country: country ?? countryFromTimezone(timezone),
    timezone,
  };
}

/**
 * Pull country / timezone from identify, SDK, or source person properties.
 * Explicit keys win over device / geoip keys.
 */
export function geographyFromProperties(
  properties: Record<string, unknown> | null | undefined
): ResolvedGeography {
  const props = properties ?? {};
  return resolveGeography({
    country:
      asText(props.country) ??
      asText(props.$geoip_country_code) ??
      asText(props.geoip_country_code),
    timezone: asText(props.timezone) ?? asText(props.$geoip_time_zone),
    deviceTimezone:
      asText(props.deviceTimezone) ??
      asText(props.device_timezone) ??
      asText(props.$timezone),
  });
}

function cityNameFromTimezone(timezone: string): string {
  const leaf = timezone.split("/").pop() ?? timezone;
  return leaf.replace(/_/g, " ");
}

export function cityForGeography(
  geo: ResolvedGeography
): { city: string; country: string; timezone: string } | null {
  if (!geo.timezone) return null;
  const known = CITY_BY_TIMEZONE[geo.timezone];
  if (known) {
    return {
      city: known.city,
      country: geo.country ?? known.country,
      timezone: geo.timezone,
    };
  }
  if (geo.country) {
    const fallbackTz = timezoneFromCountry(geo.country);
    const fallbackCity = fallbackTz ? CITY_BY_TIMEZONE[fallbackTz] : undefined;
    if (fallbackCity) {
      return {
        city: fallbackCity.city,
        country: geo.country,
        timezone: geo.timezone,
      };
    }
  }
  return {
    city: cityNameFromTimezone(geo.timezone),
    country: geo.country ?? "",
    timezone: geo.timezone,
  };
}

/**
 * Group users into city rows. Anyone without a resolvable timezone (and
 * therefore no city) is counted in `unplaced` — never dropped.
 */
export function placeUsers(users: PlaceableUser[]): CityPlacement {
  const buckets = new Map<string, CityRow>();
  let placed = 0;
  let unplaced = 0;

  for (const user of users) {
    const geo = resolveGeography({
      country: user.country,
      timezone: user.timezone,
    });
    const city = cityForGeography(geo);
    if (!city) {
      unplaced += 1;
      continue;
    }
    placed += 1;
    const key = `${city.country}:${city.city}:${city.timezone}`;
    const row = buckets.get(key);
    if (row) {
      row.userCount += 1;
    } else {
      buckets.set(key, { ...city, userCount: 1 });
    }
  }

  const cities = [...buckets.values()].sort((a, b) => {
    if (b.userCount !== a.userCount) return b.userCount - a.userCount;
    return a.city.localeCompare(b.city);
  });

  return {
    cities,
    placed,
    unplaced,
    total: users.length,
  };
}
