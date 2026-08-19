import { afterEach, describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "./source-crypto";

const originalSecret = process.env.ANYKPI_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.ANYKPI_SECRET;
  else process.env.ANYKPI_SECRET = originalSecret;
});

describe("source-crypto", () => {
  it("round-trips JSON and produces non-plaintext ciphertext", () => {
    process.env.ANYKPI_SECRET = "unit-secret";
    const value = { apiKey: "phc_plain_never_at_rest", projectId: "proj_1" };
    const blob = encryptJson(value);

    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain("phc_plain_never_at_rest");
    expect(blob).not.toContain("apiKey");
    expect(blob).not.toContain("{");
    expect(decryptJson(blob)).toEqual(value);
  });

  it("refuses to encrypt without ANYKPI_SECRET", () => {
    delete process.env.ANYKPI_SECRET;
    expect(() => encryptJson({ apiKey: "x" })).toThrow(/ANYKPI_SECRET/);
  });
});
