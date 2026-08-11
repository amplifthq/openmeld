import {
  messageEnvelopeSchema,
  normalizeMessageEnvelope,
  spaceMemberDirectoryAllowedRelationsSchema,
  toLegacySpaceAddressingWireValue,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

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
  it("adds retired fields only to the serialized wire projection", () => {
    const currentValue = {
      member: {
        allowedRelations: {
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

  it("keeps old and new strict consumers interoperable without a third current fact", () => {
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
    expect(messageEnvelopeSchema.parse(legacyWireEnvelope)).toEqual(
      currentEnvelope
    );

    const legacyWireRelations = toLegacySpaceAddressingWireValue({
      allowedRelations: { reference: true, wake: false },
    }) as { allowedRelations: unknown };
    expect(
      legacyAllowedRelationsSchema.parse(legacyWireRelations.allowedRelations)
    ).toEqual({
      cc: false,
      reference: true,
      wake: false,
    });
    expect(
      spaceMemberDirectoryAllowedRelationsSchema.parse(
        legacyWireRelations.allowedRelations
      )
    ).toEqual({
      reference: true,
      wake: false,
    });
  });
});
