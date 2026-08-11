import { describe, expect, it } from "vitest";
import { hasExplicitProfileUpdateField } from "../src/profile/profile-update-cli-options";

describe("profile update CLI options", () => {
  it("treats Binding-only fields as explicit profile updates", () => {
    expect(
      hasExplicitProfileUpdateField({
        agentControllerPermissionMode: "run-everything",
      })
    ).toBe(true);
    expect(
      hasExplicitProfileUpdateField({
        model: "default[]",
      })
    ).toBe(true);
    expect(
      hasExplicitProfileUpdateField({
        reasoningEffort: "high",
      })
    ).toBe(true);
  });

  it("does not treat the dangerous-mode confirmation by itself as an update", () => {
    expect(
      hasExplicitProfileUpdateField({
        confirmDangerousAgentControllerPermissionMode: true,
      })
    ).toBe(false);
    expect(hasExplicitProfileUpdateField({})).toBe(false);
  });
});
