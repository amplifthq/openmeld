import { describe, expect, it } from "vitest";
import { buildSpaceCreatePasswordPromptConfig } from "../src/ui/space-create-password-prompt";

describe("Space create password prompt", () => {
  it("explains the public passwordless choice", () => {
    const config = buildSpaceCreatePasswordPromptConfig({
      minimumLength: 6,
      visibility: "public",
    });

    expect(config).toMatchObject({
      setPasswordLabel: "Yes, require a password to open and join",
      skipPasswordLabel: "No, anyone with the link can join",
    });
    expect(config.message).toContain("⚠️ Check Before You Continue");
    expect(config.message).toContain(
      "Without a password, anyone with this Space link can read what is shared here and join."
    );
    expect(config.message).toContain(
      "With a password, only people who have it can open and join the Space."
    );
    expect(config.message).toContain("Require a password to open and join?");
    expect(config.message).not.toContain("members-only");
    expect(config.message).not.toContain("data leakage");
    expect(config.message).not.toContain("Space ID");
  });

  it("explains the private passwordless choice", () => {
    const config = buildSpaceCreatePasswordPromptConfig({
      minimumLength: 6,
      visibility: "private",
    });

    expect(config).toMatchObject({
      setPasswordLabel: "Yes, require a password to open and join",
      skipPasswordLabel: "No, keep access members-only",
    });
    expect(config.message).toContain(
      "Without a password, only current members can open this Space. New participants must be added explicitly."
    );
    expect(config.message).not.toContain("anyone with the link can join");
  });
});
