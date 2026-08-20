import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

describe("CI matrix runs the suite on both engines", () => {
  const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");

  it("matrices sqlite and postgres on every push", () => {
    expect(ci).toMatch(/strategy:/);
    expect(ci).toMatch(/engine:\s*\[sqlite,\s*postgres\]/);
    expect(ci).toMatch(/ANYKPI_DB_ENGINE:\s*\$\{\{\s*matrix\.engine\s*\}\}/);
    expect(ci).toMatch(/pnpm test:unit/);
    expect(ci).toMatch(/pnpm test:e2e/);
  });

  it("gives each engine its own test-results artifact", () => {
    expect(ci).toMatch(/name:\s*test-results-\$\{\{\s*matrix\.engine\s*\}\}/);
  });
});
