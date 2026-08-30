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
import {
  createSpaceTargetCatalog,
  listSpaceTargetCatalog,
  normalizeReadableMentionLookupToken,
} from "../src";
import {
  createTestAgentAgentWakeAvailability,
  createTestAgentWakeRouteRegistration,
} from "./test-agent-public-presence";

const HUMAN_ANALYST_ID = "22222222-2222-4222-8222-222222222222";
const HUMAN_LEGAL_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_ALPHA_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_ALPHA_TWIN_ID = "agt_aaaaa111-1111-4111-8111-111111111111";
const AGENT_BRAVO_ID = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT_CHARLIE_ID = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("space target catalog", () => {
  it("uses a unique profile name as the primary mention label", () => {
    const [target] = listSpaceTargetCatalog(
      createSnapshot({
        humans: [
          createHumanMember({
            profileId: HUMAN_ANALYST_ID,
            profileName: "Budget Analyst",
            mentionAlias: "budget_analyst",
          }),
        ],
      })
    );

    expect(target).toEqual(
      expect.objectContaining({
        profileId: HUMAN_ANALYST_ID,
        profileIdShort: "22222",
        primaryMentionLabel: "Budget Analyst",
        labelSource: "profile_name",
        exactMentionLabels: [
          "Budget Analyst",
          "budget_analyst",
          "Budget Analyst-22222",
          HUMAN_ANALYST_ID,
        ],
        preferredLookupToken: "budget analyst",
        allowedRelations: {
          wake: false,
          reference: true,
        },
      })
    );
  });

  it("falls back to a unique mention alias when profile names collide", () => {
    const targets = listSpaceTargetCatalog(
      createSnapshot({
        agents: [
          createAgentMember({
            profileId: AGENT_ALPHA_ID,
            profileName: "Ops Bot",
            mentionAlias: "ops_alpha",
          }),
          createAgentMember({
            profileId: AGENT_BRAVO_ID,
            profileName: "Ops Bot",
            mentionAlias: "ops_bravo",
          }),
        ],
      })
    );

    expect(targets.map((target) => target.primaryMentionLabel)).toEqual([
      "ops_alpha",
      "ops_bravo",
    ]);
    expect(targets.map((target) => target.labelSource)).toEqual([
      "mention_alias",
      "mention_alias",
    ]);
  });

  it("falls back to profile-name-with-short-id when profile name and alias both collide", () => {
    const targets = listSpaceTargetCatalog(
      createSnapshot({
        agents: [
          createAgentMember({
            profileId: AGENT_ALPHA_ID,
            profileName: "Reviewer",
            mentionAlias: "reviewer",
          }),
          createAgentMember({
            profileId: AGENT_BRAVO_ID,
            profileName: "Reviewer",
            mentionAlias: "reviewer",
          }),
        ],
      })
    );

    expect(targets.map((target) => target.primaryMentionLabel)).toEqual([
      "Reviewer-agt_aaaaa",
      "Reviewer-agt_bbbbb",
    ]);
    expect(targets.map((target) => target.labelSource)).toEqual([
      "profile_name_with_short_id",
      "profile_name_with_short_id",
    ]);
  });

  it("falls back to the full profile id when readable names and short-id fallback stay ambiguous", () => {
    const targets = listSpaceTargetCatalog(
      createSnapshot({
        agents: [
          createAgentMember({
            profileId: AGENT_ALPHA_ID,
            profileName: "Planner",
            mentionAlias: "planner",
          }),
          createAgentMember({
            profileId: AGENT_ALPHA_TWIN_ID,
            profileName: "Planner",
            mentionAlias: "planner",
          }),
        ],
      })
    );

    expect(targets).toEqual([
      expect.objectContaining({
        profileId: AGENT_ALPHA_ID,
        primaryMentionLabel: AGENT_ALPHA_ID,
        labelSource: "profile_id",
        exactMentionLabels: [AGENT_ALPHA_ID],
        preferredLookupToken: AGENT_ALPHA_ID,
      }),
      expect.objectContaining({
        profileId: AGENT_ALPHA_TWIN_ID,
        primaryMentionLabel: AGENT_ALPHA_TWIN_ID,
        labelSource: "profile_id",
        exactMentionLabels: [AGENT_ALPHA_TWIN_ID],
        preferredLookupToken: AGENT_ALPHA_TWIN_ID,
      }),
    ]);
  });

  it("ignores removed members and falls back to alias when profile names are invalid mention labels", () => {
    const targets = listSpaceTargetCatalog(
      createSnapshot({
        humans: [
          createHumanMember({
            profileId: HUMAN_ANALYST_ID,
            profileName: "Budget Analyst (On Call)",
            mentionAlias: "budget_on_call",
          }),
          createHumanMember({
            profileId: HUMAN_LEGAL_ID,
            profileName: "Removed Human",
            status: "removed",
          }),
        ],
      })
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual(
      expect.objectContaining({
        profileId: HUMAN_ANALYST_ID,
        primaryMentionLabel: "budget_on_call",
        labelSource: "mention_alias",
        exactMentionLabels: ["budget_on_call", HUMAN_ANALYST_ID],
      })
    );
  });

  it("keeps wake relation support for blocked agents and separates wake support from availability", () => {
    const targets = listSpaceTargetCatalog(
      createSnapshot({
        agents: [
          createAgentMember({
            agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
              agentProfileId: AGENT_ALPHA_ID,
              displayState: "ready",
              reasonCodes: [],
            }),
            profileId: AGENT_ALPHA_ID,
            profileName: "Wakeable Agent",
            mentionAlias: "wakeable_agent",
            runtimeDeviceDisplayName: "Felix's composer",
            wakeabilityStatus: "ready",
          }),
          createAgentMember({
            profileId: AGENT_CHARLIE_ID,
            profileName: "Blocked Agent",
            mentionAlias: "blocked_agent",
            wakeabilityStatus: "blocked",
          }),
        ],
      })
    );

    expect(targets[0]?.allowedRelations).toEqual({
      wake: true,
      reference: true,
    });
    expect(targets[0]?.wakeAvailability.status).toBe("ready");
    expect(targets[0]?.controllerDisplay).toBe("codex");
    expect(targets[0]?.runtimeDeviceDisplayName).toBe("Felix's composer");
    expect(targets[1]?.allowedRelations).toEqual({
      wake: true,
      reference: true,
    });
    expect(targets[1]?.wakeAvailability.status).toBe("blocked");
  });

  it("does not use legacy wakeability as Wake availability without execution readiness", () => {
    const [target] = listSpaceTargetCatalog(
      createSnapshot({
        agents: [
          createAgentMember({
            includeAgentExecutionReadiness: false,
            profileId: AGENT_ALPHA_ID,
            profileName: "Legacy Wakeable Agent",
            mentionAlias: "legacy_wakeable",
            wakeabilityStatus: "ready",
          }),
        ],
      })
    );

    expect(target?.allowedRelations.wake).toBe(true);
    expect(target?.wakeAvailability).toEqual(
      expect.objectContaining({
        reasonCodes: [],
        reasonText:
          "OpenMeld is still checking whether this agent can reply from this computer.",
        status: "blocked",
      })
    );
    expect(target?.wakeAvailability).not.toHaveProperty("wakeState");
  });

  it("uses execution readiness to block Wake when legacy wakeability is stale", () => {
    const [target] = listSpaceTargetCatalog(
      createSnapshot({
        agents: [
          createAgentMember({
            agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
              displayState: "not_ready",
              reasonCodes: ["agent_profile_binding.missing"],
            }),
            profileId: AGENT_ALPHA_ID,
            profileName: "Wakeable Agent",
            wakeabilityStatus: "ready",
          }),
        ],
      })
    );

    expect(target?.allowedRelations.wake).toBe(true);
    expect(target?.wakeAvailability).toEqual(
      expect.objectContaining({
        reasonCodes: ["agent_profile_binding.missing"],
        reasonText: "Connect a local agent before this profile can reply.",
        status: "blocked",
      })
    );
    expect(target?.wakeAvailability).not.toHaveProperty("wakeState");
  });

  it("uses public agent wake availability for target Wake availability even when owner diagnostics are stale", () => {
    const [target] = listSpaceTargetCatalog(
      createSnapshot({
        agents: [
          createAgentMember({
            agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
              displayState: "ready",
              reasonCodes: [],
            }),
            profileId: AGENT_ALPHA_ID,
            profileName: "Repairable Agent",
            agentWakeAvailability:
              createTestAgentAgentWakeAvailability("available_for_wake"),
            ownerWakeDiagnostics: {
              state: "action_required",
              agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness(
                {
                  displayState: "not_ready",
                  reasonCodes: ["agent_profile_binding.missing"],
                }
              ),
              agentWakeRouteRegistration: createTestAgentWakeRouteRegistration({
                status: "pending",
                reasonCode: "wake_route.registration_pending",
                reportedAtMs: null,
                daemonSessionId: null,
                deviceId: null,
                lane: null,
                serviceVersion: null,
              }),
              wakeRouteEvidence: {
                observedAt: "2026-03-13T00:00:00.000Z",
                reasonCode: "route.not_registered",
                status: "offline",
              },
              wakeRouteStatus: { status: "offline" },
            },
          }),
        ],
      })
    );

    expect(target?.wakeAvailability).toEqual(
      expect.objectContaining({
        reasonCodes: ["agent_execution.ready"],
        reasonText: "Can reply from this computer in Spaces.",
        status: "ready",
      })
    );
  });

  it("does not let top-level owner wake diagnostics facts override agent wake availability", () => {
    const legacyOwnerMember = createAgentMember({
      agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
        displayState: "not_ready",
        reasonCodes: ["agent_profile_binding.missing"],
      }),
      profileId: AGENT_ALPHA_ID,
      profileName: "Legacy Owner Agent",
      agentWakeAvailability:
        createTestAgentAgentWakeAvailability("available_for_wake"),
      ownerWakeDiagnostics: null,
    });
    const { ownerWakeDiagnostics, ...legacyTopLevelOnlyMember } =
      legacyOwnerMember;

    const [target] = listSpaceTargetCatalog(
      createSnapshot({
        agents: [legacyTopLevelOnlyMember],
      })
    );

    expect(ownerWakeDiagnostics).toBeNull();
    expect(target?.wakeAvailability).toEqual(
      expect.objectContaining({
        reasonCodes: ["agent_execution.ready"],
        reasonText: "Can reply from this computer in Spaces.",
        status: "ready",
      })
    );
  });

  it("preserves distinct public unavailable reasons for mention clients", () => {
    const targets = listSpaceTargetCatalog(
      createSnapshot({
        agents: [
          createAgentMember({
            includeAgentExecutionReadiness: false,
            profileId: AGENT_ALPHA_ID,
            profileName: "Organization Agent",
            agentWakeAvailability: {
              ...createTestAgentAgentWakeAvailability("unavailable_for_wake"),
              reasonCode: "agent_profile.organization_mismatch",
              summary: "This Agent Profile belongs to another workspace.",
              tooltip: "Wrong workspace",
            },
            ownerWakeDiagnostics: null,
          }),
          createAgentMember({
            includeAgentExecutionReadiness: false,
            profileId: AGENT_BRAVO_ID,
            profileName: "Provider Agent",
            agentWakeAvailability: {
              ...createTestAgentAgentWakeAvailability("unavailable_for_wake"),
              reasonCode: "provider_account.access_required",
              summary: "Fix provider access before this agent can reply.",
              tooltip: "Provider access needed",
            },
            ownerWakeDiagnostics: null,
          }),
          createAgentMember({
            includeAgentExecutionReadiness: false,
            profileId: AGENT_CHARLIE_ID,
            profileName: "Disconnected Agent",
            agentWakeAvailability: {
              ...createTestAgentAgentWakeAvailability("unavailable_for_wake"),
              reasonCode: "agent_profile_binding.missing",
              summary: "Connect a local agent before this profile can reply.",
              tooltip: "Connect local agent",
            },
            ownerWakeDiagnostics: null,
          }),
        ],
      })
    );

    expect(targets.map((target) => target.wakeAvailability)).toEqual([
      {
        reasonCodes: ["agent_profile.organization_mismatch"],
        reasonText: "This Agent Profile belongs to another workspace.",
        status: "blocked",
      },
      {
        reasonCodes: ["provider_account.access_required"],
        reasonText: "Fix provider access before this agent can reply.",
        status: "blocked",
      },
      {
        reasonCodes: ["agent_profile_binding.missing"],
        reasonText: "Connect a local agent before this profile can reply.",
        status: "blocked",
      },
    ]);
  });

  it("uses public checking presence for public Wake availability when owner Wake diagnostics is absent", () => {
    const publicMember = createAgentMember({
      includeAgentExecutionReadiness: false,
      profileId: AGENT_ALPHA_ID,
      profileName: "Public Agent",
      agentWakeAvailability: createTestAgentAgentWakeAvailability(
        "checking_connection"
      ),
      ownerWakeDiagnostics: null,
    });
    const { ownerWakeDiagnostics, ...publicOnlyMember } = publicMember;

    const [target] = listSpaceTargetCatalog(
      createSnapshot({
        agents: [publicOnlyMember],
      })
    );

    expect(ownerWakeDiagnostics).toBeNull();
    expect(target?.wakeAvailability).toEqual(
      expect.objectContaining({
        reasonCodes: ["agent_execution.check_status"],
        reasonText: "Checking this agent's Wake availability.",
        status: "blocked",
      })
    );
  });

  it("uses public offline presence for public Wake availability when owner Wake diagnostics is absent", () => {
    const publicMember = createAgentMember({
      includeAgentExecutionReadiness: false,
      profileId: AGENT_ALPHA_ID,
      profileName: "Public Agent",
      agentWakeAvailability:
        createTestAgentAgentWakeAvailability("offline_for_wake"),
      ownerWakeDiagnostics: null,
    });
    const { ownerWakeDiagnostics, ...publicOnlyMember } = publicMember;

    const [target] = listSpaceTargetCatalog(
      createSnapshot({
        agents: [publicOnlyMember],
      })
    );

    expect(ownerWakeDiagnostics).toBeNull();
    expect(target?.wakeAvailability).toEqual(
      expect.objectContaining({
        reasonCodes: ["service.not_running"],
        reasonText:
          "Connect OpenMeld Service on this computer before this agent can reply.",
        status: "blocked",
      })
    );
  });

  it("keeps route evidence diagnostic-only for blocked public Wake availability", () => {
    const [target] = listSpaceTargetCatalog(
      createSnapshot({
        agents: [
          createAgentMember({
            agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
              agentProfileId: AGENT_CHARLIE_ID,
              displayState: "not_ready",
              reasonCodes: ["agent_execution.route_unavailable"],
              facts: {
                route: {
                  online: false,
                  reasonCodes: ["agent_execution.route_unavailable"],
                  source: "daemon_route",
                },
              },
            }),
            wakeRouteEvidenceStatus: "unavailable",
            profileId: AGENT_CHARLIE_ID,
            profileName: "Blocked Agent",
            wakeabilityReasonCode: "route.unavailable",
            wakeabilityStatus: "blocked",
          }),
        ],
      })
    );

    expect(target?.wakeAvailability).toEqual(
      expect.objectContaining({
        reasonCodes: ["agent_profile_binding.missing"],
        reasonText: "Connect a local agent before this profile can reply.",
        status: "blocked",
      })
    );
  });

  it("normalizes controller display with trim and builtin prefix stripping only", () => {
    const [target] = listSpaceTargetCatalog(
      createSnapshot({
        agents: [
          createAgentMember({
            profileId: AGENT_ALPHA_ID,
            profileName: "Ops Bot",
            agentControllerRef: "  builtin:codex  ",
          }),
        ],
      })
    );

    expect(target?.agentControllerRef).toBe("builtin:codex");
    expect(target?.controllerDisplay).toBe("codex");
  });

  it("marks ambiguous lookup tokens as unresolved and preserves unique preferred lookup tokens", () => {
    const catalog = createSpaceTargetCatalog(
      createSnapshot({
        agents: [
          createAgentMember({
            profileId: AGENT_ALPHA_ID,
            profileName: "Shared Agent",
            mentionAlias: "shared_alpha",
          }),
          createAgentMember({
            profileId: AGENT_BRAVO_ID,
            profileName: "Shared Agent",
            mentionAlias: "shared_bravo",
          }),
        ],
      })
    );

    expect(catalog.byLookupToken.get("shared agent")).toBeNull();
    expect(catalog.byLookupToken.get("shared_alpha")).toEqual(
      catalog.byProfileId.get(AGENT_ALPHA_ID)
    );
    expect(catalog.byProfileId.get(AGENT_ALPHA_ID)?.preferredLookupToken).toBe(
      "shared_alpha"
    );
  });

  it("normalizes readable lookup tokens with punctuation folding", () => {
    expect(normalizeReadableMentionLookupToken("  O'Reilly Bot  ")).toBe(
      "oreilly bot"
    );
    expect(normalizeReadableMentionLookupToken("Budget   Analyst!!")).toBe(
      "budget analyst"
    );
  });

  it("fails fast when a member snapshot contains a non-runtime profile id", () => {
    expect(() =>
      listSpaceTargetCatalog(
        createSnapshot({
          humans: [
            createHumanMember({
              profileId: "hum_invalid",
              profileName: "Invalid Human",
            }),
          ],
        })
      )
    ).toThrow("Invalid OpenMeld runtime profile ID");
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
  agentExecutionReadiness?: NonNullable<
    SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
  >["agentExecutionReadiness"];
  wakeRouteEvidenceStatus?: "online" | "offline" | "unavailable";
  includeAgentExecutionReadiness?: boolean;
  agentWakeAvailability?: SpaceMemberAgentSnapshot["agentWakeAvailability"];
  profileId: string;
  profileName: string;
  mentionAlias?: string | null;
  wakeabilityStatus?: "ready" | "blocked";
  wakeabilityReasonCode?:
    | "profile.unbound"
    | "controller.binding.disabled"
    | "route.not_registered"
    | "route.unavailable";
  liveNow?: boolean;
  agentControllerRef?: string | null;
  runtimeDeviceDisplayName?: string | null;
  ownerWakeDiagnostics?: SpaceMemberAgentSnapshot["ownerWakeDiagnostics"];
}): SpaceMemberAgentSnapshot {
  const wakeabilityStatus = input.wakeabilityStatus ?? "ready";
  const wakeabilityReasonCode =
    input.wakeabilityReasonCode ??
    ((input.wakeRouteEvidenceStatus ??
      (wakeabilityStatus === "ready" ? "online" : "offline")) === "unavailable"
      ? "route.unavailable"
      : "route.not_registered");

  return createSpaceMemberAgentSnapshot({
    addedAt: "2026-03-13T00:00:00.000Z",
    addedByDisplayName: "Felix",
    addedByOwnerUserId: "usr-felix",
    addedByProfileId: "11111111-1111-4111-8111-111111111111",
    ...(input.agentExecutionReadiness === undefined
      ? {}
      : { agentExecutionReadiness: input.agentExecutionReadiness }),
    ...(input.includeAgentExecutionReadiness === undefined
      ? {}
      : {
          includeAgentExecutionReadiness: input.includeAgentExecutionReadiness,
        }),
    agentControllerConversationId: null,
    agentControllerRef: input.agentControllerRef ?? "builtin:codex",
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
    agentWakeAvailability: input.agentWakeAvailability,
    runtimeDeviceDisplayName: input.runtimeDeviceDisplayName,
    wakeabilityReasonCodes:
      wakeabilityStatus === "ready" ? [] : [wakeabilityReasonCode],
    wakeabilityReasonText:
      wakeabilityStatus === "ready"
        ? "This profile can be woken in Space"
        : "Wake is currently blocked in Space",
    wakeabilityStatus,
    updatedAt: "2026-03-13T00:00:00.000Z",
    ownerWakeDiagnostics: input.ownerWakeDiagnostics,
  });
}
