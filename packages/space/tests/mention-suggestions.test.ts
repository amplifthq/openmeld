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
  listSpaceMentionRelationChoices,
  listSpaceMentionSuggestions,
} from "../src/index";
import { createTestAgentAgentWakeAvailability } from "./test-agent-public-presence";

const HUMAN_FELIX_ID = "11111111-1111-4111-8111-111111111111";
const HUMAN_AMY_ID = "22222222-2222-4222-8222-222222222222";
const HUMAN_ZED_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_OPS_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_WATCHER_ID = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT_REVIEWER_ID = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("space mention suggestions", () => {
  it("projects canonical mention labels without legacy insertion fields", () => {
    const suggestions = listSpaceMentionSuggestions({
      query: "@",
      snapshot: createSnapshot({
        humans: [
          createHumanMember({
            profileId: HUMAN_FELIX_ID,
            profileName: "Felix Space",
          }),
        ],
        agents: [
          createAgentMember({
            profileId: AGENT_OPS_ID,
            profileName: "Ops Bot",
            liveNow: true,
          }),
          createAgentMember({
            profileId: AGENT_WATCHER_ID,
            profileName: "Watcher",
          }),
        ],
      }),
    });

    expect(suggestions.map((item) => item.primaryMentionLabel)).toEqual([
      "Ops Bot",
      "Watcher",
      "Felix Space",
    ]);
    expect(suggestions.every((item) => !("label" in item))).toBe(true);
    expect(suggestions.every((item) => !("insertText" in item))).toBe(true);
    expect(suggestions.every((item) => !("insertToken" in item))).toBe(true);
  });

  it("matches queries against mention labels, aliases, and profile ids", () => {
    const snapshot = createSnapshot({
      humans: [
        createHumanMember({
          profileId: HUMAN_FELIX_ID,
          profileName: "Felix Space",
        }),
      ],
      agents: [
        createAgentMember({
          profileId: AGENT_OPS_ID,
          profileName: "Ops Bot",
          mentionAlias: "ops_bot",
        }),
      ],
    });

    expect(
      listSpaceMentionSuggestions({
        query: "@ops bot",
        snapshot,
      }).map((item) => item.primaryMentionLabel)
    ).toEqual(["Ops Bot"]);

    expect(
      listSpaceMentionSuggestions({
        query: "@ops_bot",
        snapshot,
      }).map((item) => item.primaryMentionLabel)
    ).toEqual(["Ops Bot"]);

    expect(
      listSpaceMentionSuggestions({
        query: "felix",
        snapshot,
      }).map((item) => item.primaryMentionLabel)
    ).toEqual(["Felix Space"]);

    expect(
      listSpaceMentionSuggestions({
        query: AGENT_OPS_ID,
        snapshot,
      }).map((item) => item.primaryMentionLabel)
    ).toEqual(["Ops Bot"]);
  });

  it("falls back to alias-derived mention labels when profile names collide", () => {
    const suggestions = listSpaceMentionSuggestions({
      query: "@ops",
      snapshot: createSnapshot({
        agents: [
          createAgentMember({
            profileId: AGENT_OPS_ID,
            profileName: "Ops Bot",
            mentionAlias: "ops_alpha",
          }),
          createAgentMember({
            profileId: AGENT_WATCHER_ID,
            profileName: "Ops Bot",
            mentionAlias: "ops_bravo",
          }),
        ],
      }),
    });

    expect(
      suggestions.map((item) => ({
        primaryMentionLabel: item.primaryMentionLabel,
        source: item.labelSource,
      }))
    ).toEqual([
      { primaryMentionLabel: "ops_alpha", source: "mention_alias" },
      { primaryMentionLabel: "ops_bravo", source: "mention_alias" },
    ]);
  });

  it("includes projection metadata for relation eligibility", () => {
    const [suggestion] = listSpaceMentionSuggestions({
      query: "@ops",
      snapshot: createSnapshot({
        agents: [
          createAgentMember({
            profileId: AGENT_OPS_ID,
            profileName: "Ops Bot",
          }),
        ],
      }),
    });

    expect(suggestion).toEqual(
      expect.objectContaining({
        primaryMentionLabel: "Ops Bot",
        labelSource: "profile_name",
        exactMentionLabels: ["Ops Bot", "Ops Bot-agt_aaaaa", AGENT_OPS_ID],
        allowedRelations: {
          wake: true,
          reference: true,
        },
        description: "codex · by Felix",
      })
    );
  });

  it("keeps distinct public unavailable reasons in mention descriptions", () => {
    const suggestions = listSpaceMentionSuggestions({
      query: "@",
      snapshot: createSnapshot({
        agents: [
          createAgentMember({
            profileId: AGENT_OPS_ID,
            profileName: "Organization Agent",
            agentWakeAvailability: {
              ...createTestAgentAgentWakeAvailability("unavailable_for_wake"),
              reasonCode: "organization_binding_authorization.required",
              summary:
                "Turn on Wake access before this agent can reply in this Organization.",
              tooltip: "Wake access is off for this Organization",
            },
          }),
          createAgentMember({
            profileId: AGENT_WATCHER_ID,
            profileName: "Account Agent",
            agentWakeAvailability: {
              ...createTestAgentAgentWakeAvailability("unavailable_for_wake"),
              reasonCode: "provider_account.access_required",
              summary: "Fix provider access before this agent can reply.",
              tooltip: "Provider access needed",
            },
          }),
          createAgentMember({
            profileId: AGENT_REVIEWER_ID,
            profileName: "Disconnected Agent",
            agentWakeAvailability: {
              ...createTestAgentAgentWakeAvailability("unavailable_for_wake"),
              reasonCode: "agent_profile_binding.missing",
              summary: "Connect a local agent before this profile can reply.",
              tooltip: "Connect local agent",
            },
          }),
        ],
      }),
    });

    expect(
      suggestions.map(({ description, profileName }) => ({
        description,
        profileName,
      }))
    ).toEqual([
      {
        description:
          "codex · by Felix · Unavailable now: Fix provider access before this agent can reply",
        profileName: "Account Agent",
      },
      {
        description:
          "codex · by Felix · Unavailable now: Connect a local agent before this profile can reply",
        profileName: "Disconnected Agent",
      },
      {
        description:
          "codex · by Felix · Unavailable now: Turn on Wake access before this agent can reply in this Organization",
        profileName: "Organization Agent",
      },
    ]);
  });

  it("uses public snapshot reason copy for viewer-scoped non-owner mentions", () => {
    const [suggestion] = listSpaceMentionSuggestions({
      query: "@ops",
      snapshot: createSnapshot({
        agents: [
          createAgentMember({
            agentExecutionReadiness: null,
            profileId: AGENT_OPS_ID,
            profileName: "Ops Bot",
            agentWakeAvailability: createTestAgentAgentWakeAvailability(
              "unavailable_for_wake"
            ),
            ownerWakeDiagnostics: null,
          }),
        ],
      }),
    });

    expect(suggestion?.description).toBe(
      "codex · by Felix · Unavailable now: Connect a local agent before this profile can reply"
    );
    expect(suggestion?.wakeAvailability).toMatchObject({
      reasonCodes: ["agent_profile_binding.missing"],
      reasonText: "Connect a local agent before this profile can reply.",
      status: "blocked",
    });
  });

  it("prioritizes recent mentions within each profile section using canonical labels", () => {
    const suggestions = listSpaceMentionSuggestions({
      query: "",
      recentProfileIds: [HUMAN_ZED_ID, AGENT_WATCHER_ID],
      snapshot: createSnapshot({
        humans: [
          createHumanMember({
            profileId: HUMAN_AMY_ID,
            profileName: "Amy",
          }),
          createHumanMember({
            profileId: HUMAN_ZED_ID,
            profileName: "Zed",
          }),
        ],
        agents: [
          createAgentMember({
            profileId: AGENT_OPS_ID,
            profileName: "Ops Bot",
          }),
          createAgentMember({
            profileId: AGENT_WATCHER_ID,
            profileName: "Watcher",
          }),
        ],
      }),
    });

    expect(suggestions.map((item) => item.primaryMentionLabel)).toEqual([
      "Watcher",
      "Ops Bot",
      "Zed",
      "Amy",
    ]);
  });

  it("builds relation choices in Wake-Reference order", () => {
    expect(
      listSpaceMentionRelationChoices({
        allowedRelations: {
          wake: true,
          reference: true,
        },
        primaryMentionLabel: "Ops Bot",
        wakeAvailability: {
          status: "ready",
          reasonCodes: [],
          reasonText: "This profile can be woken in Space",
        },
      }).map((choice) => choice.label)
    ).toEqual(["Wake", "Reference"]);
  });

  it("excludes wake for humans but keeps wake available for blocked-readiness agents", () => {
    const [human] = listSpaceMentionSuggestions({
      query: "@felix",
      snapshot: createSnapshot({
        humans: [
          createHumanMember({
            profileId: HUMAN_FELIX_ID,
            profileName: "Felix Space",
          }),
        ],
      }),
    });
    const [agent] = listSpaceMentionSuggestions({
      query: "@ops",
      snapshot: createSnapshot({
        agents: [
          createAgentMember({
            agentExecutionReadiness:
              createMissingBindingAgentExecutionReadiness(AGENT_OPS_ID),
            profileId: AGENT_OPS_ID,
            profileName: "Ops Bot",
            wakeabilityStatus: "blocked",
          }),
        ],
      }),
    });
    expect(human).toBeDefined();
    expect(agent).toBeDefined();
    if (!(human && agent)) {
      throw new Error("Expected both human and agent mention suggestions");
    }

    expect(
      listSpaceMentionRelationChoices({
        allowedRelations: human.allowedRelations,
        primaryMentionLabel: human.primaryMentionLabel,
        wakeAvailability: human.wakeAvailability,
      }).map((choice) => choice.label)
    ).toEqual(["Reference"]);
    expect(
      listSpaceMentionRelationChoices({
        allowedRelations: agent.allowedRelations,
        primaryMentionLabel: agent.primaryMentionLabel,
        wakeAvailability: agent.wakeAvailability,
      }).map((choice) => choice.label)
    ).toEqual(["Wake", "Reference"]);
    expect(agent.description).toContain(
      "Unavailable now: Connect a local agent before this profile can reply"
    );
  });
});

function createSnapshot(input: {
  humans?: SpaceMemberHumanSnapshot[];
  agents?: SpaceMemberAgentSnapshot[];
}): SpaceMembersSnapshot {
  return createSpaceMembersSnapshot({
    spaceId: "space_123",
    generatedAt: "2026-03-13T00:00:00.000Z",
    humans: input.humans ?? [],
    agents: input.agents ?? [],
  });
}

function createHumanMember(input: {
  profileId: string;
  profileName: string;
}): SpaceMemberHumanSnapshot {
  return createSpaceMemberHumanSnapshot({
    status: "active",
    profileId: input.profileId,
    profileName: input.profileName,
    liveNow: false,
    mentionAlias: null,
  });
}

function createAgentMember(input: {
  profileId: string;
  profileName: string;
  agentExecutionReadiness?: NonNullable<
    NonNullable<
      SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
    >["agentExecutionReadiness"]
  > | null;
  liveNow?: boolean;
  mentionAlias?: string | null;
  wakeabilityStatus?: "ready" | "blocked";
  wakeabilityReasonText?: string | null;
  wakeabilityReasonCodes?: readonly string[];
  agentWakeAvailability?: SpaceMemberAgentSnapshot["agentWakeAvailability"];
  ownerWakeDiagnostics?: SpaceMemberAgentSnapshot["ownerWakeDiagnostics"];
}): SpaceMemberAgentSnapshot {
  const agentExecutionReadiness =
    input.agentExecutionReadiness === undefined
      ? createReadyAgentExecutionReadiness(input.profileId)
      : input.agentExecutionReadiness;

  return createSpaceMemberAgentSnapshot({
    status: "active",
    agentControllerRef: "builtin:codex",
    ownerName: "Felix",
    ownerUserId: "user_felix",
    profileId: input.profileId,
    profileName: input.profileName,
    liveNow: input.liveNow ?? false,
    mentionAlias: input.mentionAlias ?? null,
    ...(agentExecutionReadiness === null ? {} : { agentExecutionReadiness }),
    wakeabilityReasonCodes: input.wakeabilityReasonCodes ?? [],
    wakeabilityReasonText:
      input.wakeabilityReasonText ?? "This profile can be woken in Space",
    wakeabilityStatus: input.wakeabilityStatus ?? "ready",
    ...(input.agentWakeAvailability === undefined
      ? {}
      : { agentWakeAvailability: input.agentWakeAvailability }),
    ...(input.ownerWakeDiagnostics === undefined
      ? {}
      : { ownerWakeDiagnostics: input.ownerWakeDiagnostics }),
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
