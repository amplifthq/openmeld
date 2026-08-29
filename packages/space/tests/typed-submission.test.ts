import { createDaemonRouteObservationSummary } from "@openmeld/schemas";
import { createSpaceMemberAgentExecutionReadiness } from "@openmeld/schemas/testing";
import type {
  SpaceMemberAgentSnapshot,
  SpaceMemberHumanSnapshot,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  prepareHumanSpaceTypedSubmission,
  prepareOneShotSpaceTypedSubmission,
  spaceTextHasCanonicalMentionAttempts,
  spaceTextHasOneShotMentionAttempts,
} from "../src/index";
import {
  createTestAgentAgentWakeAvailability,
  createTestAgentWakeRouteRegistration,
} from "./test-agent-public-presence";

const HUMAN_ANALYST_ID = "11111111-1111-4111-8111-111111111111";
const HUMAN_LEGAL_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_BUDGET_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_BLOCKED_ID = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("space typed submission", () => {
  it("keeps plain text without canonical mentions free of message envelopes", () => {
    expect(
      prepareHumanSpaceTypedSubmission({
        text: "  hello from the dry run  ",
        snapshot: null,
      })
    ).toMatchObject({
      text: "hello from the dry run",
      messageEnvelope: null,
      hasCanonicalMentions: false,
      canonicalMentionsInTextOrder: [],
      resolvedStructuredTargets: {
        canonicalMentionsInTextOrder: [],
        profileIdsInTextOrder: [],
      },
    });
  });

  it("normalizes valid canonical mentions into the local message envelope", () => {
    expect(
      prepareHumanSpaceTypedSubmission({
        text: [
          "  @Budget Analyst(wake) Please propose the rollout plan.",
          "@Legal(reference) Please keep visibility on this thread.",
          "@Alice(reference) I agree with the risk framing.  ",
        ].join("\n"),
        snapshot: createSnapshot(),
      })
    ).toMatchObject({
      messageEnvelope: {
        activationTargets: [AGENT_BUDGET_ID],
        referenceTargets: [HUMAN_LEGAL_ID, HUMAN_ANALYST_ID],
        text: [
          "@Budget Analyst(wake) Please propose the rollout plan.",
          "@Legal(reference) Please keep visibility on this thread.",
          "@Alice(reference) I agree with the risk framing.",
        ].join("\n"),
      },
      text: [
        "@Budget Analyst(wake) Please propose the rollout plan.",
        "@Legal(reference) Please keep visibility on this thread.",
        "@Alice(reference) I agree with the risk framing.",
      ].join("\n"),
      hasCanonicalMentions: true,
      canonicalMentionsInTextOrder: [
        {
          profileId: AGENT_BUDGET_ID,
          type: "wake",
          text: "@Budget Analyst(wake)",
        },
        {
          profileId: HUMAN_LEGAL_ID,
          type: "reference",
          text: "@Legal(reference)",
        },
        {
          profileId: HUMAN_ANALYST_ID,
          type: "reference",
          text: "@Alice(reference)",
        },
      ],
      resolvedStructuredTargets: {
        profileIdsInTextOrder: [
          AGENT_BUDGET_ID,
          HUMAN_LEGAL_ID,
          HUMAN_ANALYST_ID,
        ],
      },
    });
  });

  it("accepts alias, short-id fallback, full profile-id fallback, and whitespace-normalized names", () => {
    const snapshot = createSnapshot({
      humans: [
        createHumanMember({
          profileId: HUMAN_ANALYST_ID,
          profileName: "Alice",
          mentionAlias: "alice_ref",
        }),
        createHumanMember({
          profileId: HUMAN_LEGAL_ID,
          profileName: "Case Team",
          mentionAlias: null,
        }),
      ],
      agents: [
        createAgentMember({
          profileId: AGENT_BUDGET_ID,
          profileName: "Budget   Analyst",
          mentionAlias: null,
        }),
        createAgentMember({
          agentExecutionReadiness:
            createMissingBindingAgentExecutionReadiness(AGENT_BLOCKED_ID),
          profileId: AGENT_BLOCKED_ID,
          profileName: "Blocked Agent",
          mentionAlias: null,
          wakeabilityStatus: "blocked",
        }),
      ],
    });

    const prepared = prepareHumanSpaceTypedSubmission({
      text: [
        "@Budget Analyst(wake) lead this.",
        "@alice_ref(reference) looped in.",
        "@Blocked Agent-agt_bbbbb(reference) keep visibility.",
        `@${HUMAN_LEGAL_ID}(reference) exact id fallback.`,
      ].join("\n"),
      snapshot,
    });

    expect(prepared.messageEnvelope).toEqual({
      activationTargets: [AGENT_BUDGET_ID],
      referenceTargets: [HUMAN_ANALYST_ID, AGENT_BLOCKED_ID, HUMAN_LEGAL_ID],
      text: [
        "@Budget Analyst(wake) lead this.",
        "@alice_ref(reference) looped in.",
        "@Blocked Agent-agt_bbbbb(reference) keep visibility.",
        `@${HUMAN_LEGAL_ID}(reference) exact id fallback.`,
      ].join("\n"),
    });
  });

  it("requires a members snapshot when canonical attempts are present", () => {
    expect(() =>
      prepareHumanSpaceTypedSubmission({
        text: "@Budget Analyst(wake) Please propose the rollout plan.",
        snapshot: null,
      })
    ).toThrow(
      "Cannot validate canonical mentions right now because current space members could not be loaded."
    );
  });

  it("fails local canonical syntax before snapshot-dependent resolution", () => {
    expect(() =>
      prepareHumanSpaceTypedSubmission({
        text: "@NameWith(Bracket)(wake) hello",
        snapshot: null,
      })
    ).toThrow(
      "That mention is not valid. Type @ and choose a member from the list."
    );
  });

  it("treats an @-token with a non-relation paren as plain text, not a mention error", () => {
    // After removing the same-line-paren fallback, `@name(foo)` and technical
    // tokens like `@scope/pkg.foo(arg)` are plain text rather than a malformed
    // mention that rejects the whole submission.
    expect(() =>
      prepareHumanSpaceTypedSubmission({
        text: "@Budget Analyst(foo) hello",
        snapshot: null,
      })
    ).not.toThrow();
  });

  it("rejects invalid canonical syntax and target lookup mismatches", () => {
    expect(() =>
      prepareHumanSpaceTypedSubmission({
        text: "@NameWith(Bracket)(wake) hello",
        snapshot: createSnapshot(),
      })
    ).toThrow(
      "That mention is not valid. Type @ and choose a member from the list."
    );

    expect(() =>
      prepareHumanSpaceTypedSubmission({
        text: "@budget analyst(wake) hello",
        snapshot: createSnapshot(),
      })
    ).toThrow(
      "That mention does not match a current member. Type @ and choose a member from the list."
    );

    expect(() =>
      prepareHumanSpaceTypedSubmission({
        text: "@Budget Analyst (wake) hello",
        snapshot: createSnapshot(),
      })
    ).toThrow(
      "That mention is not valid. Type @ and choose a member from the list."
    );
  });

  it("rejects relation eligibility and keeps only the first relation for repeated targets", () => {
    expect(() =>
      prepareHumanSpaceTypedSubmission({
        text: "@Alice(wake) hello",
        snapshot: createSnapshot(),
      })
    ).toThrow("wake is only allowed for agent targets in this space");

    expect(
      prepareHumanSpaceTypedSubmission({
        text: "@Blocked Agent(wake) hello",
        snapshot: createSnapshot(),
      })
    ).toMatchObject({
      messageEnvelope: {
        activationTargets: [AGENT_BLOCKED_ID],
        referenceTargets: [],
        text: "@Blocked Agent(wake) hello",
      },
      hasCanonicalMentions: true,
    });

    expect(
      prepareHumanSpaceTypedSubmission({
        text: [
          "@Budget Analyst(wake) first",
          "@Budget Analyst(wake) second",
        ].join("\n"),
        snapshot: createSnapshot(),
      })
    ).toMatchObject({
      messageEnvelope: {
        activationTargets: [AGENT_BUDGET_ID],
        referenceTargets: [],
      },
      resolvedStructuredTargets: {
        profileIdsInTextOrder: [AGENT_BUDGET_ID],
      },
    });

    expect(
      prepareHumanSpaceTypedSubmission({
        text: [
          "@Budget Analyst(wake) first",
          "@Budget Analyst(reference) second",
        ].join("\n"),
        snapshot: createSnapshot(),
      })
    ).toMatchObject({
      messageEnvelope: {
        activationTargets: [AGENT_BUDGET_ID],
        referenceTargets: [],
      },
      resolvedStructuredTargets: {
        profileIdsInTextOrder: [AGENT_BUDGET_ID],
      },
    });
  });

  it("detects whether a text contains canonical mention attempts", () => {
    expect(
      spaceTextHasCanonicalMentionAttempts("@Budget Analyst(wake) hi")
    ).toBe(true);
    expect(spaceTextHasCanonicalMentionAttempts("@legacy-handle hi")).toBe(
      false
    );
  });

  it("prepares a one-shot submission from exact canonical mentions", () => {
    expect(
      prepareOneShotSpaceTypedSubmission({
        text: "@Budget Analyst(wake) please propose the rollout plan.",
        snapshot: createSnapshot(),
      })
    ).toMatchObject({
      messageEnvelope: {
        activationTargets: [AGENT_BUDGET_ID],
        referenceTargets: [],
        text: "@Budget Analyst(wake) please propose the rollout plan.",
      },
      hasStructuredMentions: true,
      canonicalMentionsInTextOrder: [
        {
          profileId: AGENT_BUDGET_ID,
          text: "@Budget Analyst(wake)",
          type: "wake",
        },
      ],
    });
  });

  it("deduplicates repeated canonical relations through the canonical envelope", () => {
    expect(
      prepareOneShotSpaceTypedSubmission({
        text: [
          "@Budget Analyst(wake) keep the same wake target only once.",
          "@Alice(reference) add human context.",
        ].join("\n"),
        snapshot: createSnapshot(),
      }).messageEnvelope
    ).toEqual({
      activationTargets: [AGENT_BUDGET_ID],
      referenceTargets: [HUMAN_ANALYST_ID],
      text: [
        "@Budget Analyst(wake) keep the same wake target only once.",
        "@Alice(reference) add human context.",
      ].join("\n"),
    });
  });

  it("keeps bare @tokens as plain text in one-shot submissions", () => {
    expect(
      prepareOneShotSpaceTypedSubmission({
        text: "@unknown-token stays plain text here.",
        snapshot: createSnapshot(),
      })
    ).toMatchObject({
      messageEnvelope: null,
      hasStructuredMentions: false,
      canonicalMentionsInTextOrder: [],
    });
  });

  it("accepts blocked-readiness canonical wake targets", () => {
    expect(
      prepareOneShotSpaceTypedSubmission({
        text: "@Blocked Agent(wake) please wake anyway",
        snapshot: createSnapshot(),
      })
    ).toMatchObject({
      messageEnvelope: {
        activationTargets: [AGENT_BLOCKED_ID],
        referenceTargets: [],
        text: "@Blocked Agent(wake) please wake anyway",
      },
      hasStructuredMentions: true,
    });
  });

  it("detects one-shot canonical mention attempts only", () => {
    expect(spaceTextHasOneShotMentionAttempts("@budget-analyst hi")).toBe(
      false
    );
    expect(spaceTextHasOneShotMentionAttempts("@Budget Analyst(wake) hi")).toBe(
      true
    );
    expect(spaceTextHasOneShotMentionAttempts("plain text only")).toBe(false);
  });
});

function createSnapshot(input?: {
  humans?: SpaceMemberHumanSnapshot[];
  agents?: SpaceMemberAgentSnapshot[];
}): SpaceMembersSnapshot {
  const humans = input?.humans ?? [
    createHumanMember({
      profileId: HUMAN_ANALYST_ID,
      profileName: "Alice",
      mentionAlias: null,
    }),
    createHumanMember({
      profileId: HUMAN_LEGAL_ID,
      profileName: "Legal",
      mentionAlias: null,
    }),
  ];
  const agents = input?.agents ?? [
    createAgentMember({
      profileId: AGENT_BUDGET_ID,
      profileName: "Budget Analyst",
      mentionAlias: null,
    }),
    createAgentMember({
      agentExecutionReadiness:
        createMissingBindingAgentExecutionReadiness(AGENT_BLOCKED_ID),
      profileId: AGENT_BLOCKED_ID,
      profileName: "Blocked Agent",
      mentionAlias: null,
      wakeabilityStatus: "blocked",
    }),
  ];
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
    spaceId: "space-typed",
    generatedAt: "2026-04-01T00:00:00.000Z",
    summary: {
      totalCount: humans.length + agents.length,
      humanCount: humans.length,
      agentCount: agents.length,
      liveNowCount: 0,
      wakeableAgentCount,
      offlineAgentCount,
      unavailableAgentCount,
    },
    humans,
    agents,
  };
}

function createHumanMember(input: {
  profileId: string;
  profileName: string;
  mentionAlias?: string | null;
}): SpaceMemberHumanSnapshot {
  return {
    profileId: input.profileId,
    profileName: input.profileName,
    profileKind: "human",
    mentionAlias: input.mentionAlias ?? null,
    status: "active",
    memberSource: "space_creator",
    memberSourceLabel: "Creator",
    addedAt: "2026-04-01T00:00:00.000Z",
    removedAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
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
    ownerUserId: input.profileId,
    ownerName: input.profileName,
  };
}

function createAgentMember(input: {
  profileId: string;
  profileName: string;
  agentExecutionReadiness?: NonNullable<
    NonNullable<
      SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
    >["agentExecutionReadiness"]
  > | null;
  mentionAlias?: string | null;
  wakeabilityStatus?: "ready" | "blocked";
}): SpaceMemberAgentSnapshot {
  const observedAt = "2026-04-01T00:00:00.000Z";
  const wakeabilityStatus = input.wakeabilityStatus ?? "ready";
  const wakeable = wakeabilityStatus === "ready";
  const wakeRouteEvidence = createDaemonRouteObservationSummary({
    observedAt,
    status: wakeable ? "online" : "offline",
  });
  const agentExecutionReadiness =
    input.agentExecutionReadiness === undefined
      ? createReadyAgentExecutionReadiness(input.profileId)
      : input.agentExecutionReadiness;

  return {
    profileId: input.profileId,
    profileName: input.profileName,
    profileKind: "agent",
    mentionAlias: input.mentionAlias ?? null,
    status: "active",
    memberSource: "added_by_member",
    memberSourceLabel: "Added by Alice",
    addedAt: "2026-04-01T00:00:00.000Z",
    removedAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    addedByProfileId: HUMAN_ANALYST_ID,
    addedByOwnerUserId: HUMAN_ANALYST_ID,
    addedByDisplayName: "Alice",
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: null,
    lastSeenLabel: null,
    liveNow: false,
    ownerUserId: HUMAN_ANALYST_ID,
    ownerName: "Alice",
    agentControllerRef: "builtin:codex",
    agentControllerConversationId: null,
    agentWakeAvailability: createTestAgentAgentWakeAvailability(
      wakeable ? "available_for_wake" : "unavailable_for_wake"
    ),
    ownerWakeDiagnostics:
      agentExecutionReadiness === null
        ? null
        : {
            agentExecutionReadiness,
            agentWakeRouteRegistration: createTestAgentWakeRouteRegistration(
              wakeable
                ? {}
                : {
                    status: "pending",
                    reasonCode: "wake_route.registration_pending",
                    reportedAtMs: null,
                    daemonSessionId: null,
                    deviceId: null,
                    lane: null,
                    serviceVersion: null,
                  }
            ),
            wakeRouteEvidence,
            wakeRouteStatus: wakeable
              ? {
                  connectionGeneration: 1,
                  daemonSessionId: "daemon-session-test",
                  deviceId: "device-test",
                  lane: "dev-local",
                  lastHeartbeatMs: 1_768_000_000_000,
                  leaseEpoch: 1,
                  status: "ready",
                }
              : { status: "offline" },
            state:
              agentExecutionReadiness.displayState === "ready"
                ? "none"
                : "action_required",
          },
  };
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
