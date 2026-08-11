import type { SignalEnvelope } from "@openmeld/protocol";
import { createDaemonRouteObservationSummary } from "@openmeld/schemas";
import { createSpaceMemberAgentExecutionReadiness } from "@openmeld/schemas/testing";
import type {
  DispatchResult,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildDispatchResultReplyWorkflowProjection,
  buildSignalIndex,
  buildSignalReplyWorkflowProjection,
  buildUpdatesReplyWorkflowProjection,
} from "../src";
import {
  createTestAgentAgentWakeAvailability,
  createTestAgentWakeRouteRegistration,
} from "./test-agent-public-presence";

const MEMBERS_SNAPSHOT: SpaceMembersSnapshot = {
  spaceId: "space-1",
  generatedAt: "2026-04-09T00:00:00.000Z",
  summary: {
    totalCount: 2,
    humanCount: 1,
    agentCount: 1,
    liveNowCount: 0,
    wakeableAgentCount: 1,
    offlineAgentCount: 0,
  },
  humans: [
    {
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Human Sender",
      profileKind: "human",
      status: "active",
      memberSource: "joined_directly",
      memberSourceLabel: "Joined directly",
      addedAt: "2026-04-09T00:00:00.000Z",
      removedAt: null,
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
      addedByProfileId: null,
      addedByOwnerUserId: null,
      addedByDisplayName: null,
      removedByProfileId: null,
      removedByOwnerUserId: null,
      removalReason: null,
      firstEnteredAt: null,
      lastEnteredAt: null,
      lastSeenAt: null,
      lastSeenLabel: null,
      liveNow: false,
      mentionAlias: null,
      ownerUserId: "user-1",
      ownerName: "Human Sender",
    },
  ],
  agents: [
    {
      profileId: "agt_target",
      profileName: "Target Agent",
      profileKind: "agent",
      status: "active",
      memberSource: "added_by_member",
      memberSourceLabel: "Added by member",
      addedAt: "2026-04-09T00:00:00.000Z",
      removedAt: null,
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
      addedByProfileId: "11111111-1111-1111-1111-111111111111",
      addedByOwnerUserId: "user-1",
      addedByDisplayName: "Human Sender",
      removedByProfileId: null,
      removedByOwnerUserId: null,
      removalReason: null,
      firstEnteredAt: null,
      lastEnteredAt: null,
      lastSeenAt: null,
      lastSeenLabel: null,
      liveNow: false,
      mentionAlias: null,
      ownerUserId: "user-1",
      ownerName: "Human Sender",
      agentControllerRef: "builtin:codex",
      agentControllerConversationId: null,
      workingDirectory: null,
      agentWakeAvailability:
        createTestAgentAgentWakeAvailability("available_for_wake"),
      ownerWakeDiagnostics: {
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          agentProfileId: "agt_target",
          displayState: "ready",
          reasonCodes: [],
        }),
        agentWakeRouteRegistration: createTestAgentWakeRouteRegistration(),
        wakeRouteEvidence: createDaemonRouteObservationSummary({
          observedAt: "2026-04-09T00:00:00.000Z",
          status: "online",
        }),
        wakeRouteStatus: {
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-test",
          deviceId: "device-test",
          lane: "dev-local",
          lastHeartbeatMs: 1_768_000_000_000,
          leaseEpoch: 1,
          status: "ready",
        },
        state: "none",
      },
    },
  ],
};

function createTextSignal(input: {
  id: string;
  profileId?: string;
  profileName?: string;
  text: string;
  replyToSignalId?: string;
  dispatchId?: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-1",
    ts: Date.UTC(2026, 3, 9, 0, 0, 0),
    profile: {
      kind: input.profileId?.startsWith("agt_") ? "agent" : "human",
      profileId: input.profileId ?? "11111111-1111-1111-1111-111111111111",
      profileName: input.profileName ?? "Human Sender",
    },
    type: "signal.text",
    data: {
      text: input.text,
      ...(input.dispatchId ? { meta: { dispatchId: input.dispatchId } } : {}),
      ...(input.replyToSignalId
        ? {
            messageEnvelope: {
              text: input.text,
              activationTargets: [],
              referenceTargets: [],
              replyToSignalId: input.replyToSignalId,
            },
            replyTo: {
              signalId: input.replyToSignalId,
              profileId: "11111111-1111-1111-1111-111111111111",
              profileKind: "human",
              profileName: "Human Sender",
              previewText: "anchor message",
            },
          }
        : {}),
    },
  };
}

function createStatusSignal(input: {
  id: string;
  dispatchId: string;
  replyToSignalId: string;
  text?: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-1",
    ts: Date.UTC(2026, 3, 9, 0, 0, 1),
    profile: {
      kind: "agent",
      profileId: "agt_target",
      profileName: "Target Agent",
    },
    type: "signal.status",
    data: {
      actorProfileId: "agt_target",
      dispatchId: input.dispatchId,
      generatedBy: "openmeld",
      status: "working",
      text: input.text ?? "Working",
      replyTo: {
        signalId: input.replyToSignalId,
        profileId: "11111111-1111-1111-1111-111111111111",
        profileKind: "human",
        profileName: "Human Sender",
        previewText: "anchor message",
      },
    },
  };
}

function createSystemNoticeSignal(input: {
  id: string;
  dispatchId: string;
  replyToSignalId: string;
  noticeType?: "stay_silent" | "policy_blocked" | "terminal_failure";
  text?: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-1",
    ts: Date.UTC(2026, 3, 9, 0, 0, 2),
    profile: {
      kind: "agent",
      profileId: "agt_target",
      profileName: "Target Agent",
    },
    type: "signal.system_notice",
    data: {
      dispatchId: input.dispatchId,
      noticeType: input.noticeType ?? "stay_silent",
      text: input.text ?? "Handled privately.",
      generatedBy: "openmeld",
      replyTo: {
        signalId: input.replyToSignalId,
        profileId: "11111111-1111-1111-1111-111111111111",
        profileKind: "human",
        profileName: "Human Sender",
        previewText: "anchor message",
      },
    },
  };
}

function createDispatchResult(
  overrides: Partial<DispatchResult> = {}
): DispatchResult {
  return {
    resultRef: overrides.resultRef ?? "dispatch-result:1",
    dispatchId: overrides.dispatchId ?? "dispatch-1",
    spaceId: overrides.spaceId ?? "space-1",
    actorProfileId: overrides.actorProfileId ?? "agt_target",
    actorName: overrides.actorName ?? "Target Agent",
    resultKind: overrides.resultKind ?? "text",
    finalText: overrides.finalText ?? "Final reply",
    messageEnvelope: overrides.messageEnvelope ?? {
      text: "Final reply",
      activationTargets: [],
      referenceTargets: ["11111111-1111-1111-1111-111111111111"],
      replyToSignalId: "sig-anchor",
    },
    publicOutcome: overrides.publicOutcome ?? "post_message",
    createdAt: overrides.createdAt ?? "2026-04-09T00:00:00.000Z",
    ...(overrides.publishedSignalId
      ? { publishedSignalId: overrides.publishedSignalId }
      : {}),
    ...(overrides.replyToSignalId
      ? { replyToSignalId: overrides.replyToSignalId }
      : {}),
    ...(overrides.statusType ? { statusType: overrides.statusType } : {}),
  };
}

function createDispatchExecutionEvidence(
  overrides: Partial<{
    sourceSignalId: string | null;
    dispatchId: string;
    status:
      | "dispatch_recorded"
      | "blocked"
      | "retrying"
      | "failed"
      | "stopped"
      | "unknown";
  }> = {}
) {
  return {
    sourceSignalId: overrides.sourceSignalId ?? "sig-anchor",
    targetDispatches: [
      {
        dispatchId: overrides.dispatchId ?? "dispatch-1",
        dispatchStatus: "succeeded",
        latestAttemptStatus: "succeeded",
        reasonCode: null,
        reasonText: null,
        status: overrides.status ?? "dispatch_recorded",
        targetDisplayName: "Target Agent",
        targetProfileId: "agt_target",
      },
    ],
  };
}

function getIndexedSignal(
  signalIndex: ReturnType<typeof buildSignalIndex>,
  signalId: string
): SignalEnvelope {
  const signal = signalIndex.get(signalId);
  if (!signal) {
    throw new Error(`Expected signal index to include ${signalId}`);
  }
  return signal;
}

describe("space reply workflow projection", () => {
  it("returns null for plain source signals without reply workflow facts", () => {
    const signalIndex = buildSignalIndex([
      createTextSignal({
        id: "sig-plain-text",
        text: "plain source message",
      }),
      {
        v: 1,
        id: "sig-plain-status",
        spaceId: "space-1",
        ts: Date.UTC(2026, 3, 9, 0, 0, 3),
        profile: {
          kind: "agent",
          profileId: "agt_target",
          profileName: "Target Agent",
        },
        type: "signal.status",
        data: {
          actorProfileId: "agt_target",
          dispatchId: "dispatch-plain-status",
          generatedBy: "openmeld",
          status: "working",
          text: "Plain status update",
        },
      } satisfies SignalEnvelope,
      {
        v: 1,
        id: "sig-plain-notice",
        spaceId: "space-1",
        ts: Date.UTC(2026, 3, 9, 0, 0, 4),
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.system_notice",
        data: {
          dispatchId: "dispatch-plain-notice",
          noticeType: "policy_blocked",
          text: "Plain system notice",
          generatedBy: "openmeld",
        },
      } satisfies SignalEnvelope,
    ]);

    expect(
      buildSignalReplyWorkflowProjection({
        signal: getIndexedSignal(signalIndex, "sig-plain-text"),
        membersSnapshot: MEMBERS_SNAPSHOT,
        signalIndex,
      })
    ).toBeNull();
    expect(
      buildSignalReplyWorkflowProjection({
        signal: getIndexedSignal(signalIndex, "sig-plain-status"),
        membersSnapshot: MEMBERS_SNAPSHOT,
        signalIndex,
      })
    ).toBeNull();
    expect(
      buildSignalReplyWorkflowProjection({
        signal: getIndexedSignal(signalIndex, "sig-plain-notice"),
        membersSnapshot: MEMBERS_SNAPSHOT,
        signalIndex,
      })
    ).toBeNull();
  });

  it("builds signal-level workflow projection for signal.text replies", () => {
    const signalIndex = buildSignalIndex([
      createTextSignal({
        id: "sig-anchor",
        text: "anchor message",
      }),
      createTextSignal({
        id: "sig-reply",
        profileId: "agt_target",
        profileName: "Target Agent",
        text: "reply body",
        replyToSignalId: "sig-anchor",
      }),
    ]);

    const projection = buildSignalReplyWorkflowProjection({
      signal: getIndexedSignal(signalIndex, "sig-reply"),
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex,
    });

    expect(projection).toMatchObject({
      publicOutcome: "post_message",
      publishedSignalId: "sig-reply",
      publishedSignalType: "signal.text",
      replyToSignalId: "sig-anchor",
      hasPublicSignal: true,
      hasPublicAgentReplyText: true,
    });
    expect(projection?.replyToContext?.actorDisplayName).toBe("Human Sender");
  });

  it("builds signal-level workflow projection for signal.status and stay_silent notices", () => {
    const signalIndex = buildSignalIndex([
      createTextSignal({
        id: "sig-anchor",
        text: "anchor message",
      }),
      createStatusSignal({
        id: "sig-status",
        dispatchId: "dispatch-1",
        replyToSignalId: "sig-anchor",
      }),
      createSystemNoticeSignal({
        id: "sig-notice",
        dispatchId: "dispatch-1",
        replyToSignalId: "sig-anchor",
        noticeType: "stay_silent",
      }),
    ]);

    const statusProjection = buildSignalReplyWorkflowProjection({
      signal: getIndexedSignal(signalIndex, "sig-status"),
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex,
    });
    const noticeProjection = buildSignalReplyWorkflowProjection({
      signal: getIndexedSignal(signalIndex, "sig-notice"),
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex,
    });

    expect(statusProjection).toMatchObject({
      publicOutcome: "post_status",
      publishedSignalType: "signal.status",
      hasPublicAgentReplyText: false,
    });
    expect(statusProjection?.replyToContext?.actorDisplayName).toBe(
      "Human Sender"
    );

    expect(noticeProjection).toMatchObject({
      publicOutcome: "stay_silent",
      publishedSignalType: "signal.system_notice",
      hasPublicAgentReplyText: false,
    });
    expect(noticeProjection?.replyToContext?.actorDisplayName).toBe(
      "Human Sender"
    );
  });

  it("prefers dispatch lineage over unrelated anchor-matching published signals in updates", () => {
    const dispatchExecution = createDispatchExecutionEvidence();
    const publishedStatusSignal = createStatusSignal({
      id: "sig-status",
      dispatchId: "dispatch-1",
      replyToSignalId: "sig-anchor",
    });
    const unrelatedReplySignal = createTextSignal({
      id: "sig-unrelated",
      profileId: "agt_other",
      profileName: "Other Agent",
      replyToSignalId: "sig-anchor",
      text: "Unrelated public reply to the same anchor.",
    });

    const projection = buildUpdatesReplyWorkflowProjection({
      afterSignalId: "sig-anchor",
      dispatchExecution,
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([
        publishedStatusSignal,
        unrelatedReplySignal,
      ]),
      signals: [publishedStatusSignal, unrelatedReplySignal],
    });

    expect(projection?.publishedSignalId).toBe("sig-status");
    expect(projection?.publishedSignalType).toBe("signal.status");
    expect(projection?.publicOutcome).toBe("post_status");
    expect(projection?.sourceSignalId).toBe("sig-anchor");
  });

  it("falls back to anchor-matching published signals when dispatch evidence is absent", () => {
    const anchorReplySignal = createTextSignal({
      id: "sig-reply",
      profileId: "agt_target",
      profileName: "Target Agent",
      replyToSignalId: "sig-anchor",
      text: "Public reply without dispatch evidence.",
    });

    const projection = buildUpdatesReplyWorkflowProjection({
      afterSignalId: "sig-anchor",
      dispatchExecution: null,
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([anchorReplySignal]),
      signals: [anchorReplySignal],
    });

    expect(projection?.publishedSignalId).toBe("sig-reply");
    expect(projection?.publishedSignalType).toBe("signal.text");
    expect(projection?.publicOutcome).toBe("post_message");
  });

  it("uses the broader signal index when the current updates slice does not include the published signal", () => {
    const anchorSignal = createTextSignal({
      id: "sig-anchor",
      text: "anchor message",
    });
    const publishedReplySignal = createTextSignal({
      id: "sig-published",
      profileId: "agt_target",
      profileName: "Target Agent",
      replyToSignalId: "sig-anchor",
      text: "Published reply outside the current updates slice.",
    });
    const unrelatedSliceSignal = createTextSignal({
      id: "sig-unrelated",
      profileId: "agt_other",
      profileName: "Other Agent",
      text: "Another update in the current slice.",
    });

    const projection = buildUpdatesReplyWorkflowProjection({
      afterSignalId: "sig-anchor",
      dispatchExecution: null,
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([
        anchorSignal,
        unrelatedSliceSignal,
        publishedReplySignal,
      ]),
      signals: [unrelatedSliceSignal],
    });

    expect(projection?.publishedSignalId).toBe("sig-published");
    expect(projection?.publishedSignalType).toBe("signal.text");
    expect(projection?.publicOutcome).toBe("post_message");
  });

  it("keeps archived result public outcome, published signal, and reply context", () => {
    const anchorSignal = createTextSignal({
      id: "sig-anchor",
      text: "@Target Agent(wake) Please help.",
    });
    const result = createDispatchResult({
      publishedSignalId: "sig-published",
    });

    const projection = buildDispatchResultReplyWorkflowProjection({
      result,
      dispatchExecution: createDispatchExecutionEvidence(),
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([anchorSignal]),
    });

    expect(projection).toMatchObject({
      sourceSignalId: "sig-anchor",
      replyToSignalId: "sig-anchor",
      publicOutcome: "post_message",
      publishedSignalId: "sig-published",
      publishedSignalType: "signal.text",
      hasPublicSignal: true,
      hasPublicAgentReplyText: true,
    });
    expect(projection.replyToContext?.actorDisplayName).toBe("Human Sender");
  });

  it("builds a pending projection when dispatch execution exists but no public signal exists yet", () => {
    const projection = buildUpdatesReplyWorkflowProjection({
      afterSignalId: "sig-anchor",
      dispatchExecution: createDispatchExecutionEvidence({
        sourceSignalId: "sig-anchor",
        status: "dispatch_recorded",
      }),
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: null,
      signals: [],
    });

    expect(projection).toMatchObject({
      sourceSignalId: "sig-anchor",
      replyToSignalId: "sig-anchor",
      publicOutcome: null,
      publishedSignalId: null,
      hasPublicSignal: false,
      hasPublicAgentReplyText: false,
    });
  });

  it("builds a pending projection when only reply context exists", () => {
    const anchorSignal = createTextSignal({
      id: "sig-anchor",
      text: "@Target Agent(wake) Please help.",
    });

    const projection = buildUpdatesReplyWorkflowProjection({
      afterSignalId: "sig-anchor",
      dispatchExecution: null,
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([anchorSignal]),
      signals: [],
    });

    expect(projection).not.toBeNull();
    expect(projection?.replyToContext?.actorDisplayName).toBe("Human Sender");
    expect(projection?.hasPublicSignal).toBe(false);
  });

  it("keeps an unresolved stub when only the anchor id is available", () => {
    expect(
      buildUpdatesReplyWorkflowProjection({
        afterSignalId: "sig-anchor",
        dispatchExecution: null,
        membersSnapshot: MEMBERS_SNAPSHOT,
        signalIndex: null,
        signals: [],
      })
    ).toEqual({
      sourceSignalId: "sig-anchor",
      replyToSignalId: "sig-anchor",
      publicOutcome: null,
      publishedSignalId: null,
      publishedSignalType: null,
      hasPublicSignal: false,
      hasPublicAgentReplyText: false,
      dispatchExecution: null,
      replyToContext: {
        signalId: "sig-anchor",
        actorProfileId: null,
        actorProfileKind: null,
        actorDisplayName: null,
        previewText: null,
        relationSummary: null,
        resolved: false,
      },
    });
  });

  it("marks only message-like public outcomes as having public agent reply text", () => {
    expect(
      buildDispatchResultReplyWorkflowProjection({
        result: createDispatchResult({
          publicOutcome: "post_message",
        }),
      }).hasPublicAgentReplyText
    ).toBe(true);
    expect(
      buildDispatchResultReplyWorkflowProjection({
        result: createDispatchResult({
          publicOutcome: "raw_context_sharing",
        }),
      }).hasPublicAgentReplyText
    ).toBe(true);
    expect(
      buildDispatchResultReplyWorkflowProjection({
        result: createDispatchResult({
          publicOutcome: "post_status",
        }),
      }).hasPublicAgentReplyText
    ).toBe(false);
    expect(
      buildDispatchResultReplyWorkflowProjection({
        result: createDispatchResult({
          publicOutcome: "stay_silent",
        }),
      }).hasPublicAgentReplyText
    ).toBe(false);
  });

  it("parses stay_silent and system_notice published signals with stable ranking", () => {
    const staySilentSignal = createSystemNoticeSignal({
      id: "sig-notice",
      dispatchId: "dispatch-1",
      replyToSignalId: "sig-anchor",
      noticeType: "stay_silent",
    });
    const genericNoticeSignal = createSystemNoticeSignal({
      id: "sig-system",
      dispatchId: "dispatch-1",
      replyToSignalId: "sig-anchor",
      noticeType: "policy_blocked",
    });
    const statusSignal = createStatusSignal({
      id: "sig-status",
      dispatchId: "dispatch-1",
      replyToSignalId: "sig-anchor",
    });

    const staySilentProjection = buildUpdatesReplyWorkflowProjection({
      afterSignalId: "sig-anchor",
      dispatchExecution: createDispatchExecutionEvidence(),
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([staySilentSignal]),
      signals: [staySilentSignal],
    });
    const noticeProjection = buildUpdatesReplyWorkflowProjection({
      afterSignalId: "sig-anchor",
      dispatchExecution: createDispatchExecutionEvidence(),
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([genericNoticeSignal]),
      signals: [genericNoticeSignal],
    });
    const rankedProjection = buildUpdatesReplyWorkflowProjection({
      afterSignalId: "sig-anchor",
      dispatchExecution: createDispatchExecutionEvidence(),
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([genericNoticeSignal, statusSignal]),
      signals: [genericNoticeSignal, statusSignal],
    });

    expect(staySilentProjection?.publicOutcome).toBe("stay_silent");
    expect(staySilentProjection?.publishedSignalType).toBe(
      "signal.system_notice"
    );
    expect(noticeProjection?.publicOutcome).toBe("system_notice");
    expect(rankedProjection?.publishedSignalId).toBe("sig-status");
    expect(rankedProjection?.publicOutcome).toBe("post_status");
  });
});
