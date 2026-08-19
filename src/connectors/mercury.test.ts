import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { loadSourceCiphertext, saveSourceConfig } from "@/core/sources";
import { sync } from "./index";
import {
  cashBalance,
  countsTowardBurn,
  runwayMonths,
  summarizeBalance,
  trailingMonthlyBurn,
  type MercuryAccount,
  type MercuryTransaction,
} from "./mercury";
import { fixtureDir, loadFixtureSuite } from "./testing";
import { clearWorkspace, restoreEnv, withOfflineSuite } from "./testing/offline";

const WS = "contract-mercury";
const TOKEN = "secret-token:mercury_test_fixture";

const originalKey = process.env.MERCURY_API_KEY;
const originalSecret = process.env.ANYKPI_SECRET;

afterEach(async () => {
  restoreEnv("MERCURY_API_KEY", originalKey);
  restoreEnv("ANYKPI_SECRET", originalSecret);
  await clearWorkspace(WS);
});

async function storeCredentials() {
  delete process.env.MERCURY_API_KEY;
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  await saveSourceConfig(WS, "mercury", { apiKey: TOKEN });
}

function happyFixtureData() {
  const suite = loadFixtureSuite(fixtureDir("mercury", "happy"));
  const accounts = (suite.fixtures[0]?.response.body as { accounts: MercuryAccount[] })
    .accounts;
  const transactions = (
    suite.fixtures[1]?.response.body as { transactions: MercuryTransaction[] }
  ).transactions;
  return { accounts, transactions };
}

describe("Mercury runway math", () => {
  it("computes trailing monthly burn and runway months from fixtures", () => {
    const { accounts, transactions } = happyFixtureData();

    expect(cashBalance(accounts)).toBe(186000);
    expect(transactions.filter(countsTowardBurn).map((tx) => tx.amount)).toEqual([
      -31000, -31000, -31000,
    ]);

    const burn = trailingMonthlyBurn(transactions);
    expect(burn).toBe(31000);
    expect(runwayMonths(186000, burn)).toBe(6);

    const summary = summarizeBalance(accounts, transactions, new Date("2026-08-19T12:00:00Z"));
    expect(summary.cashBalance).toBe(186000);
    expect(summary.monthlyBurn).toBe(31000);
    expect(summary.runwayMonths).toBe(6);
    expect(summary.asOf.toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });

  it("ignores internal transfers, pending outflows, and credit balances", () => {
    expect(
      trailingMonthlyBurn([
        { amount: -90000, status: "sent", kind: "outgoingPayment" },
        { amount: -10000, status: "sent", kind: "internalTransfer" },
        { amount: -99999, status: "pending", kind: "outgoingPayment" },
      ])
    ).toBe(30000);
    expect(runwayMonths(186000, 0)).toBe(0);
    expect(
      cashBalance([
        { id: "a", status: "active", type: "mercury", kind: "checking", currentBalance: 100 },
        { id: "b", status: "active", type: "mercury", kind: "credit", currentBalance: -50 },
      ])
    ).toBe(100);
  });
});

describe("Mercury connector contract", () => {
  it("stores the token via the sources store and writes the runway read model", async () => {
    await storeCredentials();
    const ciphertext = await loadSourceCiphertext(WS, "mercury");
    expect(ciphertext).toBeTruthy();
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain(TOKEN);

    await withOfflineSuite("mercury", ["mercury", "happy"], async (harness) => {
      const result = await sync("mercury", WS);

      expect(result).toEqual({
        rowsSynced: 1,
        nextCursor: null,
        health: "ok",
      });

      expect(harness.calls).toHaveLength(2);
      expect(harness.calls[0]?.url).toMatch(/\/api\/v1\/accounts\?limit=1000$/);
      expect(harness.calls[1]?.url).toContain(
        "/account/11111111-1111-1111-1111-111111111111/transactions"
      );
      expect(harness.calls[1]?.url).toContain("status=sent");

      const snapshots = await db
        .select()
        .from(schema.balanceSnapshots)
        .where(eq(schema.balanceSnapshots.workspaceId, WS))
        .all();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.cashBalance).toBe(186000);
      expect(snapshots[0]?.monthlyBurn).toBe(31000);
      expect(snapshots[0]?.runwayMonths).toBe(6);
      expect(snapshots[0]?.source).toBe("mercury");
    });
  });

  it("returns health error on 401 and does not write snapshots", async () => {
    await storeCredentials();

    await withOfflineSuite("mercury", ["mercury", "unauthorized"], async () => {
      const result = await sync("mercury", WS);
      expect(result).toEqual({
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "unauthorized",
      });
    });

    const snapshots = await db
      .select()
      .from(schema.balanceSnapshots)
      .where(eq(schema.balanceSnapshots.workspaceId, WS))
      .all();
    expect(snapshots).toHaveLength(0);
  });

  it("returns health error on rate-limit and does not advance the cursor", async () => {
    await storeCredentials();

    await withOfflineSuite("mercury", ["mercury", "rate-limit"], async () => {
      const result = await sync("mercury", WS);
      expect(result).toEqual({
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "rate limited",
      });
    });
  });

  it("never logs the API token", async () => {
    await storeCredentials();
    const lines: string[] = [];
    const push = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    const log = vi.spyOn(console, "log").mockImplementation(push);
    const error = vi.spyOn(console, "error").mockImplementation(push);

    await withOfflineSuite("mercury", ["mercury", "happy"], async () => {
      await sync("mercury", WS);
    });

    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(readFileSync(resolve(__dirname, "mercury.ts"), "utf8")).not.toMatch(
      /console\.(log|error|info|warn)/
    );
    log.mockRestore();
    error.mockRestore();
  });
});
