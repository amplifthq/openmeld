import { describe, expect, it } from "vitest";
import {
  renderNonOwnerAudiencePathGuidance,
  toPromptSafeFolderDisplayName,
} from "../src/audience-path-guidance";

describe("non-owner audience path guidance", () => {
  it("names the folder by display name and forbids local identity", () => {
    const text = renderNonOwnerAudiencePathGuidance({
      folderDisplayName: "folder-two",
    });
    expect(text).toContain('the working folder "folder-two"');
    expect(text).toContain("absolute local paths");
    expect(text).toContain("home directory");
    expect(text).toContain("computer names");
    expect(text).toContain("account identifiers");
  });

  it.each([
    "/Users/felix/project",
    "~/project",
    "C:\\Users\\felix",
    "  ",
    null,
    undefined,
  ])("never uses a path-like or empty name (%s)", (name) => {
    expect(toPromptSafeFolderDisplayName(name)).toBeNull();
    const text = renderNonOwnerAudiencePathGuidance({
      folderDisplayName: name,
    });
    expect(text).toContain("Refer to the working folder by that name");
    if (name?.trim()) {
      expect(text).not.toContain(name);
    }
  });
});
