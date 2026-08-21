import { describe, expect, it, vi } from "vitest";
import {
  BLOCKED_OPERATOR_FETCH,
  OPERATOR_FETCH_RESIDUAL,
  assertOperatorFetchUrl,
  hostnameLooksLikeMetadata,
  isLinkLocalOrMetadataAddress,
  operatorFetch,
  operatorFetchUrlAllowed,
} from "./operator-fetch";

describe("operator-fetch — metadata and link-local", () => {
  it("blocks cloud-metadata and link-local literals", () => {
    expect(isLinkLocalOrMetadataAddress("169.254.169.254")).toBe(true);
    expect(isLinkLocalOrMetadataAddress("169.254.170.2")).toBe(true);
    expect(isLinkLocalOrMetadataAddress("169.254.0.1")).toBe(true);
    expect(isLinkLocalOrMetadataAddress("100.100.100.200")).toBe(true);
    expect(isLinkLocalOrMetadataAddress("fd00:ec2::254")).toBe(true);
    expect(isLinkLocalOrMetadataAddress("[fd00:ec2::254]")).toBe(true);
    expect(isLinkLocalOrMetadataAddress("fe80::1")).toBe(true);
    expect(isLinkLocalOrMetadataAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isLinkLocalOrMetadataAddress("2852039166")).toBe(true);
    expect(hostnameLooksLikeMetadata("metadata.google.internal")).toBe(true);
    expect(hostnameLooksLikeMetadata("metadata")).toBe(true);
    expect(hostnameLooksLikeMetadata("169.254.169.254")).toBe(true);
  });

  it("allows self-hosted and RFC1918 operator hosts", () => {
    expect(isLinkLocalOrMetadataAddress("10.0.0.5")).toBe(false);
    expect(isLinkLocalOrMetadataAddress("192.168.1.10")).toBe(false);
    expect(isLinkLocalOrMetadataAddress("172.16.0.2")).toBe(false);
    expect(isLinkLocalOrMetadataAddress("127.0.0.1")).toBe(false);
    expect(hostnameLooksLikeMetadata("app.posthog.com")).toBe(false);
    expect(hostnameLooksLikeMetadata("localhost")).toBe(false);
    expect(operatorFetchUrlAllowed("https://app.posthog.com/api")).toBe(true);
    expect(operatorFetchUrlAllowed("http://10.0.0.5:8000/persons")).toBe(true);
    expect(operatorFetchUrlAllowed("http://127.0.0.1:8000")).toBe(true);
    expect(operatorFetchUrlAllowed("http://192.168.1.10/cal.ics")).toBe(true);
    expect(operatorFetchUrlAllowed("http://169.254.169.254/latest/meta-data")).toBe(
      false
    );
    expect(operatorFetchUrlAllowed("http://metadata.google.internal/")).toBe(false);
    expect(operatorFetchUrlAllowed("ftp://10.0.0.5/cal.ics")).toBe(false);
    expect(OPERATOR_FETCH_RESIDUAL).toMatch(/RFC1918/);
  });

  it("resolves a hostname that points at metadata and refuses it", async () => {
    await expect(
      assertOperatorFetchUrl("https://evil.test/next", async () => ["169.254.169.254"])
    ).rejects.toThrow(BLOCKED_OPERATOR_FETCH);

    await expect(
      assertOperatorFetchUrl("https://ph.internal/api", async () => ["10.0.0.8"])
    ).resolves.toMatchObject({ hostname: "ph.internal" });
  });

  it("does not follow an HTTP redirect onto a metadata host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        })
      );

    await expect(
      operatorFetch("https://cal.example.test/calendar.ics", { method: "GET" }, {
        fetch: fetchMock as unknown as typeof fetch,
        lookup: async () => ["203.0.113.10"],
      })
    ).rejects.toThrow(BLOCKED_OPERATOR_FETCH);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://cal.example.test/calendar.ics"
    );
  });

  it("does not follow a relative redirect that lands on metadata via DNS", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "https://metadata.google.internal/" },
        })
      );

    await expect(
      operatorFetch("https://app.posthog.com/api/projects/1/persons/", undefined, {
        fetch: fetchMock as unknown as typeof fetch,
        lookup: async () => ["203.0.113.9"],
      })
    ).rejects.toThrow(BLOCKED_OPERATOR_FETCH);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not stall fetch when DNS is slow; still blocks a metadata answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const slow = new Promise<string[]>((resolve) => {
      setTimeout(() => resolve(["203.0.113.10"]), 2_000);
    });

    const response = await operatorFetch(
      "https://cal.example.test/calendar.ics",
      { method: "GET" },
      {
        fetch: fetchMock as unknown as typeof fetch,
        lookup: async () => slow,
      }
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect that stays on an allowed host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/calendar.ics" },
        })
      )
      .mockResolvedValueOnce(new Response("BEGIN:VCALENDAR", { status: 200 }));

    const response = await operatorFetch(
      "https://cal.example.test/go",
      { method: "GET" },
      {
        fetch: fetchMock as unknown as typeof fetch,
        lookup: async () => ["203.0.113.10"],
      }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("BEGIN:VCALENDAR");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://cal.example.test/calendar.ics"
    );
  });
});
