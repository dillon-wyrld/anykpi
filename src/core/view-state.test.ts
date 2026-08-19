import { afterEach, describe, expect, it, vi } from "vitest";
import { publicBaseUrl } from "./view-state";

function requestWith(
  headers: Record<string, string> = {},
  url = "http://localhost:3000/api/v1/users"
): { headers: { get(name: string): string | null }; url: string } {
  const normalized = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    url,
    headers: {
      get(name: string) {
        return normalized.get(name.toLowerCase()) ?? null;
      },
    },
  };
}

const originalPublic = process.env.PUBLIC_BASE_URL;

afterEach(() => {
  if (originalPublic === undefined) {
    delete process.env.PUBLIC_BASE_URL;
  } else {
    process.env.PUBLIC_BASE_URL = originalPublic;
  }
  delete process.env.NEXT_PUBLIC_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
  vi.unstubAllEnvs();
});

describe("publicBaseUrl", () => {
  it("derives a direct origin from Host and the request URL", () => {
    expect(
      publicBaseUrl(
        requestWith({ host: "127.0.0.1:3000" }, "http://127.0.0.1:3000/api/v1/users")
      )
    ).toBe("http://127.0.0.1:3000");
  });

  it("prefers X-Forwarded-Host / X-Forwarded-Proto when proxied", () => {
    expect(
      publicBaseUrl(
        requestWith({
          host: "10.0.0.5:3000",
          "x-forwarded-host": "kpi.example.com",
          "x-forwarded-proto": "https",
        })
      )
    ).toBe("https://kpi.example.com");
  });

  it("takes the first value from comma-separated forwarded headers", () => {
    expect(
      publicBaseUrl(
        requestWith({
          host: "10.0.0.5:3000",
          "x-forwarded-host": "kpi.example.com, internal.local",
          "x-forwarded-proto": "https, http",
        })
      )
    ).toBe("https://kpi.example.com");
  });

  it("pins the origin when PUBLIC_BASE_URL is set", () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://pinned.example.com/");
    expect(
      publicBaseUrl(
        requestWith({
          host: "ignored.example.com",
          "x-forwarded-host": "also-ignored.example.com",
          "x-forwarded-proto": "https",
        })
      )
    ).toBe("https://pinned.example.com");
  });

  it("ignores NEXT_PUBLIC_BASE_URL and NEXT_PUBLIC_API_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://build-time.example.com");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api-build.example.com");
    expect(
      publicBaseUrl(
        requestWith({
          host: "live.example.com",
          "x-forwarded-proto": "https",
        })
      )
    ).toBe("https://live.example.com");
  });

  it("falls back to localhost when no request is provided", () => {
    expect(publicBaseUrl()).toBe("http://localhost:3000");
  });
});
