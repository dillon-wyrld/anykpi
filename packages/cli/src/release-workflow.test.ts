import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("v* release workflow", () => {
  const yml = readFileSync(
    resolve(process.cwd(), ".github/workflows/release.yml"),
    "utf8"
  );

  it("publishes @anykpi/cli on v* tags", () => {
    expect(yml).toMatch(/tags:\s*\n\s*-\s*"v\*"/);
    expect(yml).toContain("@anykpi/cli");
    expect(yml).toContain("pnpm --filter @anykpi/cli publish");
  });

  it("builds and packs even when NPM_TOKEN is missing", () => {
    expect(yml).toContain("pnpm --filter @anykpi/cli build");
    expect(yml).toContain("pnpm --filter @anykpi/cli pack");
    expect(yml).toContain("NPM_TOKEN is not set. Skipping npm publish.");
    expect(yml).toContain("Claim the anykpi npm org");
  });
});
