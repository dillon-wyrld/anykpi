/**
 * CSV parse + column mapping. Pure — safe for the /connect preview UI.
 */

export const IMPORT_KINDS = ["users", "events"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const USER_FIELDS = [
  "personId",
  "name",
  "email",
  "platform",
  "country",
  "emoji",
  "signupDate",
  "cluster",
  "accountId",
] as const;

export const EVENT_FIELDS = [
  "personId",
  "timestamp",
  "eventName",
  "eventClass",
  "platform",
  "externalId",
] as const;

export type UserField = (typeof USER_FIELDS)[number];
export type EventField = (typeof EVENT_FIELDS)[number];
export type ImportField = UserField | EventField;

export type CsvRecord = {
  /** 1-based physical line of the record start (header is line 1). */
  line: number;
  values: string[];
};

export type CsvParseOk = {
  ok: true;
  headers: string[];
  records: CsvRecord[];
};

export type CsvParseFail = {
  ok: false;
  line: number;
  message: string;
};

export type CsvParseResult = CsvParseOk | CsvParseFail;

const FIELD_ALIASES: Record<ImportField, string[]> = {
  personId: [
    "personid",
    "person_id",
    "userid",
    "user_id",
    "distinct_id",
    "distinctid",
    "user",
  ],
  name: ["name", "user_name", "username", "full_name", "fullname", "display_name"],
  email: ["email"],
  platform: ["platform"],
  country: ["country"],
  emoji: ["emoji"],
  signupDate: ["signup_date", "signupdate", "created_at", "createdat"],
  cluster: ["cluster"],
  accountId: ["account_id", "accountid", "account"],
  timestamp: ["timestamp", "time", "date", "ts", "occurred_at", "occurredat", "datetime"],
  eventName: ["event", "event_name", "eventname"],
  eventClass: ["event_class", "eventclass", "class"],
  externalId: ["external_id", "externalid", "event_id", "eventid"],
};

const USER_FIELD_SET = new Set<string>(USER_FIELDS);
const EVENT_FIELD_SET = new Set<string>(EVENT_FIELDS);

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function fieldsFor(kind: ImportKind): readonly string[] {
  return kind === "users" ? USER_FIELDS : EVENT_FIELDS;
}

export function isImportField(kind: ImportKind, field: string): boolean {
  return kind === "users" ? USER_FIELD_SET.has(field) : EVENT_FIELD_SET.has(field);
}

/**
 * RFC 4180-ish parser. Tracks physical line numbers so bad rows can be
 * reported instead of dropped.
 */
export function parseCsv(text: string): CsvParseResult {
  if (text.length === 0) {
    return { ok: false, line: 1, message: "CSV is empty" };
  }

  const records: CsvRecord[] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;
  let i = 0;
  let sawContent = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };

  const rowIsEmpty = () => row.every((value) => value.length === 0);

  const pushRow = () => {
    if (!sawContent || rowIsEmpty()) {
      row = [];
      rowStart = line;
      sawContent = false;
      return;
    }
    records.push({ line: rowStart, values: row });
    row = [];
    rowStart = line;
    sawContent = false;
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === "\n") line += 1;
      field += ch;
      sawContent = true;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushField();
      line += 1;
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    if (ch.trim().length > 0) sawContent = true;
    i += 1;
  }

  if (inQuotes) {
    return { ok: false, line: rowStart, message: "Unclosed quoted field" };
  }

  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }

  if (records.length === 0) {
    return { ok: false, line: 1, message: "CSV has no header row" };
  }

  const headers = records[0]!.values.map((header) => header.trim());
  if (headers.length === 0 || headers.every((header) => header.length === 0)) {
    return { ok: false, line: 1, message: "CSV has no header row" };
  }

  return { ok: true, headers, records: records.slice(1) };
}

function aliasLookup(kind: ImportKind): Map<string, ImportField> {
  const allowed = new Set(fieldsFor(kind));
  const map = new Map<string, ImportField>();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [
    ImportField,
    string[],
  ][]) {
    if (!allowed.has(field)) continue;
    for (const alias of aliases) {
      map.set(alias, field);
    }
    map.set(normalizeHeader(field), field);
  }
  if (kind === "users") {
    map.set("id", "personId");
  } else {
    map.set("id", "externalId");
  }
  return map;
}

/** column header → import field */
export function suggestMapping(
  headers: string[],
  kind: ImportKind
): Record<string, string> {
  const aliases = aliasLookup(kind);
  const used = new Set<string>();
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const field = aliases.get(normalizeHeader(header));
    if (!field || used.has(field)) continue;
    used.add(field);
    mapping[header] = field;
  }
  return mapping;
}

export function mappedFields(mapping: Record<string, string>): Set<string> {
  return new Set(Object.values(mapping));
}

export function detectKind(headers: string[]): ImportKind | null {
  const eventFields = mappedFields(suggestMapping(headers, "events"));
  if (eventFields.has("timestamp") && eventFields.has("eventName")) {
    return "events";
  }
  const userFields = mappedFields(suggestMapping(headers, "users"));
  if (userFields.has("personId") || userFields.has("name") || userFields.has("email")) {
    return "users";
  }
  return null;
}

export function recordObject(
  headers: string[],
  record: CsvRecord
): Record<string, string> {
  const row: Record<string, string> = {};
  for (let i = 0; i < headers.length; i += 1) {
    row[headers[i]!] = (record.values[i] ?? "").trim();
  }
  return row;
}

export function applyMapping(
  headers: string[],
  record: CsvRecord,
  mapping: Record<string, string>
): Record<string, string> {
  const raw = recordObject(headers, record);
  const out: Record<string, string> = {};
  for (const [column, field] of Object.entries(mapping)) {
    const value = raw[column];
    if (value !== undefined && value.length > 0) {
      out[field] = value;
    }
  }
  return out;
}

export type CsvImportPreview = {
  kind: ImportKind;
  columns: string[];
  mapping: Record<string, string>;
  sample: Record<string, string>[];
  rowCount: number;
};

export function previewCsv(
  headers: string[],
  records: CsvRecord[],
  kind: ImportKind,
  mapping: Record<string, string>,
  sampleSize = 5
): CsvImportPreview {
  return {
    kind,
    columns: headers,
    mapping,
    sample: records.slice(0, sampleSize).map((record) => recordObject(headers, record)),
    rowCount: records.length,
  };
}
