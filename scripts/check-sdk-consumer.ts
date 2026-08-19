/**
 * Packs @anykpi/sdk and typechecks a consumer that only sees published types.
 */
import { execSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packDir = mkdtempSync(join(tmpdir(), "anykpi-sdk-pack-"));
const consumerDir = mkdtempSync(join(tmpdir(), "anykpi-sdk-consumer-"));

try {
  execSync("pnpm --filter @anykpi/sdk build", { cwd: root, stdio: "inherit" });
  execSync(`pnpm --filter @anykpi/sdk pack --pack-destination ${packDir}`, {
    cwd: root,
    stdio: "inherit",
  });

  const tarball = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("pnpm pack did not produce a tarball");
  }

  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify({ name: "anykpi-sdk-consumer", private: true, type: "module" })
  );
  writeFileSync(
    join(consumerDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          module: "ES2022",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          esModuleInterop: true,
        },
        include: ["consumer.ts"],
      },
      null,
      2
    )
  );
  copyFileSync(join(root, "tests/sdk-consumer/consumer.ts"), join(consumerDir, "consumer.ts"));

  execSync(`npm install --offline --no-fund --no-audit ${join(packDir, tarball)}`, {
    cwd: consumerDir,
    stdio: "inherit",
  });

  const tsc = join(root, "node_modules/.bin/tsc");
  execSync(`${tsc} --noEmit -p tsconfig.json`, { cwd: consumerDir, stdio: "inherit" });
} finally {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(consumerDir, { recursive: true, force: true });
}
