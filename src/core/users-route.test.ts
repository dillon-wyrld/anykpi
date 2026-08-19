import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { GET as getUsers } from "@/app/api/v1/users/route";

const CLUSTER = "page-fixture";
const USER_COUNT = 1000;
const PAGE_SIZE = 100;

const originalKey = process.env.ANYKPI_API_KEY;
const originalPublic = process.env.PUBLIC_BASE_URL;

beforeAll(async () => {
  const rows = Array.from({ length: USER_COUNT }, (_, i) => ({
    personId: `page-${String(i).padStart(4, "0")}`,
    name: `User ${i}`,
    workspaceId: "demo",
    cluster: CLUSTER,
  }));

  for (let i = 0; i < rows.length; i += 50) {
    await db.insert(schema.users).values(rows.slice(i, i + 50));
  }
});

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.ANYKPI_API_KEY;
  } else {
    process.env.ANYKPI_API_KEY = originalKey;
  }
  if (originalPublic === undefined) {
    delete process.env.PUBLIC_BASE_URL;
  } else {
    process.env.PUBLIC_BASE_URL = originalPublic;
  }
  vi.unstubAllEnvs();
});

function get(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers });
}

async function listUsers(offset: number, headers?: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/v1/users");
  url.searchParams.set("workspace", "demo");
  url.searchParams.set("cluster", CLUSTER);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  const response = await getUsers(get(url.toString(), headers));
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    users: { personId: string }[];
    total: number;
    hasMore: boolean;
    nextOffset: number | null;
    view_url: string;
  }>;
}

describe("GET /api/v1/users pagination", () => {
  it("returns a real total and visits every user exactly once via cursors", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const first = await listUsers(0);
    expect(first.total).toBe(USER_COUNT);
    expect(first.users).toHaveLength(PAGE_SIZE);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(PAGE_SIZE);

    const seen = new Set<string>();
    let offset = 0;
    let pages = 0;

    while (true) {
      const page = await listUsers(offset);
      expect(page.total).toBe(USER_COUNT);
      pages += 1;

      for (const user of page.users) {
        expect(seen.has(user.personId)).toBe(false);
        seen.add(user.personId);
      }

      if (!page.hasMore) {
        expect(page.nextOffset).toBeNull();
        break;
      }

      expect(page.nextOffset).toBe(offset + page.users.length);
      offset = page.nextOffset;
    }

    expect(seen.size).toBe(USER_COUNT);
    expect(pages).toBe(USER_COUNT / PAGE_SIZE);
  });
});

describe("GET /api/v1/users view_url origin", () => {
  it("uses the proxied origin on view_url", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const body = await listUsers(0, {
      host: "10.0.0.5:3000",
      "x-forwarded-host": "kpi.example.com",
      "x-forwarded-proto": "https",
    });

    expect(body.view_url.startsWith("https://kpi.example.com/dashboard")).toBe(
      true
    );
  });

  it("pins view_url when PUBLIC_BASE_URL is set", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PUBLIC_BASE_URL", "https://pinned.example.com");

    const body = await listUsers(0, {
      host: "ignored.example.com",
      "x-forwarded-host": "also-ignored.example.com",
      "x-forwarded-proto": "https",
    });

    expect(body.view_url.startsWith("https://pinned.example.com/dashboard")).toBe(
      true
    );
  });
});
