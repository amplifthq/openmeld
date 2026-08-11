import { describe, expect, it } from "vitest";
import { MAX_TEXT_LENGTH, normalizeSpaceCursorPatch } from "../../src/schemas";

describe("space cursor patch normalization", () => {
  it("rejects role values longer than the shared text limit", () => {
    expect(
      normalizeSpaceCursorPatch({ role: "x".repeat(MAX_TEXT_LENGTH + 1) })
    ).toEqual({
      ok: false,
      message: "Role too long",
    });
  });

  it("rejects the retired role-instructions cursor field", () => {
    const retiredCursorField = ["role", "Instructions"].join("");

    expect(
      normalizeSpaceCursorPatch({
        role: "architect",
        [retiredCursorField]: "Keep system boundaries stable.",
      })
    ).toEqual({
      ok: false,
      message: `Unrecognized key: "${retiredCursorField}"`,
    });
  });

  it("rejects invalid mentionAlias token syntax", () => {
    expect(
      normalizeSpaceCursorPatch({ mentionAlias: "invalid alias" })
    ).toEqual({
      ok: false,
      message: "Invalid mentionAlias",
    });
  });

  it("rejects mentionAlias values longer than the token limit", () => {
    expect(
      normalizeSpaceCursorPatch({
        mentionAlias: `a${"b".repeat(128)}`,
      })
    ).toEqual({
      ok: false,
      message: "MentionAlias too long",
    });
  });

  it("keeps blank mentionAlias values so Core can clear stored aliases", () => {
    expect(normalizeSpaceCursorPatch({ mentionAlias: "   " })).toEqual({
      ok: true,
      value: {
        mentionAlias: "",
      },
    });
  });
});
