import { describe, expect, it } from "vitest";
import { updateAuthoredMentionRanges } from "../src/authoring/authored-mention-ranges";

describe("selected mention identity across terminal edits", () => {
  const mention = {
    profileId: "agent-id",
    relation: "wake" as const,
    start: 3,
    text: "@Review (1)",
  };
  const previousText = "Hi @Review (1) please";
  it("moves identity with text inserted before it", () => {
    expect(
      updateAuthoredMentionRanges({
        previousText,
        text: `Hello ${previousText}`,
        mentions: [mention],
      })
    ).toEqual([{ ...mention, start: 9 }]);
  });
  it("drops identity when the selected name is edited", () => {
    expect(
      updateAuthoredMentionRanges({
        previousText,
        text: "Hi @Other (1) please",
        mentions: [mention],
      })
    ).toEqual([]);
  });
  it("does not infer identity from typed or pasted text", () => {
    expect(
      updateAuthoredMentionRanges({
        previousText: "",
        text: previousText,
        mentions: [],
      })
    ).toEqual([]);
  });
  it("preserves identity when trailing prose changes", () => {
    expect(
      updateAuthoredMentionRanges({
        previousText,
        text: "Hi @Review (1) thanks",
        mentions: [mention],
      })
    ).toEqual([mention]);
  });
});
