import { describe, expect, it } from "vitest";
import { isProfileKindAllowedInView } from "../src/runtime/view-profile-guard";

describe("view/profile kind guard", () => {
  it("allows all profile kinds in human view", () => {
    expect(
      isProfileKindAllowedInView({
        resolvedView: "human",
        profileKind: "human",
      })
    ).toBe(true);
    expect(
      isProfileKindAllowedInView({
        resolvedView: "human",
        profileKind: "agent",
      })
    ).toBe(true);
    expect(
      isProfileKindAllowedInView({
        resolvedView: "human",
        profileKind: "system",
      })
    ).toBe(true);
  });

  it("allows human and agent profiles in agent view", () => {
    expect(
      isProfileKindAllowedInView({
        resolvedView: "agent",
        profileKind: "agent",
      })
    ).toBe(true);
    expect(
      isProfileKindAllowedInView({
        resolvedView: "agent",
        profileKind: "human",
      })
    ).toBe(true);
    expect(
      isProfileKindAllowedInView({
        resolvedView: "agent",
        profileKind: "system",
      })
    ).toBe(false);
  });
});
