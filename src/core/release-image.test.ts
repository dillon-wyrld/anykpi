import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const yml = readFileSync(
  resolve(__dirname, "../../.github/workflows/release.yml"),
  "utf8"
);

describe("v* GHCR image release", () => {
  it("pushes linux/amd64 and linux/arm64 to ghcr.io/dillon-wyrld/anykpi", () => {
    expect(yml).toContain("ghcr.io/dillon-wyrld/anykpi");
    expect(yml).toContain("linux/amd64");
    expect(yml).toContain("linux/arm64");
    expect(yml).toMatch(/type=raw,value=latest/);
  });

  it("authenticates to GHCR with the built-in GITHUB_TOKEN", () => {
    expect(yml).toContain("packages: write");
    expect(yml).toContain("secrets.GITHUB_TOKEN");
    expect(yml).not.toMatch(/GHCR_TOKEN|GHCR_PASSWORD|DOCKER_PASSWORD/);
  });

  it("still publishes @anykpi/cli and skips cleanly without NPM_TOKEN", () => {
    expect(yml).toContain("@anykpi/cli");
    expect(yml).toContain("pnpm --filter @anykpi/cli publish");
    expect(yml).toContain("NPM_TOKEN is not set. Skipping npm publish.");
  });

  it("publishes @anykpi/sdk on v* tags and skips cleanly without NPM_TOKEN", () => {
    expect(yml).toContain("@anykpi/sdk");
    expect(yml).toContain("pnpm --filter @anykpi/sdk build");
    expect(yml).toContain("pnpm --filter @anykpi/sdk pack");
    expect(yml).toContain("pnpm --filter @anykpi/sdk publish");
    expect(yml).toContain("NPM_TOKEN is not set. Skipping npm publish.");
  });
});
