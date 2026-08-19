import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: false,
    target: "es2020",
  },
  {
    entry: { browser: "src/browser.ts" },
    format: ["iife"],
    globalName: "AnykpiSDK",
    platform: "browser",
    minify: true,
    sourcemap: true,
    target: "es2018",
    outExtension: () => ({ js: ".global.js" }),
    banner: {
      js: "/* @anykpi/sdk browser IIFE — generated from packages/sdk, do not edit */",
    },
  },
]);
