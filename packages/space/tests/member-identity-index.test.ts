import type { SignalEnvelope } from "@openmeld/protocol";
import { createDaemonRouteObservationSummary } from "@openmeld/schemas";
import { createSpaceMemberAgentExecutionReadiness } from "@openmeld/schemas/testing";
import type {
  SpaceMemberAgentSnapshot,
  SpaceMemberHumanSnapshot,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { createSpaceMemberIdentityIndex } from "../src";
import {
  createTestAgentAgentWakeAvailability,
  createTestAgentWakeRouteRegistration,
} from "./test-agent-public-presence";

const HUMAN_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "agt_22222222-2222-4222-8222-222222222222";
const TARGET_ID = "agt_33333333-3333-4333-8333-333333333333";

describe("space member identity index", () => {
  it("returns an empty index when snapshot and signals are absent", () => {
    expect(createSpaceMemberIdentityIndex({}).byProfileId.size).toBe(0);
    expect(
      createSpaceMemberIdentityIndex({
        snapshot: null,
        signals: null,
      }).byProfileId.size
    ).toBe(0);
  });

  it("indexes snapshot humans and agents as member_snapshot identities", () => {
    const index = createSpaceMemberIdentityIndex({
      snapshot: createSnapshot({
        humans: [
          createHumanMember({
            profileId: HUMAN_ID,
            profileName: "Felix",
          }),
        ],
        agents: [
          createAgentMember({
            profileId: AGENT_ID,
            profileName: "Local Agent",
          }),
        ],
      }),
    });

    expect(index.byProfileId.get(HUMAN_ID)).toEqual({
      profileId: HUMAN_ID,
      profileKind: "human",
      profileName: "Felix",
      source: "member_snapshot",
    });
    expect(index.byProfileId.get(AGENT_ID)).toEqual({
      profileId: AGENT_ID,
      profileKind: "agent",
      profileName: "Local Agent",
      source: "member_snapshot",
    });
  });

  it("registers signal profile identities as signal_history entries", () => {
    const index = createSpaceMemberIdentityIndex({
      signals: [
        createTextSignal({
          id: "sig-1",
          profileId: AGENT_ID,
          profileKind: "agent",
          profileName: "History Agent",
          text: "Hello",
        }),
      ],
    });

    expect(index.byProfileId.get(AGENT_ID)).toEqual({
      profileId: AGENT_ID,
      profileKind: "agent",
      profileName: "History Agent",
      source: "signal_history",
    });
  });

  it("registers signal text target meta identities as signal_history entries", () => {
    const index = createSpaceMemberIdentityIndex({
      signals: [
        createTextSignal({
          id: "sig-1",
          profileId: HUMAN_ID,
          profileKind: "human",
          profileName: "Sender",
          text: "Hello",
          meta: {
            targetProfileId: TARGET_ID,
            targetProfileName: "Target Agent",
            targetProfileKind: "agent",
          },
        }),
      ],
    });

    expect(index.byProfileId.get(TARGET_ID)).toEqual({
      profileId: TARGET_ID,
      profileKind: "agent",
      profileName: "Target Agent",
      source: "signal_history",
    });
  });

  it("lets member snapshot identity override signal history for the same profile id", () => {
    const index = createSpaceMemberIdentityIndex({
      snapshot: createSnapshot({
        agents: [
          createAgentMember({
            profileId: AGENT_ID,
            profileName: "Snapshot Agent",
          }),
        ],
      }),
      signals: [
        createTextSignal({
          id: "sig-1",
          profileId: AGENT_ID,
          profileKind: "agent",
          profileName: "History Agent",
          text: "Hello",
        }),
      ],
    });

    expect(index.byProfileId.get(AGENT_ID)).toEqual({
      profileId: AGENT_ID,
      profileKind: "agent",
      profileName: "Snapshot Agent",
      source: "member_snapshot",
    });
  });

  it("fails fast when the snapshot contains duplicate profile ids", () => {
    expect(() =>
      createSpaceMemberIdentityIndex({
        snapshot: createSnapshot({
          humans: [
            createHumanMember({
              profileId: HUMAN_ID,
              profileName: "Felix",
            }),
            createHumanMember({
              profileId: HUMAN_ID,
              profileName: "Felix Duplicate",
            }),
          ],
        }),
      })
    ).toThrow(
      `Invariant violation: duplicate profile id "${HUMAN_ID}" in space member identity index.`
    );
  });

  it("ignores candidates with blank or missing profile id or profile name", () => {
    const index = createSpaceMemberIdentityIndex({
      signals: [
        createTextSignal({
          id: "sig-1",
          profileId: "   ",
          profileKind: "agent",
          profileName: "Blank Id",
          text: "Hello",
        }),
        createTextSignal({
          id: "sig-2",
          profileId: "agt_missing_name",
          profileKind: "agent",
          profileName: "   ",
          text: "Hello",
        }),
        createTextSignal({
          id: "sig-3",
          profileId: HUMAN_ID,
          profileKind: "human",
          profileName: "Sender",
          text: "Hello",
          meta: {
            targetProfileId: "agt_blank_target",
            targetProfileName: "   ",
            targetProfileKind: "agent",
          },
        }),
      ],
    });

    expect(index.byProfileId.size).toBe(1);
    expect(index.byProfileId.get(HUMAN_ID)?.profileName).toBe("Sender");
  });

  it("normalizes invalid profile kinds to null", () => {
    const index = createSpaceMemberIdentityIndex({
      signals: [
        createTextSignal({
          id: "sig-1",
          profileId: AGENT_ID,
          profileKind: "daemon",
          profileName: "Odd Agent",
          text: "Hello",
          meta: {
            targetProfileId: TARGET_ID,
            targetProfileName: "Odd Target",
            targetProfileKind: "weird",
          },
        }),
      ],
    });

    expect(index.byProfileId.get(AGENT_ID)?.profileKind).toBeNull();
    expect(index.byProfileId.get(TARGET_ID)?.profileKind).toBeNull();
  });

  it("keeps the latest signal-history identity for repeated profile ids until snapshot overrides it", () => {
    const index = createSpaceMemberIdentityIndex({
      signals: [
        createTextSignal({
          id: "sig-1",
          profileId: AGENT_ID,
          profileKind: "agent",
          profileName: "Early Agent",
          text: "Hello",
        }),
        createTextSignal({
          id: "sig-2",
          profileId: AGENT_ID,
          profileKind: "agent",
          profileName: "Later Agent",
          text: "Hello again",
        }),
      ],
    });

    expect(index.byProfileId.get(AGENT_ID)).toEqual({
      profileId: AGENT_ID,
      profileKind: "agent",
      profileName: "Later Agent",
      source: "signal_history",
    });
  });
});

function createSnapshot(input: {
  humans?: SpaceMemberHumanSnapshot[];
  agents?: SpaceMemberAgentSnapshot[];
}): SpaceMembersSnapshot {
  const humans = input.humans ?? [];
  const agents = input.agents ?? [];
  const wakeableAgentCount = agents.filter(
    (agent) => agent.agentWakeAvailability?.status === "available_for_wake"
  ).length;
  const offlineAgentCount = agents.filter(
    (agent) => agent.agentWakeAvailability?.status === "offline_for_wake"
  ).length;
  const unavailableAgentCount = agents.filter(
    (agent) => agent.agentWakeAvailability?.status === "unavailable_for_wake"
  ).length;

  return {
    spaceId: "space-1",
    generatedAt: "2026-04-09T00:00:00.000Z",
    summary: {
      totalCount: humans.length + agents.length,
      humanCount: humans.length,
      agentCount: agents.length,
      liveNowCount: [...humans, ...agents].filter((member) => member.liveNow)
        .length,
      offlineAgentCount,
      unavailableAgentCount,
      wakeableAgentCount,
    },
    humans,
    agents,
  };
}

function createHumanMember(input: {
  profileId: string;
  profileName: string;
}): SpaceMemberHumanSnapshot {
  return {
    profileId: input.profileId,
    profileName: input.profileName,
    profileKind: "human",
    mentionAlias: null,
    status: "active",
    memberSource: "space_creator",
    memberSourceLabel: "Creator",
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
    ownerUserId: "usr-human",
    ownerName: input.profileName,
  };
}

function createAgentMember(input: {
  profileId: string;
  profileName: string;
}): SpaceMemberAgentSnapshot {
  const observedAt = "2026-04-09T00:00:00.000Z";

  return {
    profileId: input.profileId,
    profileName: input.profileName,
    profileKind: "agent",
    mentionAlias: null,
    status: "active",
    memberSource: "added_by_member",
    memberSourceLabel: "Added by Felix",
    addedAt: "2026-04-09T00:00:00.000Z",
    removedAt: null,
    createdAt: "2026-04-09T00:00:00.000Z",
    updatedAt: "2026-04-09T00:00:00.000Z",
    addedByProfileId: HUMAN_ID,
    addedByOwnerUserId: "usr-felix",
    addedByDisplayName: "Felix",
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: null,
    lastSeenLabel: null,
    liveNow: false,
    ownerUserId: "usr-felix",
    ownerName: "Felix",
    agentControllerRef: "builtin:codex",
    agentControllerConversationId: null,
    agentWakeAvailability:
      createTestAgentAgentWakeAvailability("available_for_wake"),
    ownerWakeDiagnostics: {
      agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
        agentProfileId: input.profileId,
        displayState: "ready",
        reasonCodes: [],
      }),
      agentWakeRouteRegistration: createTestAgentWakeRouteRegistration(),
      wakeRouteEvidence: createDaemonRouteObservationSummary({
        observedAt,
        status: "online",
      }),
      wakeRouteStatus: createReadyWakeRouteStatus(),
      state: "none",
    },
  };
}

function createReadyWakeRouteStatus() {
  return {
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-test",
    deviceId: "device-test",
    lane: "dev-local",
    lastHeartbeatMs: 1_768_000_000_000,
    leaseEpoch: 1,
    status: "ready",
  } as const;
}

function createTextSignal(input: {
  id: string;
  profileId?: string;
  profileKind?: string;
  profileName?: string;
  text: string;
  meta?: Record<string, unknown>;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-1",
    ts: Date.UTC(2026, 3, 9, 12, 0, 0),
    profile: {
      kind: readSignalProfileKind(input.profileKind),
      profileId: input.profileId ?? HUMAN_ID,
      profileName: input.profileName ?? "Felix",
    },
    type: "signal.text",
    data: {
      text: input.text,
      ...(input.meta ? { meta: input.meta } : {}),
    },
  } as SignalEnvelope;
}

function readSignalProfileKind(
  profileKind: string | undefined
): SignalEnvelope["profile"]["kind"] {
  return (profileKind ?? "human") as SignalEnvelope["profile"]["kind"];
}
