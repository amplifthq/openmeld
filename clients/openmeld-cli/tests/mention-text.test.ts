import { collectCanonicalMentionLabelMatches } from "@openmeld/space";
import { describe, expect, it } from "vitest";

describe("mention text canonical label matching", () => {
  it("drops trailing terminal dots after a canonical mention literal", () => {
    expect(
      collectCanonicalMentionLabelMatches("ping @Agent(wake). now")
    ).toEqual([
      {
        start: 5,
        end: 17,
        mentionLabel: "Agent",
        mentionText: "@Agent(wake)",
        type: "wake",
      },
    ]);
  });

  it("keeps internal dots in canonical labels and trims repeated terminal dots", () => {
    expect(
      collectCanonicalMentionLabelMatches(
        "ping @A.B(reference) then @Agent(wake)..."
      )
    ).toEqual([
      {
        start: 5,
        end: 20,
        mentionLabel: "A.B",
        mentionText: "@A.B(reference)",
        type: "reference",
      },
      {
        start: 26,
        end: 38,
        mentionLabel: "Agent",
        mentionText: "@Agent(wake)",
        type: "wake",
      },
    ]);
  });
});
