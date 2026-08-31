import { describe, expect, it } from "vitest";
import {
  collectCanonicalMentionTextFragments,
  getSpaceMessageAddressingRelationSupportForTargetKind,
  MESSAGE_ENVELOPE_TARGET_FIELD_VALUES,
  normalizeMessageEnvelope,
  SPACE_MESSAGE_ADDRESSING_RELATION_VALUES,
} from "../../src/index";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";

describe("CC removal compatibility", () => {
  it("exposes Wake, Reference, and Human Mention in the current addressing contract", () => {
    expect(SPACE_MESSAGE_ADDRESSING_RELATION_VALUES).toEqual([
      "wake",
      "reference",
      "mention",
    ]);
    expect(MESSAGE_ENVELOPE_TARGET_FIELD_VALUES).toEqual([
      "activationTargets",
      "referenceTargets",
      "mentionTargets",
    ]);
    expect(
      getSpaceMessageAddressingRelationSupportForTargetKind("human_profile")
    ).toEqual({
      wake: false,
      reference: false,
      mention: true,
    });
    expect(
      getSpaceMessageAddressingRelationSupportForTargetKind("agent_profile")
    ).toEqual({
      wake: true,
      reference: true,
      mention: false,
    });
  });

  it("normalizes historical ccTargets into Reference without retaining CC state", () => {
    const normalized = normalizeMessageEnvelope({
      activationTargets: [AGENT_PROFILE_ID],
      referenceTargets: [],
      ccTargets: [HUMAN_PROFILE_ID],
      text: "Historical message",
    });

    expect(normalized).toEqual({
      activationTargets: [AGENT_PROFILE_ID],
      mentionTargets: [],
      referenceTargets: [HUMAN_PROFILE_ID],
      text: "Historical message",
    });
    expect(normalized).not.toHaveProperty("ccTargets");
  });

  it("still detects removed @Name(cc) syntax so clients can reject it explicitly", () => {
    expect(
      collectCanonicalMentionTextFragments("@Mira(cc) Please review.")
    ).toEqual([
      {
        start: 0,
        end: 9,
        text: "@Mira(cc)",
        parsedLiteral: null,
      },
    ]);
  });
});
