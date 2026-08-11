import { ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { resolveProfileHintByMessage } from "../src/openmeld-error-hints";

describe("OpenMeld profile error hints", () => {
  it("redirects disabled additional Human creation to the default Human or an Agent", () => {
    expect(
      resolveProfileHintByMessage(
        ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE
      )
    ).toEqual([
      "openmeld profiles list --view human",
      "openmeld start --view human",
      "openmeld profiles create <profileName> --kind agent",
    ]);
  });
});
