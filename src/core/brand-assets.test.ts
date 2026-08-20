import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function read(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

function pngSize(rel: string): { width: number; height: number } {
  const buf = readFileSync(resolve(root, rel));
  expect(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
    true
  );
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("ANYKPI brand assets (ANY-51)", () => {
  const wordmarks = [
    { rel: "public/brand/wordmark-light@2x.png", width: 167, height: 38 },
    { rel: "public/brand/wordmark-light@3x.png", width: 250, height: 57 },
    { rel: "public/brand/wordmark-dark@2x.png", width: 167, height: 38 },
    { rel: "public/brand/wordmark-dark@3x.png", width: 250, height: 57 },
  ] as const;

  it("ships light and dark-ground wordmarks at 2× and 3× of the 19px nav height", () => {
    for (const file of wordmarks) {
      expect(existsSync(resolve(root, file.rel)), file.rel).toBe(true);
      expect(pngSize(file.rel)).toEqual({ width: file.width, height: file.height });
    }
  });

  it("derives a K-tile tab icon and favicon from the wordmark glyph", () => {
    expect(existsSync(resolve(root, "public/brand/icon-k.png"))).toBe(true);
    expect(existsSync(resolve(root, "public/brand/icon-32.png"))).toBe(true);
    expect(existsSync(resolve(root, "public/brand/icon.svg"))).toBe(true);
    expect(existsSync(resolve(root, "public/brand/favicon.ico"))).toBe(true);
    expect(existsSync(resolve(root, "public/brand/apple-touch-icon.png"))).toBe(true);
    expect(pngSize("public/brand/icon-k.png")).toEqual({ width: 72, height: 72 });
    expect(pngSize("public/brand/icon-32.png")).toEqual({ width: 32, height: 32 });
    expect(readFileSync(resolve(root, "public/brand/favicon.ico")).length).toBeGreaterThan(
      100
    );
    expect(read("public/brand/icon.svg")).toContain("image/png");
  });

  it("renders the wordmark + beta tag in the dashboard nav and wall masthead", () => {
    const page = read("src/app/dashboard/page.tsx");
    expect(page).toContain("/brand/wordmark-light@2x.png");
    expect(page).toContain("/brand/wordmark-dark@2x.png");
    expect(page).toContain('alt="ANYKPI"');
    expect(page).toContain('data-testid="logo-row"');
    expect(page).toContain('data-testid="beta-tag"');
    expect(page).toContain('data-testid="wall-masthead"');
    expect(page).toContain("h-[19px]");
    expect(page).toMatch(/>\s*beta\s*</);
    expect(page).not.toMatch(/ANY<span/);
    expect(page).not.toMatch(/>ANYKPI</);
  });

  it("points the document tab icon at the K-tile assets", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("/brand/icon.svg");
    expect(layout).toContain("/brand/favicon.ico");
    expect(layout).toContain("/brand/icon-32.png");
  });
});
