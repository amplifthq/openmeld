import { describe, expect, it } from "vitest";
import { normalizeAuthHeaderValue } from "../src/utils/auth-header-value";

describe("auth header value normalization", () => {
  it("trims non-empty values", () => {
    expect(normalizeAuthHeaderValue("  abc  ")).toBe("abc");
  });

  it("returns null for empty-like values", () => {
    expect(normalizeAuthHeaderValue("   ")).toBeNull();
    expect(normalizeAuthHeaderValue(undefined)).toBeNull();
    expect(normalizeAuthHeaderValue(null)).toBeNull();
  });
});
