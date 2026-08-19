import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function read(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("docker compose + Railway always-on template", () => {
  const compose = read("docker-compose.yml");
  const railway = read("railway.toml");

  it("compose pulls ghcr.io/dillon-wyrld/anykpi and a named volume at /data", () => {
    expect(existsSync(resolve(root, "docker-compose.yml"))).toBe(true);
    expect(compose).toMatch(/^\s+image:\s+ghcr\.io\/dillon-wyrld\/anykpi\s*$/m);
    expect(compose).toMatch(/^\s+-\s+anykpi-data:\/data\s*$/m);
    expect(compose).toMatch(/^volumes:\s*$/m);
    expect(compose).toMatch(/^\s+anykpi-data:\s*$/m);
    expect(compose).not.toMatch(/\.\/data:\/data/);
    expect(compose).toMatch(/# build: \./);
  });

  it("compose file is structurally valid (service, image, named volume)", () => {
    expect(compose).toMatch(/^services:\s*$/m);
    expect(compose).toMatch(/^\s+anykpi:\s*$/m);
    const imageLines = [...compose.matchAll(/^\s+image:\s+(\S+)\s*$/gm)].map(
      (m) => m[1]
    );
    expect(imageLines).toEqual(["ghcr.io/dillon-wyrld/anykpi"]);
    expect(compose).toMatch(/restart:\s+unless-stopped/);
    expect(compose).toMatch(/DATABASE_PATH:\s+\/data\/anykpi\.db/);
  });

  it("Railway template pins always-on and a volume at /data", () => {
    expect(existsSync(resolve(root, "railway.toml"))).toBe(true);
    expect(railway).toMatch(/sleepApplication\s*=\s*false/);
    expect(railway).toMatch(/requiredMountPath\s*=\s*"\/data"/);
    expect(railway).toMatch(/numReplicas\s*=\s*1/);
    expect(railway).toMatch(/builder\s*=\s*"DOCKERFILE"/);
    expect(railway).not.toMatch(/sleepApplication\s*=\s*true/);
    expect(railway).not.toMatch(/startCommand\s*=/);
  });

  it("documents the auto-stop / external-cron rule without a second host", () => {
    expect(compose).toMatch(/POST \/api\/v1\/sync/);
    expect(railway).toMatch(/POST \/api\/v1\/sync/);
    expect(compose).toMatch(/Do not add a second host template/);
    expect(railway).toMatch(/Do not add a second host template/);
  });
});
