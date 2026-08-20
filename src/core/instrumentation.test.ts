import { afterEach, describe, expect, it, vi } from "vitest";
import { stopScheduledRefresh } from "./scheduler";

afterEach(() => {
  stopScheduledRefresh();
  vi.unstubAllEnvs();
});

describe("instrumentation register()", () => {
  it("starts on the Node runtime and is a no-op on Edge", async () => {
    vi.stubEnv("SYNC_INTERVAL_MINUTES", "15");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    delete process.env.NEXT_PHASE;

    const { register } = await import("@/instrumentation");
    await register();
    stopScheduledRefresh();

    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
  });

  it("does not start a timer during next build", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("SYNC_INTERVAL_MINUTES", "15");
    const { register } = await import("@/instrumentation");
    await register();
  });
});
