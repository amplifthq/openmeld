import { describe, expect, it } from "vitest";
import { spaceMembersEventSchema } from "../../src/index";
import { createSpaceMemberAgentExecutionReadiness } from "../../src/testing/space-members";

describe("agent-view space members schema", () => {
  it("accepts canonical system.space.members event", () => {
    const agentExecutionReadiness = createSpaceMemberAgentExecutionReadiness({
      agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
      displayState: "ready",
      reasonCodes: [],
    });
    const wakeRouteEvidence = {
      observedAt: "2026-03-06T00:01:00.000Z",
      reasonCode: "online",
      status: "online",
    } as const;
    const result = spaceMembersEventSchema.safeParse({
      type: "system.space.members",
      payload: {
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
        },
        humans: [
          {
            profileId: "11111111-1111-4111-8111-111111111111",
            profileName: "Felix",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "joined_directly",
            memberSourceLabel: "Joined directly",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-06T00:00:00.000Z",
            lastEnteredAt: "2026-03-06T00:00:00.000Z",
            lastSeenAt: "2026-03-06T00:01:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: true,
            ownerUserId: "usr-felix",
            ownerName: "Felix",
          },
        ],
        agents: [
          {
            profileId: "agt_33333333-3333-4333-8333-333333333333",
            profileName: "Ops Bot",
            profileKind: "agent",
            mentionAlias: null,
            status: "active",
            memberSource: "joined_directly",
            memberSourceLabel: "Joined directly",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-06T00:00:00.000Z",
            lastEnteredAt: "2026-03-06T00:00:00.000Z",
            lastSeenAt: "2026-03-06T00:01:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: false,
            ownerUserId: "usr-felix",
            ownerName: "Felix",
            agentControllerRef: "builtin:codex",
            agentControllerConversationId: "ctx-1",
            agentWakeAvailability: {
              action: "none",
              badgeLabel: "Available",
              category: "available",
              isRefreshing: false,
              label: "Available for Wake",
              phase: "available",
              reasonCode: "agent_execution.ready",
              status: "available_for_wake",
              summary: "Available for Wake",
              tooltip: "Available for Wake",
            },
            ownerWakeDiagnostics: {
              agentWakeRouteRegistration: {
                status: "registered",
                reasonCode: null,
                reportedAtMs: 1_777_000_000_000,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-1",
                lane: "dev-local",
                serviceVersion: "0.7.57",
              },
              state: "none",
              agentExecutionReadiness,
              wakeRouteEvidence,
              wakeRouteStatus: {
                connectionGeneration: 1,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-1",
                lane: "dev-local",
                lastHeartbeatMs: 1_768_000_000_000,
                leaseEpoch: 1,
                status: "ready",
              },
            },
          },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = spaceMembersEventSchema.safeParse({
      type: "system.space.members",
      payload: {
        spaceId: "space-1",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 0,
          humanCount: 0,
          agentCount: 0,
          liveNowCount: 0,
        },
        humans: [],
        agents: [],
      },
      extra: true,
    });
    expect(result.success).toBe(false);
  });
});
