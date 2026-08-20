import { describe, expect, it } from "vitest";
import { isPostgresUrl, sqlEngine } from "./dialect";

describe("sqlEngine", () => {
  it("defaults to sqlite", () => {
    expect(sqlEngine({})).toBe("sqlite");
    expect(sqlEngine({ DATABASE_PATH: "./data/anykpi.db" })).toBe("sqlite");
    expect(sqlEngine({ DATABASE_URL: "file:./data/anykpi.db" })).toBe("sqlite");
  });

  it("selects postgres from DATABASE_URL", () => {
    expect(sqlEngine({ DATABASE_URL: "postgres://localhost/anykpi" })).toBe(
      "postgres"
    );
    expect(sqlEngine({ DATABASE_URL: "postgresql://host/db" })).toBe("postgres");
  });

  it("selects postgres from ANYKPI_DB_ENGINE for PGlite unit tests", () => {
    expect(sqlEngine({ ANYKPI_DB_ENGINE: "postgres" })).toBe("postgres");
    expect(sqlEngine({ ANYKPI_DB_ENGINE: "postgresql" })).toBe("postgres");
  });

  it("prefers DATABASE_URL over ANYKPI_DB_ENGINE=sqlite", () => {
    expect(
      sqlEngine({
        ANYKPI_DB_ENGINE: "sqlite",
        DATABASE_URL: "postgres://localhost/anykpi",
      })
    ).toBe("postgres");
  });
});

describe("isPostgresUrl", () => {
  it("accepts postgres and postgresql schemes", () => {
    expect(isPostgresUrl("postgres://u:p@h/db")).toBe(true);
    expect(isPostgresUrl(" POSTGRESQL://h/db ")).toBe(true);
    expect(isPostgresUrl("")).toBe(false);
    expect(isPostgresUrl(undefined)).toBe(false);
  });
});
