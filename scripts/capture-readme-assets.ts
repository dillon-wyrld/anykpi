#!/usr/bin/env tsx
/**
 * Recapture README stills and a five-view tour GIF from the seeded demo workspace.
 *
 * Usage: pnpm readme:assets
 *
 * Seeds `workspace=demo` (via `pnpm db:init`), starts `pnpm dev` if nothing is
 * listening on BASE_URL (default http://localhost:3000), then captures:
 *   docs/assets/dotplot.png
 *   docs/assets/cohorts.png
 *   docs/assets/wbr.png
 *   docs/assets/calendar.png
 *   docs/assets/pmf.png
 *   docs/assets/tour.gif
 *
 * The GIF is encoded with ffmpeg from a Playwright video of the five-view tour.
 * If video recording fails, ffmpeg stitches the five stills into a slideshow.
 */

import { spawn, spawnSync, type ChildProcess } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { chromium, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ASSETS_DIR = resolve(process.cwd(), "docs/assets");
const VIEWPORT = { width: 1440, height: 900 } as const;
const HOLD_MS = 1600;

const VIEWS = [
  { id: "dotplot", label: "Dot Plot", ready: 'svg[role="img"]' },
  { id: "cohorts", label: "Cohorts", ready: 'h2:has-text("Cohort retention")' },
  { id: "wbr", label: "WBR", ready: 'h2:has-text("Weekly Business Review")' },
  { id: "calendar", label: "Calendar", ready: 'h2:has-text("Calendar")' },
  { id: "pmf", label: "PMF+", ready: 'h2:has-text("PMF+")' },
] as const;

type View = (typeof VIEWS)[number];

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function isServerUp(): Promise<boolean> {
  try {
    const response = await fetch(BASE_URL, { redirect: "manual" });
    return response.ok || (response.status >= 300 && response.status < 500);
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 120_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isServerUp()) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${BASE_URL}`);
}

function seedDemo(): void {
  console.log("Seeding demo workspace (pnpm db:init)...");
  const result = spawnSync("pnpm", ["db:init"], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error("pnpm db:init failed");
  }
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await isServerUp()) {
    console.log(`Using existing server at ${BASE_URL}`);
    return null;
  }

  console.log("Starting pnpm dev...");
  const child = spawn("pnpm", ["dev"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error(`dev server exited (${code}${signal ? `/${signal}` : ""})`);
    }
  });
  await waitForServer();
  return child;
}

async function waitForView(page: Page, view: View): Promise<void> {
  await page.waitForURL(new RegExp(`view=${view.id}`), { timeout: 30_000 });
  await page.waitForSelector(view.ready, { timeout: 30_000 });
  await page.locator("text=Loading...").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {
    // Some views never render the loading node after navigation.
  });
  await page.evaluate(() => document.fonts.ready);
  await sleep(250);
}

function viewUrl(view: View): string {
  return `${BASE_URL}/dashboard?workspace=demo&view=${view.id}`;
}

async function captureStills(page: Page): Promise<string[]> {
  const paths: string[] = [];
  for (const view of VIEWS) {
    const dest = join(ASSETS_DIR, `${view.id}.png`);
    console.log(`Capturing ${view.label} → ${dest}`);
    await page.goto(viewUrl(view), { waitUntil: "load" });
    await waitForView(page, view);
    await page.screenshot({ path: dest, fullPage: false, type: "png" });
    paths.push(dest);
  }
  return paths;
}

async function captureTourVideo(page: Page): Promise<void> {
  const first = VIEWS[0];
  await page.goto(viewUrl(first), { waitUntil: "load" });
  await waitForView(page, first);
  await sleep(HOLD_MS);

  for (const view of VIEWS.slice(1)) {
    await page.getByRole("link", { name: view.label, exact: true }).click();
    await page.waitForURL(new RegExp(`view=${view.id}`));
    await waitForView(page, view);
    await sleep(HOLD_MS);
  }

  await page.close();
}

function findFfmpeg(): string | null {
  const result = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return result.status === 0 ? "ffmpeg" : null;
}

function encodeGifFromVideo(webmPath: string, gifPath: string): boolean {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return false;

  const args = [
    "-y",
    "-ss",
    "1.25",
    "-i",
    webmPath,
    "-vf",
    "fps=8,scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
    "-loop",
    "0",
    gifPath,
  ];
  const result = spawnSync(ffmpeg, args, { stdio: "inherit" });
  return result.status === 0 && existsSync(gifPath);
}

function encodeGifFromStills(stills: string[], gifPath: string): boolean {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return false;

  const listPath = join(mkdtempSync(join(tmpdir(), "anykpi-gif-")), "stills.txt");
  const list = stills
    .map((still) => `file '${still.replace(/'/g, "'\\''")}'\nduration 1.8`)
    .join("\n");
  // concat demuxer needs the last file repeated without a duration
  writeFileSync(listPath, `${list}\nfile '${stills[stills.length - 1]}'\n`);

  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-vf",
    "fps=8,scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
    "-loop",
    "0",
    gifPath,
  ];
  const result = spawnSync(ffmpeg, args, { stdio: "inherit" });
  return result.status === 0 && existsSync(gifPath);
}

function writePlaceholderNote(gifPath: string): void {
  const notePath = join(ASSETS_DIR, "PLACEHOLDER.md");
  writeFileSync(
    notePath,
    [
      "# Capture incomplete",
      "",
      `\`${gifPath}\` could not be generated in this environment (missing ffmpeg or video).`,
      "",
      "Re-run on a machine that can boot the seeded demo:",
      "",
      "```bash",
      "pnpm db:init",
      "pnpm exec playwright install chromium",
      "pnpm readme:assets",
      "```",
      "",
    ].join("\n")
  );
  console.warn(`Wrote ${notePath} — GIF capture failed.`);
}

async function main(): Promise<void> {
  mkdirSync(ASSETS_DIR, { recursive: true });
  seedDemo();

  const server = await ensureServer();
  const videoDir = mkdtempSync(join(tmpdir(), "anykpi-readme-"));
  const gifPath = join(ASSETS_DIR, "tour.gif");
  let stills: string[] = [];
  let videoPath: string | null = null;

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
        recordVideo: { dir: videoDir, size: VIEWPORT },
      });

      const stillPage = await context.newPage();
      stills = await captureStills(stillPage);
      await stillPage.close();

      const tourPage = await context.newPage();
      const video = tourPage.video();
      await captureTourVideo(tourPage);
      await context.close();
      if (video) {
        videoPath = await video.path();
      }
    } finally {
      await browser.close();
    }

    let gifOk = false;
    if (videoPath && existsSync(videoPath)) {
      console.log(`Encoding tour GIF from ${videoPath}`);
      gifOk = encodeGifFromVideo(videoPath, gifPath);
    }
    if (!gifOk && stills.length === VIEWS.length) {
      console.log("Falling back to stills slideshow GIF");
      gifOk = encodeGifFromStills(stills, gifPath);
    }

    if (gifOk) {
      console.log(`Wrote ${gifPath}`);
      const placeholder = join(ASSETS_DIR, "PLACEHOLDER.md");
      if (existsSync(placeholder)) rmSync(placeholder);
    } else {
      writePlaceholderNote(gifPath);
    }

    console.log("README assets captured.");
  } finally {
    rmSync(videoDir, { recursive: true, force: true });
    if (server) {
      server.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
