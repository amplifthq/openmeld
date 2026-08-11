import { describe, expect, it } from "vitest";
import {
  buildDefaultCenterAgentProfileName,
  DEFAULT_CENTER_AGENT_PROFILE_NAME,
} from "../../src";

describe("buildDefaultCenterAgentProfileName", () => {
  it("prefixes the product name with the Organization name", () => {
    expect(buildDefaultCenterAgentProfileName("OpenMeld Official")).toBe(
      "OpenMeld Official Center Agent"
    );
  });

  it("does not append a duplicate Center Agent suffix", () => {
    expect(buildDefaultCenterAgentProfileName("Acme Center Agent")).toBe(
      "Acme Center Agent"
    );
  });

  it.each([
    null,
    undefined,
    "",
    "   ",
  ])("falls back to the generic product name for %s", (organizationName) => {
    expect(buildDefaultCenterAgentProfileName(organizationName)).toBe(
      DEFAULT_CENTER_AGENT_PROFILE_NAME
    );
  });
});
