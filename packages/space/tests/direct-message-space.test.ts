import { describe, expect, it } from "vitest";
import {
  buildDirectMessagePairKey,
  isAgentDirectConversationSpace,
  isDirectMessageSpace,
  OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
  OPENMELD_WELCOMING_SPACE_PURPOSE,
} from "../src";

describe("direct message Space presentation", () => {
  it("derives Direct Message state from origin purpose and exactly two active members", () => {
    expect(
      isDirectMessageSpace({
        activeMemberCount: 2,
        directMessageConvertedAt: null,
        purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
      })
    ).toBe(true);

    expect(
      isDirectMessageSpace({
        activeMemberCount: 3,
        purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
      })
    ).toBe(false);

    expect(
      isDirectMessageSpace({
        activeMemberCount: 2,
        purpose: "ordinary_private_space",
      })
    ).toBe(false);
  });

  it("never turns a converted Space back into a Direct Message", () => {
    expect(
      isDirectMessageSpace({
        activeMemberCount: 2,
        directMessageConvertedAt: "2026-08-07T12:00:00.000Z",
        purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
      })
    ).toBe(false);
  });

  it("treats missing projection fields as not Direct Message state", () => {
    expect(
      isDirectMessageSpace({
        activeMemberCount: null,
        purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
      })
    ).toBe(false);

    expect(
      isDirectMessageSpace({
        activeMemberCount: 2,
        purpose: null,
      })
    ).toBe(false);
  });

  it("builds the same pair key regardless of profile order", () => {
    expect(buildDirectMessagePairKey("human-felix", "agt-codex")).toBe(
      buildDirectMessagePairKey("agt-codex", "human-felix")
    );
  });

  it("does not treat legacy welcoming Spaces as current agent direct conversations", () => {
    expect(
      isAgentDirectConversationSpace({
        activeMemberCount: 2,
        agentMemberCount: 1,
        humanMemberCount: 1,
        purpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
      })
    ).toBe(false);

    expect(
      isAgentDirectConversationSpace({
        activeMemberCount: 3,
        agentMemberCount: 1,
        humanMemberCount: 2,
        purpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
      })
    ).toBe(false);
  });

  it("does not treat ordinary one-human one-agent Spaces as agent direct conversations", () => {
    expect(
      isAgentDirectConversationSpace({
        activeMemberCount: 2,
        agentMemberCount: 1,
        humanMemberCount: 1,
        purpose: "ordinary_private_space",
      })
    ).toBe(false);
  });
});
