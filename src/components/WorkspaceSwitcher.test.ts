import { describe, expect, it } from "vitest";
import { typedNameConfirms } from "./WorkspaceSwitcher";

describe("typed-name confirmation", () => {
  it("requires an exact match of the display name after trim", () => {
    expect(typedNameConfirms("Catalog A", "Catalog A")).toBe(true);
    expect(typedNameConfirms("  Catalog A  ", "Catalog A")).toBe(true);
    expect(typedNameConfirms("catalog a", "Catalog A")).toBe(false);
    expect(typedNameConfirms("Catalog", "Catalog A")).toBe(false);
    expect(typedNameConfirms("", "Catalog A")).toBe(false);
  });
});
