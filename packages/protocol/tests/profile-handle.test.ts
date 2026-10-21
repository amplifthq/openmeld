import { describe, expect, it } from "vitest";
import {
  buildLegacyDefaultMentionAliasCandidates,
  buildProfileHandleBase,
  buildProfileHandleCandidates,
  isLegacyDefaultMentionAlias,
  normalizeMentionToken,
  resolveAvailableProfileHandle,
  resolveCustomMentionAliasOverride,
} from "../src/profile-handle";

describe("profile handle", () => {
  it("normalizes mention-safe tokens", () => {
    expect(normalizeMentionToken("  Claude_Code.1  ")).toBe("Claude_Code.1");
    expect(normalizeMentionToken("Claude Code")).toBeNull();
    expect(normalizeMentionToken("")).toBeNull();
  });

  it("builds a slug base from profile name", () => {
    expect(
      buildProfileHandleBase({
        profileName: "  Claude Code  ",
        profileKind: "agent",
      })
    ).toBe("claude-code");
  });

  it("trims edge separators from a long run of dashes", () => {
    expect(
      buildProfileHandleBase({
        profileName: `--${"-".repeat(50_000)}Claude Code!--`,
        profileKind: "agent",
      })
    ).toBe("claude-code");
  });

  it("falls back by profile kind when the profile name has no slug content", () => {
    expect(
      buildProfileHandleBase({
        profileName: "!!!",
        profileKind: "human",
      })
    ).toBe("human");
  });

  it("builds deterministic candidate sequences", () => {
    expect(
      buildProfileHandleCandidates({
        profileName: "Claude Code",
        profileKind: "agent",
        limit: 4,
      })
    ).toEqual([
      "claude-code",
      "claude-code-2",
      "claude-code-3",
      "claude-code-4",
    ]);
  });

  it("resolves the first available handle within an owner scope", () => {
    expect(
      resolveAvailableProfileHandle({
        profileName: "Claude Code",
        profileKind: "agent",
        takenHandles: ["claude-code", "claude-code-2"],
      })
    ).toBe("claude-code-3");
  });

  it("builds legacy default alias candidates for compatibility", () => {
    expect(
      buildLegacyDefaultMentionAliasCandidates({
        profileName: "Claude Code",
        profileId: "agt_aaaaaaaa-0000-0000-0000-000000000000",
        profileKind: "agent",
      })
    ).toEqual(["claude-code-aaaaaaaa"]);
  });

  it("keeps mention-safe profile names as a legacy alias candidate", () => {
    expect(
      buildLegacyDefaultMentionAliasCandidates({
        profileName: "ops-bot",
        profileId: "agt_bbbbbb00-0000-0000-0000-000000000000",
        profileKind: "agent",
      })
    ).toEqual(["ops-bot", "ops-bot-bbbbbb00"]);
  });

  it("matches the historical alias seed normalization rules", () => {
    expect(
      buildLegacyDefaultMentionAliasCandidates({
        profileName: "  .Claude__Code...Beta  ",
        profileId: "agt_cccccccc-0000-0000-0000-000000000000",
        profileKind: "agent",
      })
    ).toEqual(["claude-code-beta-cccccccc"]);
  });

  it("recognizes legacy default mention aliases", () => {
    expect(
      isLegacyDefaultMentionAlias({
        mentionAlias: "claude-code-aaaaaaaa",
        profileName: "Claude Code",
        profileId: "agt_aaaaaaaa-0000-0000-0000-000000000000",
        profileKind: "agent",
      })
    ).toBe(true);
    expect(
      isLegacyDefaultMentionAlias({
        mentionAlias: "claude-code-custom",
        profileName: "Claude Code",
        profileId: "agt_aaaaaaaa-0000-0000-0000-000000000000",
        profileKind: "agent",
      })
    ).toBe(false);
  });

  it("treats legacy default mention aliases as non-custom overrides", () => {
    expect(
      resolveCustomMentionAliasOverride({
        mentionAlias: "claude-code-aaaaaaaa",
        profileName: "Claude Code",
        profileId: "agt_aaaaaaaa-0000-0000-0000-000000000000",
        profileKind: "agent",
      })
    ).toBeNull();
    expect(
      resolveCustomMentionAliasOverride({
        mentionAlias: "claude-code-main",
        profileName: "Claude Code",
        profileId: "agt_aaaaaaaa-0000-0000-0000-000000000000",
        profileKind: "agent",
      })
    ).toBe("claude-code-main");
  });
});
