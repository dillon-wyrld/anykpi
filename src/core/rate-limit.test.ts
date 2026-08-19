import { describe, expect, it } from "vitest";
import { rateLimit, clientKeyFrom } from "@/core/rate-limit";

describe("rateLimit", () => {
  it("allows under the limit and blocks once exceeded", () => {
    const key = `t-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3).allowed).toBe(true);
    }
    const blocked = rateLimit(key, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks client keys independently", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    expect(rateLimit(a, 1).allowed).toBe(true);
    expect(rateLimit(a, 1).allowed).toBe(false);
    expect(rateLimit(b, 1).allowed).toBe(true);
  });
});

describe("clientKeyFrom", () => {
  it("uses the first x-forwarded-for entry", () => {
    expect(clientKeyFrom(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe(
      "203.0.113.9"
    );
  });

  it("falls back to x-real-ip then a constant", () => {
    expect(clientKeyFrom(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientKeyFrom(new Headers())).toBe("local");
  });
});
