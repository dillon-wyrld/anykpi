import { describe, expect, it } from "vitest";
import { sourceLockKey, withSourceLock } from "./lock";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("withSourceLock", () => {
  it("coalesces concurrent runs for the same workspace and source", async () => {
    let runs = 0;
    const run = async () => {
      runs += 1;
      await delay(40);
      return runs;
    };

    const [a, b] = await Promise.all([
      withSourceLock("ws-a", "posthog", run),
      withSourceLock("ws-a", "posthog", run),
    ]);

    expect(runs).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it("does not coalesce different sources or workspaces", async () => {
    let runs = 0;
    const run = async () => {
      runs += 1;
      await delay(10);
      return runs;
    };

    await Promise.all([
      withSourceLock("ws-a", "posthog", run),
      withSourceLock("ws-a", "mixpanel", run),
      withSourceLock("ws-b", "posthog", run),
    ]);

    expect(runs).toBe(3);
  });

  it("allows a later trigger after the in-flight run finishes", async () => {
    let runs = 0;
    const run = async () => {
      runs += 1;
      return runs;
    };

    await withSourceLock("ws-c", "posthog", run);
    await withSourceLock("ws-c", "posthog", run);
    expect(runs).toBe(2);
  });

  it("keys the lock by workspace and source", () => {
    expect(sourceLockKey("live", "posthog")).toBe("live::posthog");
    expect(sourceLockKey("demo", "posthog")).not.toBe(
      sourceLockKey("live", "posthog")
    );
  });
});
