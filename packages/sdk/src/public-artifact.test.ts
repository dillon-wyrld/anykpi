import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public/sdk.js browser artifact", () => {
  it("is the generated IIFE and talks to /api/ingest", () => {
    const artifact = readFileSync(resolve(__dirname, "../../../public/sdk.js"), "utf8");
    expect(artifact).toContain("@anykpi/sdk browser IIFE");
    expect(artifact).toContain("/api/ingest/identify");
    expect(artifact).toContain("/api/ingest/batch");
  });
});
