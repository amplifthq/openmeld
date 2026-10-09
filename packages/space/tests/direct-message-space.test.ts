import { describe, expect, it } from "vitest";
import {
  buildDirectMessagePairKey,
  isAutomaticWakeSpace,
  isDirectMessageSpace,
  OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
  OPENMELD_WELCOMING_SPACE_PURPOSE,
} from "../src";

describe("direct message Space presentation", () => {
  it.each([
    {
      purpose: "ordinary_private_space",
      isThreadMessage: false,
      expected: true,
    },
    {
      purpose: "ordinary_private_space",
      isThreadMessage: true,
      expected: false,
    },
    {
      purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
      isThreadMessage: true,
      expected: true,
    },
  ])("keeps Space membership addressing separate from Thread addressing: $purpose/$isThreadMessage", ({
    purpose,
    isThreadMessage,
    expected,
  }) => {
    expect(
      isAutomaticWakeSpace({
        purpose,
        isThreadMessage,
        activeMemberCount: 2,
        humanMemberCount: 1,
        agentMemberCount: 1,
      })
    ).toBe(expected);
  });
  it.each([
    0, 1, 2,
  ])("keeps an unconverted Direct Message with %i remaining members", (activeMemberCount) => {
    const conversation = {
      activeMemberCount,
      directMessageConvertedAt: null,
      purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
    };
    expect(isDirectMessageSpace(conversation)).toBe(true);
    expect(
      isDirectMessageSpace({
        ...conversation,
        directMessageConvertedAt: "2026-08-07T12:00:00.000Z",
      })
    ).toBe(false);
  });

  it.each([
    "ordinary_private_space",
    null,
    undefined,
  ])("requires Direct Message origin: %s", (purpose) => {
    expect(isDirectMessageSpace({ purpose })).toBe(false);
  });

  it("builds the same pair key regardless of profile order", () => {
    expect(buildDirectMessagePairKey("human-felix", "agt-codex")).toBe(
      buildDirectMessagePairKey("agt-codex", "human-felix")
    );
  });

  it("does not treat legacy welcoming Spaces as current agent direct conversations", () => {
    expect(
      isAutomaticWakeSpace({
        activeMemberCount: 2,
        agentMemberCount: 1,
        humanMemberCount: 1,
        purpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
      })
    ).toBe(false);

    expect(
      isAutomaticWakeSpace({
        activeMemberCount: 3,
        agentMemberCount: 1,
        humanMemberCount: 2,
        purpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
      })
    ).toBe(false);
  });

  it("automatically addresses ordinary one-human one-agent Spaces", () => {
    expect(
      isAutomaticWakeSpace({
        activeMemberCount: 2,
        agentMemberCount: 1,
        humanMemberCount: 1,
        purpose: "ordinary_private_space",
      })
    ).toBe(true);
  });
});
