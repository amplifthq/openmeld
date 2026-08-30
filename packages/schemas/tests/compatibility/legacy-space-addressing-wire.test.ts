import {
  messageEnvelopeSchema,
  normalizeMessageEnvelope,
  spaceMemberDirectoryAllowedRelationsSchema,
  toCompatibleSpaceAddressingRequestWireValue,
  toLegacySpaceAddressingWireValue,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import * as z from "zod/v4";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const legacyMessageEnvelopeSchema = z.strictObject({
  activationTargets: z.array(z.string()),
  ccTargets: z.array(z.string()),
  referenceTargets: z.array(z.string()),
  text: z.string(),
});
const legacyAllowedRelationsSchema = z.strictObject({
  cc: z.boolean(),
  reference: z.boolean(),
  wake: z.boolean(),
});

describe("legacy Space Addressing wire compatibility", () => {
  it("keeps Human Mention requests current and downgrades requests without them", () => {
    const currentMentionRequest = {
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        mentionTargets: [HUMAN_PROFILE_ID],
        text: "@Felix please review",
      },
    };
    expect(
      toCompatibleSpaceAddressingRequestWireValue(currentMentionRequest)
    ).toEqual(currentMentionRequest);

    expect(
      toCompatibleSpaceAddressingRequestWireValue({
        messageEnvelope: {
          activationTargets: [AGENT_PROFILE_ID],
          referenceTargets: [],
          mentionTargets: [],
          text: "Please investigate",
        },
      })
    ).toEqual({
      messageEnvelope: {
        activationTargets: [AGENT_PROFILE_ID],
        referenceTargets: [],
        ccTargets: [],
        text: "Please investigate",
      },
    });
  });

  it("adds retired fields only to the serialized wire projection", () => {
    const currentValue = {
      member: {
        allowedRelations: {
          mention: true,
          reference: true,
          wake: false,
        },
      },
      sourceMessageEnvelope: {
        activationTargets: [],
        referenceTargets: [AGENT_PROFILE_ID],
        text: "Dispatch context.",
      },
      signal: {
        data: {
          messageEnvelope: {
            activationTargets: [AGENT_PROFILE_ID],
            referenceTargets: [HUMAN_PROFILE_ID],
            text: "Please review.",
          },
        },
      },
    };

    expect(toLegacySpaceAddressingWireValue(currentValue)).toEqual({
      member: {
        allowedRelations: {
          cc: false,
          reference: true,
          wake: false,
        },
      },
      sourceMessageEnvelope: {
        activationTargets: [],
        ccTargets: [],
        referenceTargets: [AGENT_PROFILE_ID],
        text: "Dispatch context.",
      },
      signal: {
        data: {
          messageEnvelope: {
            activationTargets: [AGENT_PROFILE_ID],
            ccTargets: [],
            referenceTargets: [HUMAN_PROFILE_ID],
            text: "Please review.",
          },
        },
      },
    });
    expect(currentValue.member.allowedRelations).not.toHaveProperty("cc");
    expect(currentValue.sourceMessageEnvelope).not.toHaveProperty("ccTargets");
    expect(currentValue.signal.data.messageEnvelope).not.toHaveProperty(
      "ccTargets"
    );
  });

  it("serializes historical CC as Reference plus an empty retired wire field", () => {
    const currentEnvelope = normalizeMessageEnvelope({
      activationTargets: [],
      ccTargets: [AGENT_PROFILE_ID],
      referenceTargets: [HUMAN_PROFILE_ID],
      text: "Historical message",
    });

    expect(toLegacySpaceAddressingWireValue(currentEnvelope)).toEqual({
      activationTargets: [],
      ccTargets: [],
      referenceTargets: [HUMAN_PROFILE_ID, AGENT_PROFILE_ID],
      text: "Historical message",
    });
    expect(currentEnvelope).not.toHaveProperty("ccTargets");
  });

  it("keeps legacy strict schemas readable during the three-relation rollout", () => {
    const currentEnvelope = normalizeMessageEnvelope({
      activationTargets: [AGENT_PROFILE_ID],
      referenceTargets: [HUMAN_PROFILE_ID],
      text: "Compatibility window",
    });
    const legacyWireEnvelope =
      toLegacySpaceAddressingWireValue(currentEnvelope);

    expect(legacyMessageEnvelopeSchema.parse(legacyWireEnvelope)).toEqual({
      activationTargets: [AGENT_PROFILE_ID],
      ccTargets: [],
      referenceTargets: [HUMAN_PROFILE_ID],
      text: "Compatibility window",
    });
    expect(messageEnvelopeSchema.parse(legacyWireEnvelope)).toEqual({
      activationTargets: [AGENT_PROFILE_ID],
      referenceTargets: [HUMAN_PROFILE_ID],
      text: "Compatibility window",
    });

    const legacyWireRelations = toLegacySpaceAddressingWireValue({
      allowedRelations: { mention: true, reference: false, wake: false },
    }) as { allowedRelations: unknown };
    expect(
      legacyAllowedRelationsSchema.parse(legacyWireRelations.allowedRelations)
    ).toEqual({
      cc: false,
      reference: false,
      wake: false,
    });
    expect(
      spaceMemberDirectoryAllowedRelationsSchema.parse(
        legacyWireRelations.allowedRelations
      )
    ).toEqual({
      mention: false,
      reference: false,
      wake: false,
    });
  });
});
