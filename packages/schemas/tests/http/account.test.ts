import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
  updateAccountDisplayNameBodySchema,
  updateAccountDisplayNameCompatibilityBodySchema,
} from "../../src/schemas/http/account";

describe("Account Display Name HTTP contract", () => {
  it("normalizes the canonical and compatibility request names", () => {
    expect(
      updateAccountDisplayNameBodySchema.parse({
        displayName: "  Felix Lu  ",
      })
    ).toEqual({ displayName: "Felix Lu" });
    expect(
      updateAccountDisplayNameCompatibilityBodySchema.parse({
        name: "  Felix Lu  ",
      })
    ).toEqual({ name: "Felix Lu" });
  });

  it("rejects empty, oversized, and generic user-field writes", () => {
    expect(
      updateAccountDisplayNameBodySchema.safeParse({ displayName: "   " })
        .success
    ).toBe(false);
    expect(
      updateAccountDisplayNameBodySchema.safeParse({
        displayName: "x".repeat(ACCOUNT_DISPLAY_NAME_MAX_LENGTH + 1),
      }).success
    ).toBe(false);
    expect(
      updateAccountDisplayNameCompatibilityBodySchema.safeParse({
        image: "https://example.com/avatar.png",
        name: "Felix Lu",
      }).success
    ).toBe(false);
  });
});
