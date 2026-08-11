import { describe, expect, it } from "vitest";
import { extractMentionAuthoringPrefix } from "../src/index";

describe("space mention authoring prefix", () => {
  it("keeps multi-word target queries active", () => {
    expect(extractMentionAuthoringPrefix("hello @Budget Anal")).toBe(
      "@Budget Anal"
    );
  });

  it("stops mention selector authoring once canonical relation syntax starts", () => {
    expect(extractMentionAuthoringPrefix("@Budget Analyst(")).toBeNull();
    expect(extractMentionAuthoringPrefix("@Budget Analyst)")).toBeNull();
  });

  it("dismisses the picker when @ is immediately followed by whitespace", () => {
    // Typing "@" then a space is a literal "@", so the picker should close.
    expect(extractMentionAuthoringPrefix("@ ")).toBeNull();
    expect(extractMentionAuthoringPrefix("hello @ world")).toBeNull();
    // A bare "@" (still authoring) and multi-word queries stay active.
    expect(extractMentionAuthoringPrefix("@")).toBe("@");
    expect(extractMentionAuthoringPrefix("@ming")).toBe("@ming");
    expect(extractMentionAuthoringPrefix("@Budget Anal")).toBe("@Budget Anal");
  });
});
