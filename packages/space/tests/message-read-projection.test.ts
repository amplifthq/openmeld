import type { SignalEnvelope, SignalTextReplyTo } from "@openmeld/protocol";
import { createDaemonRouteObservationSummary } from "@openmeld/schemas";
import { createSpaceMemberAgentExecutionReadiness } from "@openmeld/schemas/testing";
import type {
  DispatchResult,
  MessageEnvelope,
  SpaceIdentityDirectory,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildDispatchResultMessageReadProjection,
  buildSignalIndex,
  buildSignalMessageReadProjection,
  buildSpaceMessageReadRelationSummary,
  resolveReplyToContext,
  type SpaceMessageReadTargetRef,
} from "../src";
import {
  createTestAgentAgentWakeAvailability,
  createTestAgentWakeRouteRegistration,
} from "./test-agent-public-presence";

const MEMBERS_SNAPSHOT: SpaceMembersSnapshot = {
  spaceId: "space-1",
  generatedAt: "2026-04-02T00:00:00.000Z",
  summary: {
    totalCount: 2,
    humanCount: 1,
    agentCount: 1,
    liveNowCount: 1,
    wakeableAgentCount: 1,
    offlineAgentCount: 0,
  },
  humans: [
    {
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Felix",
      profileKind: "human",
      status: "active",
      memberSource: "joined_directly",
      memberSourceLabel: "Joined directly",
      addedAt: "2026-04-02T00:00:00.000Z",
      removedAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
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
      liveNow: true,
      mentionAlias: null,
      ownerUserId: "user-felix",
      ownerName: "Felix",
    },
  ],
  agents: [
    {
      profileId: "agt_22222222-2222-2222-2222-222222222222",
      profileName: "Phase 2a Agent",
      profileKind: "agent",
      status: "active",
      memberSource: "added_by_member",
      memberSourceLabel: "Added by member",
      addedAt: "2026-04-02T00:00:00.000Z",
      removedAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      addedByProfileId: "11111111-1111-1111-1111-111111111111",
      addedByOwnerUserId: "user-felix",
      addedByDisplayName: "Felix",
      removedByProfileId: null,
      removedByOwnerUserId: null,
      removalReason: null,
      firstEnteredAt: null,
      lastEnteredAt: null,
      lastSeenAt: null,
      lastSeenLabel: null,
      liveNow: false,
      mentionAlias: null,
      ownerUserId: "user-felix",
      ownerName: "Felix",
      agentControllerRef: "builtin:codex",
      agentControllerConversationId: null,
      workingDirectory: null,
      agentWakeAvailability:
        createTestAgentAgentWakeAvailability("available_for_wake"),
      ownerWakeDiagnostics: {
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          agentProfileId: "agt_22222222-2222-2222-2222-222222222222",
          displayState: "ready",
          reasonCodes: [],
        }),
        agentWakeRouteRegistration: createTestAgentWakeRouteRegistration(),
        wakeRouteEvidence: createDaemonRouteObservationSummary({
          observedAt: "2026-04-02T00:00:00.000Z",
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

const IDENTITY_DIRECTORY: SpaceIdentityDirectory = {
  spaceId: "space-1",
  generatedAt: "2026-04-02T00:00:00.000Z",
  entries: [
    {
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Felix",
      profileKind: "human",
      mentionAlias: null,
      ownerUserId: "user-felix",
      ownerName: "Felix",
      agentControllerRef: null,
    },
    {
      profileId: "agt_22222222-2222-2222-2222-222222222222",
      profileName: "Phase 2a Agent",
      profileKind: "agent",
      mentionAlias: null,
      ownerUserId: "user-felix",
      ownerName: "Felix",
      agentControllerRef: "builtin:codex",
    },
  ],
};

function createMessageEnvelope(
  input?: Partial<MessageEnvelope>
): MessageEnvelope {
  return {
    text: input?.text ?? "Hello",
    activationTargets: input?.activationTargets ?? [],
    referenceTargets: input?.referenceTargets ?? [],
    ...(input?.replyToSignalId
      ? { replyToSignalId: input.replyToSignalId }
      : {}),
  };
}

function createTargetRef(
  profileId: string,
  displayName: string,
  relation: SpaceMessageReadTargetRef["displaySource"] = "member_snapshot"
): SpaceMessageReadTargetRef {
  return {
    profileId,
    profileKind: "agent",
    displayName,
    displaySource: relation,
  };
}

function createTextSignal(input: {
  id: string;
  profileId?: string;
  profileName?: string;
  text: string;
  messageEnvelope?: MessageEnvelope;
  meta?: Record<string, unknown>;
  replyTo?: SignalTextReplyTo;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-1",
    ts: Date.UTC(2026, 3, 2, 12, 0, 0),
    profile: {
      kind: input.profileId?.startsWith("agt_") ? "agent" : "human",
      profileId: input.profileId ?? "11111111-1111-1111-1111-111111111111",
      profileName: input.profileName ?? "Felix",
    },
    type: "signal.text",
    data: {
      text: input.text,
      ...(input.meta ? { meta: input.meta } : {}),
      ...(input.messageEnvelope
        ? { messageEnvelope: input.messageEnvelope }
        : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    },
  };
}

describe("space message read projection", () => {
  it("projects canonical targets from messageEnvelope using member display names", () => {
    const signal = createTextSignal({
      id: "sig-1",
      text: "Hello",
      messageEnvelope: createMessageEnvelope({
        text: "Hello",
        activationTargets: ["agt_22222222-2222-2222-2222-222222222222"],
        referenceTargets: [
          "11111111-1111-1111-1111-111111111111",
          "agt_99999999-9999-4999-8999-999999999999",
        ],
      }),
    });

    const projection = buildSignalMessageReadProjection({
      signal,
      membersSnapshot: MEMBERS_SNAPSHOT,
    });

    expect(projection.wakeTargets).toEqual([
      {
        profileId: "agt_22222222-2222-2222-2222-222222222222",
        profileKind: "agent",
        displayName: "Phase 2a Agent",
        displaySource: "member_snapshot",
      },
    ]);
    expect(projection.referenceTargets).toEqual([
      {
        profileId: "11111111-1111-1111-1111-111111111111",
        profileKind: "human",
        displayName: "Felix",
        displaySource: "member_snapshot",
      },
      {
        profileId: "agt_99999999-9999-4999-8999-999999999999",
        profileKind: null,
        displayName: "agt_99999999-9999-4999-8999-999999999999",
        displaySource: "profile_id",
        resolutionReasonCode: "addressing.target_unresolved",
        resolutionStatus: "unresolved",
      },
    ]);
  });

  it("projects canonical targets from identity directory without availability fields", () => {
    const signal = createTextSignal({
      id: "sig-identity-directory-target",
      text: "Hello",
      messageEnvelope: createMessageEnvelope({
        text: "Hello",
        activationTargets: ["agt_22222222-2222-2222-2222-222222222222"],
      }),
    });

    const projection = buildSignalMessageReadProjection({
      signal,
      identityDirectory: IDENTITY_DIRECTORY,
    });

    expect(projection.wakeTargets).toEqual([
      {
        profileId: "agt_22222222-2222-2222-2222-222222222222",
        profileKind: "agent",
        displayName: "Phase 2a Agent",
        displaySource: "identity_directory",
      },
    ]);
    expect(JSON.stringify(IDENTITY_DIRECTORY)).not.toContain(
      "ownerWakeDiagnostics"
    );
    expect(JSON.stringify(IDENTITY_DIRECTORY)).not.toContain(
      "agentWakeAvailability"
    );
  });

  it("keeps unresolved relation targets structured without failing the transcript", () => {
    const signal = createTextSignal({
      id: "sig-unresolved-target",
      text: "Historical mention to a missing target",
      messageEnvelope: createMessageEnvelope({
        text: "Historical mention to a missing target",
        referenceTargets: ["agt_88888888-8888-4888-8888-888888888888"],
      }),
    });

    const projection = buildSignalMessageReadProjection({
      signal,
      membersSnapshot: MEMBERS_SNAPSHOT,
    });

    expect(projection.text).toBe("Historical mention to a missing target");
    expect(projection.referenceTargets).toEqual([
      {
        profileId: "agt_88888888-8888-4888-8888-888888888888",
        profileKind: null,
        displayName: "agt_88888888-8888-4888-8888-888888888888",
        displaySource: "profile_id",
        resolutionReasonCode: "addressing.target_unresolved",
        resolutionStatus: "unresolved",
      },
    ]);
  });

  it("keeps removed member display names in relation targets", () => {
    const removedSnapshot: SpaceMembersSnapshot = {
      ...MEMBERS_SNAPSHOT,
      summary: {
        ...MEMBERS_SNAPSHOT.summary,
        totalCount: 4,
        humanCount: 2,
        agentCount: 2,
      },
      humans: [
        ...MEMBERS_SNAPSHOT.humans,
        {
          profileId: "33333333-3333-3333-3333-333333333333",
          profileName: "Removed Human",
          profileKind: "human",
          status: "removed",
          memberSource: "joined_directly",
          memberSourceLabel: "Joined directly",
          addedAt: "2026-04-02T00:00:00.000Z",
          removedAt: "2026-04-03T00:00:00.000Z",
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-03T00:00:00.000Z",
          addedByProfileId: null,
          addedByOwnerUserId: null,
          addedByDisplayName: null,
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: "Left",
          firstEnteredAt: null,
          lastEnteredAt: null,
          lastSeenAt: null,
          lastSeenLabel: null,
          liveNow: false,
          mentionAlias: null,
          ownerUserId: "user-removed-human",
          ownerName: "Removed Human",
        },
      ],
      agents: [
        ...MEMBERS_SNAPSHOT.agents,
        {
          profileId: "agt_44444444-4444-4444-4444-444444444444",
          profileName: "Removed Agent",
          profileKind: "agent",
          status: "removed",
          memberSource: "added_by_member",
          memberSourceLabel: "Added by member",
          addedAt: "2026-04-02T00:00:00.000Z",
          removedAt: "2026-04-03T00:00:00.000Z",
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-03T00:00:00.000Z",
          addedByProfileId: "11111111-1111-1111-1111-111111111111",
          addedByOwnerUserId: "user-felix",
          addedByDisplayName: "Felix",
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: "Removed",
          firstEnteredAt: null,
          lastEnteredAt: null,
          lastSeenAt: null,
          lastSeenLabel: null,
          liveNow: false,
          mentionAlias: null,
          ownerUserId: "user-removed-agent",
          ownerName: "Removed Agent",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: null,
          workingDirectory: null,
          agentWakeAvailability: createTestAgentAgentWakeAvailability(
            "unavailable_for_wake"
          ),
          ownerWakeDiagnostics: {
            agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
              agentProfileId: "agt_44444444-4444-4444-4444-444444444444",
              displayState: "not_ready",
              reasonCodes: ["profile.unbound"],
            }),
            agentWakeRouteRegistration: createTestAgentWakeRouteRegistration({
              status: "unavailable",
              reasonCode: "profile.unbound",
              reportedAtMs: null,
              daemonSessionId: null,
              deviceId: null,
              lane: null,
              serviceVersion: null,
            }),
            wakeRouteEvidence: createDaemonRouteObservationSummary({
              observedAt: "2026-04-03T00:00:00.000Z",
              status: "offline",
            }),
            wakeRouteStatus: { status: "offline" },
            state: "action_required",
          },
        },
      ],
    };
    const signal = createTextSignal({
      id: "sig-removed-targets",
      text: "Historical relations",
      messageEnvelope: createMessageEnvelope({
        text: "Historical relations",
        activationTargets: ["agt_44444444-4444-4444-4444-444444444444"],
        referenceTargets: [
          "33333333-3333-3333-3333-333333333333",
          "agt_22222222-2222-2222-2222-222222222222",
        ],
      }),
    });

    const projection = buildSignalMessageReadProjection({
      signal,
      membersSnapshot: removedSnapshot,
    });

    expect(projection.wakeTargets).toEqual([
      {
        profileId: "agt_44444444-4444-4444-4444-444444444444",
        profileKind: "agent",
        displayName: "Removed Agent",
        displaySource: "member_snapshot",
      },
    ]);
    expect(projection.referenceTargets).toEqual([
      {
        profileId: "33333333-3333-3333-3333-333333333333",
        profileKind: "human",
        displayName: "Removed Human",
        displaySource: "member_snapshot",
      },
      {
        profileId: "agt_22222222-2222-2222-2222-222222222222",
        profileKind: "agent",
        displayName: "Phase 2a Agent",
        displaySource: "member_snapshot",
      },
    ]);
  });

  it("resolves removed member relation targets from signal history when current snapshot no longer includes them", () => {
    const currentSnapshot: SpaceMembersSnapshot = {
      ...MEMBERS_SNAPSHOT,
      summary: {
        ...MEMBERS_SNAPSHOT.summary,
        totalCount: 2,
        humanCount: 1,
        agentCount: 1,
      },
    };
    const joinNotice = createTextSignal({
      id: "sig-join-notice",
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Felix",
      text: "Felix added Removed Agent to this space.",
      meta: {
        purpose: "space_membership_join_notice",
        targetProfileId: "agt_44444444-4444-4444-4444-444444444444",
        targetProfileName: "Removed Agent",
        targetProfileKind: "agent",
      },
    });
    const removedTargetSignal = createTextSignal({
      id: "sig-removed-target-still-readable",
      text: "@Removed Agent(wake)",
      messageEnvelope: createMessageEnvelope({
        text: "@Removed Agent(wake)",
        activationTargets: ["agt_44444444-4444-4444-4444-444444444444"],
      }),
    });
    const removeNotice = createTextSignal({
      id: "sig-remove-notice",
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Felix",
      text: "Felix removed Removed Agent from this space.",
      meta: {
        purpose: "space_membership_remove_notice",
        targetProfileId: "agt_44444444-4444-4444-4444-444444444444",
        targetProfileName: "Removed Agent",
        targetProfileKind: "agent",
      },
    });

    const signalIndex = buildSignalIndex([
      joinNotice,
      removedTargetSignal,
      removeNotice,
    ]);
    const projection = buildSignalMessageReadProjection({
      signal: removedTargetSignal,
      membersSnapshot: currentSnapshot,
      signalIndex,
    });

    expect(projection.wakeTargets).toEqual([
      {
        profileId: "agt_44444444-4444-4444-4444-444444444444",
        profileKind: "agent",
        displayName: "Removed Agent",
        displaySource: "signal_history",
        resolutionReasonCode: "addressing.target_stale_signal_history",
        resolutionStatus: "stale",
      },
    ]);
  });

  it("marks signal-history targets with missing kind as unresolved instead of guessing from profile id", () => {
    const historicalTargetSignal = createTextSignal({
      id: "sig-historical-target-unknown-kind",
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Felix",
      text: "Felix added an older target.",
      meta: {
        purpose: "space_membership_join_notice",
        targetProfileId: "agt_66666666-6666-6666-6666-666666666666",
        targetProfileName: "Unknown Kind Target",
        targetProfileKind: "daemon",
      },
    });
    const sourceSignal = createTextSignal({
      id: "sig-unknown-kind-target",
      text: "@Unknown Kind Target(reference)",
      messageEnvelope: createMessageEnvelope({
        text: "@Unknown Kind Target(reference)",
        referenceTargets: ["agt_66666666-6666-6666-6666-666666666666"],
      }),
    });

    const projection = buildSignalMessageReadProjection({
      signal: sourceSignal,
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([historicalTargetSignal, sourceSignal]),
    });

    expect(projection.referenceTargets).toEqual([
      {
        profileId: "agt_66666666-6666-6666-6666-666666666666",
        profileKind: null,
        displayName: "Unknown Kind Target",
        displaySource: "signal_history",
        resolutionReasonCode: "addressing.target_kind_unresolved",
        resolutionStatus: "unresolved",
      },
    ]);
  });

  it("marks member-snapshot targets with missing kind as unresolved instead of guessing from profile id", () => {
    const brokenAgentSnapshot: SpaceMembersSnapshot = {
      ...MEMBERS_SNAPSHOT,
      agents: [
        {
          ...MEMBERS_SNAPSHOT.agents[0],
          profileKind: undefined,
        } as unknown as SpaceMembersSnapshot["agents"][number],
      ],
    };
    const signal = createTextSignal({
      id: "sig-member-snapshot-target-unknown-kind",
      text: "@Phase 2a Agent(reference)",
      messageEnvelope: createMessageEnvelope({
        text: "@Phase 2a Agent(reference)",
        referenceTargets: ["agt_22222222-2222-2222-2222-222222222222"],
      }),
    });

    const projection = buildSignalMessageReadProjection({
      signal,
      membersSnapshot: brokenAgentSnapshot,
    });

    expect(projection.referenceTargets).toEqual([
      {
        profileId: "agt_22222222-2222-2222-2222-222222222222",
        profileKind: null,
        displayName: "Phase 2a Agent",
        displaySource: "member_snapshot",
        resolutionReasonCode: "addressing.target_kind_unresolved",
        resolutionStatus: "unresolved",
      },
    ]);
  });

  it("resolves replyToContext from signalIndex using messageEnvelope.replyToSignalId", () => {
    const repliedTo = createTextSignal({
      id: "sig-origin",
      profileId: "agt_22222222-2222-2222-2222-222222222222",
      profileName: "Phase 2a Agent",
      text: "Earlier context for reply",
    });
    const reply = createTextSignal({
      id: "sig-reply",
      text: "Reply body",
      messageEnvelope: createMessageEnvelope({
        text: "Reply body",
        replyToSignalId: "sig-origin",
      }),
    });

    const projection = buildSignalMessageReadProjection({
      signal: reply,
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([repliedTo, reply]),
    });

    expect(projection.replyToSignalId).toBe("sig-origin");
    expect(projection.replyToContext).toEqual({
      signalId: "sig-origin",
      actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
      actorProfileKind: "agent",
      actorDisplayName: "Phase 2a Agent",
      previewText: "Earlier context for reply",
      relationSummary: null,
      resolved: true,
    });
  });

  it("keeps removed reply actors readable in replyToContext", () => {
    const removedSnapshot: SpaceMembersSnapshot = {
      ...MEMBERS_SNAPSHOT,
      summary: {
        ...MEMBERS_SNAPSHOT.summary,
        totalCount: 3,
        agentCount: 2,
      },
      agents: [
        ...MEMBERS_SNAPSHOT.agents,
        {
          profileId: "agt_44444444-4444-4444-4444-444444444444",
          profileName: "Removed Agent",
          profileKind: "agent",
          status: "removed",
          memberSource: "added_by_member",
          memberSourceLabel: "Added by member",
          addedAt: "2026-04-02T00:00:00.000Z",
          removedAt: "2026-04-03T00:00:00.000Z",
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-03T00:00:00.000Z",
          addedByProfileId: null,
          addedByOwnerUserId: null,
          addedByDisplayName: null,
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: "Removed",
          firstEnteredAt: null,
          lastEnteredAt: null,
          lastSeenAt: null,
          lastSeenLabel: null,
          liveNow: false,
          mentionAlias: null,
          ownerUserId: "user-removed-agent",
          ownerName: "Removed Agent",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: null,
          workingDirectory: null,
          agentWakeAvailability: createTestAgentAgentWakeAvailability(
            "unavailable_for_wake"
          ),
          ownerWakeDiagnostics: {
            agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
              agentProfileId: "agt_44444444-4444-4444-4444-444444444444",
              displayState: "not_ready",
              reasonCodes: ["profile.unbound"],
            }),
            agentWakeRouteRegistration: createTestAgentWakeRouteRegistration({
              status: "unavailable",
              reasonCode: "profile.unbound",
              reportedAtMs: null,
              daemonSessionId: null,
              deviceId: null,
              lane: null,
              serviceVersion: null,
            }),
            wakeRouteEvidence: createDaemonRouteObservationSummary({
              observedAt: "2026-04-03T00:00:00.000Z",
              status: "offline",
            }),
            wakeRouteStatus: { status: "offline" },
            state: "action_required",
          },
        },
      ],
    };
    const repliedTo = createTextSignal({
      id: "sig-removed-origin",
      profileId: "agt_44444444-4444-4444-4444-444444444444",
      profileName: "Removed Agent",
      text: "Earlier context for removed reply actor",
    });
    const reply = createTextSignal({
      id: "sig-removed-reply",
      text: "Reply body",
      messageEnvelope: createMessageEnvelope({
        text: "Reply body",
        replyToSignalId: "sig-removed-origin",
      }),
    });

    const projection = buildSignalMessageReadProjection({
      signal: reply,
      membersSnapshot: removedSnapshot,
      signalIndex: buildSignalIndex([repliedTo, reply]),
    });

    expect(projection.replyToContext?.actorDisplayName).toBe("Removed Agent");
  });

  it("does not throw when read projection sees duplicated legacy target handles", () => {
    const duplicatedWakeTokenSnapshot: SpaceMembersSnapshot = {
      ...MEMBERS_SNAPSHOT,
      summary: {
        ...MEMBERS_SNAPSHOT.summary,
        totalCount: 3,
        agentCount: 2,
      },
      agents: [
        ...MEMBERS_SNAPSHOT.agents,
        {
          profileId: "agt_55555555-5555-5555-5555-555555555555",
          profileName: "Second Agent",
          profileKind: "agent",
          status: "active",
          memberSource: "added_by_member",
          memberSourceLabel: "Added by member",
          addedAt: "2026-04-02T00:00:00.000Z",
          removedAt: null,
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-02T00:00:00.000Z",
          addedByProfileId: "11111111-1111-1111-1111-111111111111",
          addedByOwnerUserId: "user-felix",
          addedByDisplayName: "Felix",
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: null,
          firstEnteredAt: null,
          lastEnteredAt: null,
          lastSeenAt: null,
          lastSeenLabel: null,
          liveNow: false,
          mentionAlias: null,
          ownerUserId: "user-second-agent",
          ownerName: "Second Agent",
          agentControllerRef: "builtin:claude",
          agentControllerConversationId: null,
          workingDirectory: null,
          agentWakeAvailability:
            createTestAgentAgentWakeAvailability("available_for_wake"),
          ownerWakeDiagnostics: {
            agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
              agentProfileId: "agt_55555555-5555-5555-5555-555555555555",
              displayState: "ready",
              reasonCodes: [],
            }),
            agentWakeRouteRegistration: createTestAgentWakeRouteRegistration(),
            wakeRouteEvidence: createDaemonRouteObservationSummary({
              observedAt: "2026-04-02T00:00:00.000Z",
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
    const signal = createTextSignal({
      id: "sig-duplicate-mention-label",
      text: "Hello",
      messageEnvelope: createMessageEnvelope({
        text: "Hello",
        activationTargets: [
          "agt_22222222-2222-2222-2222-222222222222",
          "agt_55555555-5555-5555-5555-555555555555",
        ],
      }),
    });

    const projection = buildSignalMessageReadProjection({
      signal,
      membersSnapshot: duplicatedWakeTokenSnapshot,
    });

    expect(projection.wakeTargets).toEqual([
      {
        profileId: "agt_22222222-2222-2222-2222-222222222222",
        profileKind: "agent",
        displayName: "Phase 2a Agent",
        displaySource: "member_snapshot",
      },
      {
        profileId: "agt_55555555-5555-5555-5555-555555555555",
        profileKind: "agent",
        displayName: "Second Agent",
        displaySource: "member_snapshot",
      },
    ]);
  });

  it("projects dispatch result replyTo from archived messageEnvelope even when top-level replyToSignalId is absent", () => {
    const result: DispatchResult = {
      resultRef: "result-1",
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
      actorName: "Phase 2a Agent",
      resultKind: "text",
      finalText: "Final text",
      messageEnvelope: createMessageEnvelope({
        text: "Final text",
        replyToSignalId: "sig-origin",
      }),
      publicOutcome: "post_message",
      createdAt: "2026-04-02T00:00:00.000Z",
    };

    const projection = buildDispatchResultMessageReadProjection({
      result,
      membersSnapshot: MEMBERS_SNAPSHOT,
    });

    expect(projection.replyToSignalId).toBe("sig-origin");
    expect(projection.replyToContext).toEqual({
      signalId: "sig-origin",
      actorProfileId: null,
      actorProfileKind: null,
      actorDisplayName: null,
      previewText: null,
      relationSummary: null,
      resolved: false,
    });
  });

  it("keeps relation summary order frozen as Wake, Reference, then Mention", () => {
    expect(
      buildSpaceMessageReadRelationSummary({
        wakeTargets: [createTargetRef("agt-1", "Wake Agent")],
        referenceTargets: [createTargetRef("agt-2", "Reference Agent")],
        mentionTargets: [createTargetRef("hum-1", "Felix")],
      })
    ).toEqual([
      {
        relation: "wake",
        targets: [createTargetRef("agt-1", "Wake Agent")],
      },
      {
        relation: "reference",
        targets: [createTargetRef("agt-2", "Reference Agent")],
      },
      {
        relation: "mention",
        targets: [createTargetRef("hum-1", "Felix")],
      },
    ]);
  });

  it("falls back to signal.data.replyTo when signalIndex is absent", () => {
    const fallbackReplyTo: SignalTextReplyTo = {
      signalId: "sig-fallback",
      profileId: "agt_22222222-2222-2222-2222-222222222222",
      profileKind: "agent",
      profileName: "Phase 2a Agent",
      previewText: "fallback preview",
    };

    expect(
      resolveReplyToContext({
        replyToSignalId: "sig-fallback",
        signalIndex: null,
        memberIdentityIndex: null,
        fallbackReplyTo,
      })
    ).toEqual({
      signalId: "sig-fallback",
      actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
      actorProfileKind: "agent",
      actorDisplayName: "Phase 2a Agent",
      previewText: "fallback preview",
      relationSummary: null,
      resolved: false,
    });
  });

  it("returns an unresolved stub when neither signal history nor fallback replyTo is available", () => {
    expect(
      resolveReplyToContext({
        replyToSignalId: "sig-missing",
        signalIndex: null,
        memberIdentityIndex: null,
        fallbackReplyTo: null,
      })
    ).toEqual({
      signalId: "sig-missing",
      actorProfileId: null,
      actorProfileKind: null,
      actorDisplayName: null,
      previewText: null,
      relationSummary: null,
      resolved: false,
    });
  });
});
