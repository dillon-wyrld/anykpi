import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as createKey } from "@/app/api/v1/keys/route";
import { DELETE as deleteKey } from "@/app/api/v1/keys/[id]/route";
import { POST as postEvent } from "@/app/api/ingest/event/route";

const ADMIN = "admin-secret";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
});

function asAdmin(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("API key revocation", () => {
  it("mints a key, then revokes it (200), and unknown ids 404", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const created = await createKey(
      asAdmin("http://localhost:3000/api/v1/keys", "POST", { name: "revoke-me" })
    );
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect(id).toMatch(/^ak_/);

    const revoked = await deleteKey(
      asAdmin(`http://localhost:3000/api/v1/keys/${id}`, "DELETE"),
      { params: Promise.resolve({ id }) }
    );
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).revoked).toBe(true);

    const missing = await deleteKey(
      asAdmin("http://localhost:3000/api/v1/keys/ak_does_not_exist", "DELETE"),
      { params: Promise.resolve({ id: "ak_does_not_exist" }) }
    );
    expect(missing.status).toBe(404);
  });

  it("rejects unauthenticated revocation with 401", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const res = await deleteKey(
      new NextRequest("http://localhost:3000/api/v1/keys/ak_x", { method: "DELETE" }),
      { params: Promise.resolve({ id: "ak_x" }) }
    );
    expect(res.status).toBe(401);
  });
});

describe("ingest body-size bound", () => {
  it("rejects an oversized event body with 413", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const huge = { userId: "u", event: "e", workspaceId: "live", properties: { blob: "A".repeat(70000) } };
    const res = await postEvent(
      asAdmin("http://localhost:3000/api/ingest/event", "POST", huge)
    );
    expect(res.status).toBe(413);
  });
});
