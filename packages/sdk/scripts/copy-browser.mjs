import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../dist/browser.global.js");
const dest = resolve(here, "../../../public/sdk.js");

if (!existsSync(src)) {
  throw new Error(`SDK browser bundle missing at ${src}`);
}

mkdirSync(dirname(dest), { recursive: true });
const bundle = readFileSync(src, "utf8").replace(/\n\/\/# sourceMappingURL=.*\n?$/, "\n");
writeFileSync(dest, bundle);
