import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./schema";
import { parseCsv, suggestMapping } from "./csv-parse";
import {
  csvSourceConfig,
  eventExternalId,
  parseCsvSourceConfig,
  runCsvImport,
} from "./csv-import";

const fixtures = resolve(__dirname, "../../tests/fixtures/import");
const WS = "csv-import";

function fixture(name: string): string {
  return readFileSync(resolve(fixtures, name), "utf8");
}

afterEach(async () => {
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
});

describe("CSV parse and mapping", () => {
  it("keeps quoted commas and reports unclosed quotes with a line number", () => {
    const ok = parseCsv('name,note\n"Ada, Countess",ok\n');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.records[0]?.values).toEqual(["Ada, Countess", "ok"]);
    }

    const bad = parseCsv('name,note\n"unclosed,row\n');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.line).toBe(2);
      expect(bad.message).toMatch(/unclosed/i);
    }
  });

  it("maps country and timezone aliases on users files", () => {
    expect(
      suggestMapping(["user_id", "country", "time_zone"], "users")
    ).toEqual({
      user_id: "personId",
      country: "country",
      time_zone: "timezone",
    });
  });

  it("maps common event aliases", () => {
    expect(
      suggestMapping(["user_id", "ts", "event", "id"], "events")
    ).toEqual({
      user_id: "personId",
      ts: "timestamp",
      event: "eventName",
      id: "externalId",
    });
  });
});

describe("CSV sources-store config", () => {
  it("round-trips kind and mapping", () => {
    const mapping = { user_id: "personId", event: "eventName" };
    const stored = csvSourceConfig("events", mapping);
    expect(stored.kind).toBe("events");
    expect(parseCsvSourceConfig(stored)).toEqual({ kind: "events", mapping });
  });
});

describe("activity.externalId unique (workspaceId, externalId)", () => {
  it("rejects a second insert of the same workspace and externalId", async () => {
    const row = {
      personId: "person_dup",
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      eventName: "song_played",
      eventClass: "core" as const,
      platform: "web",
      externalId: "evt_unique_key",
      workspaceId: WS,
    };

    await db.insert(schema.activity).values(row);

    await expect(db.insert(schema.activity).values({ ...row, personId: "other" })).rejects.toThrow(
      /UNIQUE/i
    );

    const rows = await db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, WS))
      .all();
    expect(rows).toHaveLength(1);
  });
});

describe("runCsvImport", () => {
  it("imports users and events, then re-runs the same file with zero duplicates", async () => {
    const users = await runCsvImport({
      csv: fixture("users.csv"),
      kind: "users",
      workspaceId: WS,
    });
    expect(users.status).toBe("ok");
    if (users.status === "ok") {
      expect(users.result.imported).toBe(2);
      expect(users.result.skipped).toBe(0);
    }

    const events = await runCsvImport({
      csv: fixture("events.csv"),
      kind: "events",
      workspaceId: WS,
    });
    expect(events.status).toBe("ok");
    if (events.status === "ok") {
      expect(events.result.imported).toBe(3);
      expect(events.result.skipped).toBe(0);
    }

    const againUsers = await runCsvImport({
      csv: fixture("users.csv"),
      kind: "users",
      workspaceId: WS,
    });
    expect(againUsers.status).toBe("ok");
    if (againUsers.status === "ok") {
      expect(againUsers.result.imported).toBe(0);
      expect(againUsers.result.skipped).toBe(2);
    }

    const againEvents = await runCsvImport({
      csv: fixture("events.csv"),
      kind: "events",
      workspaceId: WS,
    });
    expect(againEvents.status).toBe("ok");
    if (againEvents.status === "ok") {
      expect(againEvents.result.imported).toBe(0);
      expect(againEvents.result.skipped).toBe(3);
    }

    const activity = await db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, WS))
      .all();
    expect(activity).toHaveLength(3);
    expect(new Set(activity.map((row) => row.externalId)).size).toBe(3);

    const people = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workspaceId, WS))
      .all();
    expect(people).toHaveLength(2);
  });

  it("reports corrupt rows with line numbers and writes nothing", async () => {
    const outcome = await runCsvImport({
      csv: fixture("corrupt-events.csv"),
      kind: "events",
      workspaceId: WS,
    });

    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") {
      expect(outcome.errors).toEqual([
        { line: 3, message: "invalid timestamp" },
      ]);
    }

    const activity = await db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, WS))
      .all();
    expect(activity).toHaveLength(0);

    const people = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workspaceId, WS))
      .all();
    expect(people).toHaveLength(0);
  });

  it("imports 10k event rows in one transaction in under 30 seconds", async () => {
    const header = "person_id,timestamp,event_name,external_id";
    const lines = [header];
    for (let i = 0; i < 10_000; i += 1) {
      const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
      lines.push(`user_${i % 100},${ts},song_played,evt_10k_${i}`);
    }
    const csv = `${lines.join("\n")}\n`;

    const started = Date.now();
    const outcome = await runCsvImport({
      csv,
      kind: "events",
      workspaceId: WS,
    });
    const elapsed = Date.now() - started;

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result.imported).toBe(10_000);
      expect(outcome.result.skipped).toBe(0);
    }
    expect(elapsed).toBeLessThan(30_000);

    const replay = await runCsvImport({
      csv,
      kind: "events",
      workspaceId: WS,
    });
    expect(replay.status).toBe("ok");
    if (replay.status === "ok") {
      expect(replay.result.imported).toBe(0);
      expect(replay.result.skipped).toBe(10_000);
    }

    const activity = await db
      .select({ externalId: schema.activity.externalId })
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, WS))
      .all();
    expect(activity).toHaveLength(10_000);
  });

  it("maps country and timezone and updates both on re-import", async () => {
    const csv =
      "person_id,name,country,tz\n" +
      "geo_ada,Ada,US,America/New_York\n" +
      "geo_grace,Grace,GB,Europe/London\n";
    const mapping = {
      person_id: "personId",
      name: "name",
      country: "country",
      tz: "timezone",
    };

    const first = await runCsvImport({
      csv,
      kind: "users",
      mapping,
      workspaceId: WS,
    });
    expect(first.status).toBe("ok");
    if (first.status === "ok") {
      expect(first.result.imported).toBe(2);
    }

    const people = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workspaceId, WS))
      .all();
    const byId = Object.fromEntries(people.map((row) => [row.personId, row]));
    expect(byId.geo_ada?.country).toBe("US");
    expect(byId.geo_ada?.timezone).toBe("America/New_York");
    expect(byId.geo_grace?.country).toBe("GB");
    expect(byId.geo_grace?.timezone).toBe("Europe/London");

    const updated =
      "person_id,name,country,tz\n" +
      "geo_ada,Ada Lovelace,CA,America/Toronto\n" +
      "geo_grace,Grace Hopper,GB,Europe/London\n";
    const again = await runCsvImport({
      csv: updated,
      kind: "users",
      mapping,
      workspaceId: WS,
    });
    expect(again.status).toBe("ok");
    if (again.status === "ok") {
      expect(again.result.imported).toBe(0);
      expect(again.result.skipped).toBe(2);
    }

    const after = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workspaceId, WS))
      .all();
    const updatedById = Object.fromEntries(after.map((row) => [row.personId, row]));
    expect(updatedById.geo_ada?.name).toBe("Ada Lovelace");
    expect(updatedById.geo_ada?.country).toBe("CA");
    expect(updatedById.geo_ada?.timezone).toBe("America/Toronto");
    expect(after).toHaveLength(2);
  });

  it("derives a stable externalId when the file has none", () => {
    const timestamp = new Date("2026-02-01T12:00:00.000Z");
    const first = eventExternalId({
      personId: "u1",
      timestamp,
      eventName: "played",
      platform: "web",
    });
    const second = eventExternalId({
      personId: "u1",
      timestamp,
      eventName: "played",
      platform: "web",
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
