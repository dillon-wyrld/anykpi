import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  isPostgresUrl,
  migrationsDirFor,
} from "../../scripts/docker-entrypoint.mjs";

const root = resolve(__dirname, "../..");

describe("docker entrypoint dialect selection", () => {
  it("uses drizzle/sqlite unless DATABASE_URL is a Postgres URL", () => {
    expect(isPostgresUrl(undefined)).toBe(false);
    expect(isPostgresUrl("")).toBe(false);
    expect(isPostgresUrl("file:./data/anykpi.db")).toBe(false);
    expect(migrationsDirFor({}, root)).toBe(resolve(root, "drizzle/sqlite"));
    expect(migrationsDirFor({ DATABASE_PATH: "/data/anykpi.db" }, root)).toBe(
      resolve(root, "drizzle/sqlite")
    );
  });

  it("uses drizzle/pg when DATABASE_URL is postgres:// or postgresql://", () => {
    expect(isPostgresUrl("postgres://user:pass@host/db")).toBe(true);
    expect(isPostgresUrl("postgresql://host/db")).toBe(true);
    expect(isPostgresUrl(" POSTGRESQL://host/db ")).toBe(true);
    expect(
      migrationsDirFor({ DATABASE_URL: "postgres://localhost/anykpi" }, root)
    ).toBe(resolve(root, "drizzle/pg"));
  });

  it("copies drizzle, the entrypoint, and the Postgres driver into the image", () => {
    const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/COPY --from=builder.*\/app\/drizzle \.\/drizzle/);
    expect(dockerfile).toContain("scripts/docker-entrypoint.mjs");
    expect(dockerfile).toMatch(/node_modules\/postgres/);
  });
});
