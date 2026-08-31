import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildCanonicalDispatchReplyMessageEnvelope,
  buildDispatchReplyTargetProfile,
  DISPATCH_REPLY_SIGNAL_ID_MISMATCH_ERROR,
} from "../dispatch/application/dispatch-reply-foundation";

const TEST_DISPATCH_MESSAGE = {
  dispatchId: "dispatch-1",
  dispatchChainId: "chain-1",
  autoRelayDepth: 0,
  idempotencyKey: "idempotency-1",
  sourceEventId: "sig-origin",
  spaceId: "space-1",
  targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
  visitedProfileIds: ["agt_11111111-1111-4111-8111-111111111111"],
  visitedProfileIdsHash: "stable32:dispatch-reply-foundation-01",
  replyToSnapshot: {
    signalId: "sig-origin",
    profileId: "hum_1",
    profileKind: "human",
    profileName: "Felix",
    previewText: "Earlier message",
  },
} as unknown as OpenMeldDaemonDispatchQueueMessage;

describe("buildDispatchReplyTargetProfile", () => {
  it("omits whitespace-only profile handles from the published profile", () => {
    const profile = buildDispatchReplyTargetProfile({
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      profileHandle: "   ",
      targetProfileName: "Codex",
      ownerUserId: "user-1",
      agentControllerRef: "builtin:codex",
      agentControllerConversationId: null,
    });

    expect(profile).toEqual({
      kind: "agent",
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      owner: "user-1",
      agentControllerRef: "builtin:codex",
      profileName: "Codex",
    });
  });

  it("pins canonical text reply lineage to the frozen dispatch reply target", () => {
    const envelope = buildCanonicalDispatchReplyMessageEnvelope({
      dispatchMessage: TEST_DISPATCH_MESSAGE,
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        text: "draft text should be replaced",
      },
      replyText: "Final reply",
    });

    expect(envelope).toEqual({
      activationTargets: [],
      mentionTargets: [],
      referenceTargets: [],
      replyToSignalId: "sig-origin",
      text: "Final reply",
    });
  });

  it("rejects reply lineage mismatches between the frozen dispatch target and emitted message envelope", () => {
    expect(() =>
      buildCanonicalDispatchReplyMessageEnvelope({
        dispatchMessage: TEST_DISPATCH_MESSAGE,
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          replyToSignalId: "sig-other",
          text: "Final reply",
        },
        replyText: "Final reply",
      })
    ).toThrow(DISPATCH_REPLY_SIGNAL_ID_MISMATCH_ERROR);
  });
});
