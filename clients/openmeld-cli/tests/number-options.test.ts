import { describe, expect, it } from "vitest";
import { parseNonNegativeIntegerOption } from "../src/lib/number-options";

describe("parseNonNegativeIntegerOption", () => {
  it("returns undefined when option is omitted", () => {
    expect(parseNonNegativeIntegerOption(undefined, "history-limit")).toBe(
      undefined
    );
  });

  it("accepts valid non-negative integer strings", () => {
    expect(parseNonNegativeIntegerOption("0", "history-limit")).toBe(0);
    expect(parseNonNegativeIntegerOption("10", "history-limit")).toBe(10);
    expect(parseNonNegativeIntegerOption(" 42 ", "history-limit")).toBe(42);
  });

  it("rejects values exceeding safe integer range", () => {
    expect(() =>
      parseNonNegativeIntegerOption("9999999999999999999", "history-limit")
    ).toThrow(
      `history-limit must be a non-negative integer no larger than ${Number.MAX_SAFE_INTEGER}`
    );
  });

  it("rejects values with leading zeros", () => {
    expect(() => parseNonNegativeIntegerOption("001", "history-limit")).toThrow(
      "history-limit must be a non-negative integer"
    );
  });

  it("rejects non-integer values", () => {
    expect(() => parseNonNegativeIntegerOption("1.5", "history-limit")).toThrow(
      "history-limit must be a non-negative integer"
    );
    expect(() =>
      parseNonNegativeIntegerOption("10abc", "history-limit")
    ).toThrow("history-limit must be a non-negative integer");
  });

  it("rejects negative or empty values", () => {
    expect(() => parseNonNegativeIntegerOption("-1", "history-limit")).toThrow(
      "history-limit must be a non-negative integer"
    );
    expect(() => parseNonNegativeIntegerOption("", "history-limit")).toThrow(
      "history-limit must be a non-negative integer"
    );
    expect(() => parseNonNegativeIntegerOption("   ", "history-limit")).toThrow(
      "history-limit must be a non-negative integer"
    );
  });
});
