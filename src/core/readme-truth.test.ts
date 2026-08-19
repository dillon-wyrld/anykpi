import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function read(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("out-of-the-box docs tell the truth", () => {
  const readme = read("README.md");
  const envExample = read(".env.example");
  const gitattributes = read(".gitattributes");

  it("excludes spec/ from GitHub language statistics", () => {
    expect(gitattributes).toMatch(/spec\/\*\*\s+linguist-documentation/);
  });

  it("README shows the captured demo screenshot and five-view GIF", () => {
    expect(readme).toContain("docs/assets/dotplot.png");
    expect(readme).toContain("docs/assets/tour.gif");
    expect(readme).toContain("pnpm readme:assets");
    expect(existsSync(resolve(root, "docs/assets/dotplot.png"))).toBe(true);
    expect(existsSync(resolve(root, "docs/assets/tour.gif"))).toBe(true);
  });

  it("README documents the prebuilt GHCR image", () => {
    expect(readme).toContain("ghcr.io/dillon-wyrld/anykpi");
    expect(readme).toContain("docker run -p 3000:3000");
    expect(readme).toContain("-v anykpi-data:/data");
  });

  it("README hosted-version copy points at the quickstart and Discussions", () => {
    expect(readme).not.toMatch(/anykpi\.com/);
    expect(readme).not.toMatch(/ANYTIME KPI/);
    expect(readme).not.toMatch(/Midday|T3 Stack/);
    expect(readme).toContain("[self-host quickstart](#install)");
    expect(readme).toContain(
      "https://github.com/dillon-wyrld/anykpi/discussions"
    );
  });

  it("README links are in-repo or known live pages", () => {
    const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);
    const allowedPrefix = /^(https:\/\/(img\.shields\.io|github\.com\/dillon-wyrld\/anykpi|opensource\.org)|#|docs\/|SECURITY\.md)/;
    for (const href of links) {
      expect(href, href).toMatch(allowedPrefix);
    }
  });

  it("names only shipped connectors as shipped", () => {
    expect(readme).toMatch(/Shipped: PostHog, Mixpanel, Amplitude/);
    expect(readme).toMatch(/Roadmap: Stripe, calendar\/ICS, GitHub/);
    expect(readme).toContain("src/connectors/");
  });

  it("describes SQLite via DATABASE_PATH and agrees with .env.example", () => {
    expect(readme).toContain("DATABASE_PATH");
    expect(readme).not.toMatch(/Postgres via DATABASE_URL/);
    expect(envExample).toContain("DATABASE_PATH");
    expect(envExample).not.toMatch(/^\s*DATABASE_URL=/m);
    expect(envExample).toContain("docs/introduction.md#postgres-later");
  });
});
