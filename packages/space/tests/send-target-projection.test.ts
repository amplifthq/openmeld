import {
  createSpaceMemberAgentExecutionReadiness,
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
  SpaceMemberAgentSnapshot,
  SpaceMemberHumanSnapshot,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { listSpaceSendTargets, listSpaceTargetCatalog } from "../src";
import { createTestAgentAgentWakeAvailability } from "./test-agent-public-presence";

describe("space send target projection", () => {
  it("forwards the shared target catalog entries without changing their semantics", () => {
    const snapshot = createSnapshot({
      humans: [
        createHumanMember({
          profileId: "22222222-2222-4222-8222-222222222222",
          profileName: "Budget Analyst",
          mentionAlias: "budget_analyst",
        }),
      ],
      agents: [
        createAgentMember({
          profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          profileName: "Ops Bot",
          mentionAlias: "ops_alpha",
        }),
        createAgentMember({
          agentExecutionReadiness: createMissingBindingAgentExecutionReadiness(
            "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
          ),
          profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          profileName: "Ops Bot",
          mentionAlias: "ops_bravo",
          wakeabilityStatus: "blocked",
        }),
      ],
    });

    expect(listSpaceSendTargets(snapshot)).toEqual(
      listSpaceTargetCatalog(snapshot)
    );
  });

  it("returns a new array so consumers can sort locally without mutating the shared catalog list", () => {
    const snapshot = createSnapshot({
      agents: [
        createAgentMember({
          profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          profileName: "Ops Bot",
        }),
      ],
    });

    const catalogEntries = listSpaceTargetCatalog(snapshot);
    const sendTargets = listSpaceSendTargets(snapshot);

    expect(sendTargets).toEqual(catalogEntries);
    expect(sendTargets).not.toBe(catalogEntries);

    sendTargets.sort((left, right) =>
      right.primaryMentionLabel.localeCompare(left.primaryMentionLabel)
    );

    expect(catalogEntries.map((entry) => entry.primaryMentionLabel)).toEqual([
      "Ops Bot",
    ]);
  });

  it("keeps wake support and wake availability as separate semantics for blocked agents", () => {
    const [target] = listSpaceSendTargets(
      createSnapshot({
        agents: [
          createAgentMember({
            agentExecutionReadiness:
              createMissingBindingAgentExecutionReadiness(
                "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
              ),
            profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            profileName: "Watcher",
            wakeabilityStatus: "blocked",
          }),
        ],
      })
    );

    expect(target).toEqual(
      expect.objectContaining({
        allowedRelations: {
          wake: true,
          reference: true,
        },
        wakeAvailability: expect.objectContaining({
          status: "blocked",
        }),
      })
    );
  });

  it("forwards unavailable daemon route truth without collapsing it into offline-only wakeability", () => {
    const [target] = listSpaceSendTargets(
      createSnapshot({
        agents: [
          createAgentMember({
            agentExecutionReadiness:
              createRouteUnavailableAgentExecutionReadiness(
                "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc"
              ),
            agentWakeAvailability: {
              ...createTestAgentAgentWakeAvailability("unavailable_for_wake"),
              reasonCode: "agent_execution.route_unavailable",
              summary: "This agent's Wake route is unavailable right now.",
              tooltip: "Wake route unavailable",
            },
            wakeRouteEvidenceStatus: "unavailable",
            profileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            profileName: "Watcher",
            wakeabilityReasonCode: "route.unavailable",
            wakeabilityStatus: "blocked",
          }),
        ],
      })
    );

    expect(target?.wakeAvailability).toEqual(
      expect.objectContaining({
        reasonCodes: ["agent_execution.route_unavailable"],
        reasonText: "This agent's Wake route is unavailable right now.",
        status: "blocked",
      })
    );
  });
});

function createSnapshot(input: {
  humans?: SpaceMemberHumanSnapshot[];
  agents?: SpaceMemberAgentSnapshot[];
}): SpaceMembersSnapshot {
  return createSpaceMembersSnapshot({
    agents: input.agents,
    generatedAt: "2026-03-13T00:00:00.000Z",
    humans: input.humans,
    spaceId: "space-1",
  });
}

function createHumanMember(input: {
  profileId: string;
  profileName: string;
  mentionAlias?: string | null;
  liveNow?: boolean;
  status?: "active" | "removed";
}): SpaceMemberHumanSnapshot {
  return createSpaceMemberHumanSnapshot({
    addedAt: "2026-03-13T00:00:00.000Z",
    createdAt: "2026-03-13T00:00:00.000Z",
    lastSeenAt: "2026-03-13T00:00:00.000Z",
    lastSeenLabel: "Seen recently",
    liveNow: input.liveNow ?? false,
    memberSource: "space_creator",
    memberSourceLabel: "Creator",
    mentionAlias: input.mentionAlias ?? null,
    ownerName: input.profileName,
    ownerUserId: "usr-owner",
    profileId: input.profileId,
    profileName: input.profileName,
    status: input.status ?? "active",
    updatedAt: "2026-03-13T00:00:00.000Z",
  });
}

function createAgentMember(input: {
  wakeRouteEvidenceStatus?: "online" | "offline" | "unavailable";
  profileId: string;
  profileName: string;
  agentExecutionReadiness?: NonNullable<
    NonNullable<
      SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
    >["agentExecutionReadiness"]
  > | null;
  agentWakeAvailability?: SpaceMemberAgentSnapshot["agentWakeAvailability"];
  mentionAlias?: string | null;
  wakeabilityStatus?: "ready" | "blocked";
  wakeabilityReasonCode?:
    | "profile.unbound"
    | "controller.binding.disabled"
    | "route.not_registered"
    | "route.unavailable";
  liveNow?: boolean;
}): SpaceMemberAgentSnapshot {
  const wakeabilityStatus = input.wakeabilityStatus ?? "ready";
  const wakeabilityReasonCode =
    input.wakeabilityReasonCode ??
    ((input.wakeRouteEvidenceStatus ??
      (wakeabilityStatus === "ready" ? "online" : "offline")) === "unavailable"
      ? "route.unavailable"
      : "route.not_registered");
  const agentExecutionReadiness =
    input.agentExecutionReadiness === undefined
      ? createReadyAgentExecutionReadiness(input.profileId)
      : input.agentExecutionReadiness;

  return createSpaceMemberAgentSnapshot({
    addedAt: "2026-03-13T00:00:00.000Z",
    addedByDisplayName: "Felix",
    addedByOwnerUserId: "usr-felix",
    addedByProfileId: "11111111-1111-4111-8111-111111111111",
    agentControllerConversationId: null,
    ...(agentExecutionReadiness === null ? {} : { agentExecutionReadiness }),
    ...(input.agentWakeAvailability === undefined
      ? {}
      : { agentWakeAvailability: input.agentWakeAvailability }),
    agentControllerRef: "builtin:codex",
    createdAt: "2026-03-13T00:00:00.000Z",
    daemonRouteStatus:
      input.wakeRouteEvidenceStatus ??
      (wakeabilityStatus === "ready" ? "online" : "offline"),
    lastSeenAt: "2026-03-13T00:00:00.000Z",
    lastSeenLabel: "Seen recently",
    liveNow: input.liveNow ?? false,
    memberSource: "added_by_member",
    memberSourceLabel: "Added by Felix",
    mentionAlias: input.mentionAlias ?? null,
    ownerName: "Felix",
    ownerUserId: "usr-felix",
    profileId: input.profileId,
    profileName: input.profileName,
    wakeabilityReasonCodes:
      wakeabilityStatus === "ready" ? [] : [wakeabilityReasonCode],
    wakeabilityReasonText:
      wakeabilityStatus === "ready"
        ? "This profile can be woken in Space"
        : "Wake is currently blocked in Space",
    wakeabilityStatus,
    updatedAt: "2026-03-13T00:00:00.000Z",
  });
}

function createReadyAgentExecutionReadiness(
  agentProfileId: string
): NonNullable<
  NonNullable<
    SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
  >["agentExecutionReadiness"]
> {
  return createSpaceMemberAgentExecutionReadiness({
    agentProfileId,
    displayState: "ready",
    primaryAction: "none",
    reasonCodes: [],
  });
}

function createMissingBindingAgentExecutionReadiness(
  agentProfileId: string
): NonNullable<
  NonNullable<
    SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
  >["agentExecutionReadiness"]
> {
  return createSpaceMemberAgentExecutionReadiness({
    agentProfileId,
    displayState: "not_ready",
    facts: {
      binding: {
        reasonCodes: ["agent_profile_binding.missing"],
        routable: false,
        source: "missing",
      },
    },
    primaryAction: "reconnect_binding",
    reasonCodes: ["agent_profile_binding.missing"],
  });
}

function createRouteUnavailableAgentExecutionReadiness(
  agentProfileId: string
): NonNullable<
  NonNullable<
    SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
  >["agentExecutionReadiness"]
> {
  return createRouteBlockedAgentExecutionReadiness(
    agentProfileId,
    "agent_execution.route_unavailable"
  );
}

function createRouteBlockedAgentExecutionReadiness(
  agentProfileId: string,
  routeReasonCode:
    | "agent_execution.route_missing"
    | "agent_execution.route_unavailable"
): NonNullable<
  NonNullable<
    SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
  >["agentExecutionReadiness"]
> {
  return createSpaceMemberAgentExecutionReadiness({
    agentProfileId,
    displayState: "not_ready",
    facts: {
      binding: {
        reasonCodes: [],
        routable: true,
        source: "binding_truth",
      },
      route: {
        online: false,
        reasonCodes: [routeReasonCode],
        source: "daemon_route",
      },
      runtime: {
        ready: true,
        reasonCodes: [],
        source: "prepare_readiness",
      },
    },
    primaryAction: "check_status",
    reasonCodes: [routeReasonCode],
  });
}
