import {
  type DispatchSendTargetProjectionEntry,
  type DispatchSendTargetReferenceLoadResult,
  normalizeDispatchPostMessageAction,
} from "@openmeld/local-service";
import { describe, expect, it } from "vitest";

const READY_AGENT_PROFILE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SLEEPING_AGENT_PROFILE_ID = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";

type TestSendTargetProjectionEntry = DispatchSendTargetProjectionEntry & {
  primaryMentionLabel: string;
  [key: string]: unknown;
};

describe("normalizeDispatchPostMessageAction", () => {
  it("fills the current dispatch reply target and preserves canonical target arrays", () => {
    const normalized = normalizeDispatchPostMessageAction({
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [READY_AGENT_PROFILE_ID],
          mentionTargets: [HUMAN_PROFILE_ID],
          referenceTargets: [],
          text: "  hello from the agent path  ",
        },
      },
      currentReplyToSignalId: "sig-current-reply",
      inputKind: "direct_payload",
      sendTargetReference: createLoadedSendTargetReference([
        createProjectionEntry({
          allowedRelations: {
            wake: true,
            reference: true,
            mention: false,
          },
          profileId: READY_AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Budget Analyst",
          primaryMentionLabel: "Budget Analyst",
        }),
        createProjectionEntry({
          allowedRelations: {
            wake: false,
            reference: false,
            mention: true,
          },
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Mira",
          primaryMentionLabel: "Mira",
        }),
      ]),
    });

    expect(normalized.action).toEqual({
      type: "post_message",
      messageEnvelope: {
        activationTargets: [READY_AGENT_PROFILE_ID],
        mentionTargets: [HUMAN_PROFILE_ID],
        referenceTargets: [],
        replyToSignalId: "sig-current-reply",
        text: "hello from the agent path",
      },
    });
    expect(normalized.tracePayload).toEqual({
      activationTargetsCount: 1,
      inputKind: "direct_payload",
      memberDirectoryLoaded: true,
      mentionTargetsCount: 1,
      referenceTargetsCount: 0,
      replyToSignalIdResolved: true,
    });
  });

  it("rejects an explicit reply target that does not match the current dispatch reply target", () => {
    expect(() =>
      normalizeDispatchPostMessageAction({
        action: {
          type: "post_message",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            replyToSignalId: "sig-other-reply",
            text: "hello",
          },
        },
        currentReplyToSignalId: "sig-current-reply",
        inputKind: "direct_payload",
        sendTargetReference: createLoadedSendTargetReference([]),
      })
    ).toThrow(
      "post_message.messageEnvelope.replyToSignalId must match the current dispatch reply target"
    );
  });

  it("allows empty targets even when the current Space member directory is unavailable", () => {
    const normalized = normalizeDispatchPostMessageAction({
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "hello",
        },
      },
      currentReplyToSignalId: null,
      inputKind: "fenced_block",
      sendTargetReference: {
        status: "failed",
        errorMessage: "member directory unavailable",
        projection: null,
        referenceLines: [],
      },
    });

    expect(normalized.action).toEqual({
      type: "post_message",
      messageEnvelope: {
        activationTargets: [],
        mentionTargets: [],
        referenceTargets: [],
        text: "hello",
      },
    });
    expect(normalized.tracePayload.memberDirectoryLoaded).toBe(false);
  });

  it("rejects non-empty targets when the current Space member directory is unavailable", () => {
    expect(() =>
      normalizeDispatchPostMessageAction({
        action: {
          type: "post_message",
          messageEnvelope: {
            activationTargets: [READY_AGENT_PROFILE_ID],
            referenceTargets: [],
            text: "hello",
          },
        },
        currentReplyToSignalId: null,
        inputKind: "trailing_json",
        sendTargetReference: {
          status: "failed",
          errorMessage: "member directory unavailable",
          projection: null,
          referenceLines: [],
        },
      })
    ).toThrow(
      "post_message.messageEnvelope targets require a current Space member directory"
    );
  });

  it("allows agent wake targets without local readiness gating", () => {
    const normalized = normalizeDispatchPostMessageAction({
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [SLEEPING_AGENT_PROFILE_ID],
          referenceTargets: [],
          text: "hello",
        },
      },
      currentReplyToSignalId: null,
      inputKind: "direct_payload",
      sendTargetReference: createLoadedSendTargetReference([
        createProjectionEntry({
          allowedRelations: {
            wake: true,
            reference: true,
            mention: false,
          },
          profileId: SLEEPING_AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Sleeping Agent",
          primaryMentionLabel: "Sleeping Agent",
        }),
      ]),
    });

    expect(normalized.action.messageEnvelope.activationTargets).toEqual([
      SLEEPING_AGENT_PROFILE_ID,
    ]);
  });

  it("rejects human wake targets because wake is not a supported relation", () => {
    expect(() =>
      normalizeDispatchPostMessageAction({
        action: {
          type: "post_message",
          messageEnvelope: {
            activationTargets: [HUMAN_PROFILE_ID],
            referenceTargets: [],
            text: "hello",
          },
        },
        currentReplyToSignalId: null,
        inputKind: "direct_payload",
        sendTargetReference: createLoadedSendTargetReference([
          createProjectionEntry({
            allowedRelations: {
              wake: false,
              reference: false,
              mention: true,
            },
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
            profileName: "Mira",
            primaryMentionLabel: "Mira",
          }),
        ]),
      })
    ).toThrow(
      "post_message.messageEnvelope.activationTargets[0] must reference an agent profile in this space"
    );
  });

  it("rejects reference targets that do not resolve to an active profile in this space", () => {
    expect(() =>
      normalizeDispatchPostMessageAction({
        action: {
          type: "post_message",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: ["22222222-2222-4222-8222-222222222222"],
            text: "hello",
          },
        },
        currentReplyToSignalId: null,
        inputKind: "direct_payload",
        sendTargetReference: createLoadedSendTargetReference([
          createProjectionEntry({
            allowedRelations: {
              wake: false,
              reference: false,
              mention: true,
            },
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
            profileName: "Mira",
            primaryMentionLabel: "Mira",
          }),
        ]),
      })
    ).toThrow(
      "post_message.messageEnvelope.referenceTargets[0] must reference an active profile in this space"
    );
  });
});

function createLoadedSendTargetReference(
  projection: TestSendTargetProjectionEntry[]
): DispatchSendTargetReferenceLoadResult {
  return {
    status: "loaded",
    projection,
    referenceLines: projection.map(
      (target) =>
        `${target.primaryMentionLabel} -> ${target.profileId} (${formatAllowedRelations(target)})`
    ),
  };
}

function createProjectionEntry(input: {
  allowedRelations: DispatchSendTargetProjectionEntry["allowedRelations"];
  profileId: string;
  profileKind: "agent" | "human";
  profileName: string;
  primaryMentionLabel: string;
}): TestSendTargetProjectionEntry {
  return {
    profileId: input.profileId,
    profileKind: input.profileKind,
    displayName: input.profileName,
    mentionAlias: null,
    profileIdShort:
      input.profileKind === "agent"
        ? `${input.profileId.slice(0, 9)}`
        : input.profileId.slice(0, 5),
    primaryMentionLabel: input.primaryMentionLabel,
    labelSource: "profile_name",
    mentionLabels: [input.primaryMentionLabel, input.profileId],
    lookupTokens: [input.profileId],
    preferredLookupToken: input.profileId,
    allowedRelations: input.allowedRelations,
    agentCard: null,
    ownerName: "Felix",
    ownerUserId: "usr-felix",
    spaceRole: null,
  };
}

function formatAllowedRelations(
  target: DispatchSendTargetProjectionEntry
): string {
  const relations: string[] = [];
  if (target.allowedRelations.wake) {
    relations.push("wake");
  }
  if (target.allowedRelations.reference) {
    relations.push("reference");
  }
  if (target.allowedRelations.mention) {
    relations.push("mention");
  }
  return relations.join(" | ");
}
