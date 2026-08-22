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
  isSpaceComposerSubmissionError,
  prepareSpaceComposerSubmission,
  prepareSpaceFileOnlySubmission,
} from "../src/index";

const HUMAN_ANALYST_ID = "11111111-1111-4111-8111-111111111111";
const HUMAN_LEGAL_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_BUDGET_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("space composer submission", () => {
  it("prepares a file-only message without inventing visible text", () => {
    expect(
      prepareSpaceFileOnlySubmission({
        replyTo: { signalId: "signal-1" },
      })
    ).toEqual({
      authoredMentionsInTextOrder: [],
      canonicalMentionsInTextOrder: [],
      hasStructuredTargets: false,
      messageEnvelope: null,
      replyTo: { signalId: "signal-1" },
      resolvedStructuredTargets: {
        canonicalMentionsInTextOrder: [],
        profileIdsInTextOrder: [],
      },
      text: "",
    });
  });

  it("keeps plain text without canonical mentions free of message envelopes", () => {
    expect(
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "missing snapshot",
        text: "  hello from the dry run  ",
        snapshot: null,
      })
    ).toMatchObject({
      text: "hello from the dry run",
      messageEnvelope: null,
      hasStructuredTargets: false,
      canonicalMentionsInTextOrder: [],
      resolvedStructuredTargets: {
        canonicalMentionsInTextOrder: [],
        profileIdsInTextOrder: [],
      },
      replyTo: null,
    });
  });

  it("keeps bare @tokens without canonical relations free of message envelopes", () => {
    expect(
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "missing snapshot",
        text: "@unknown-token stays plain text here.",
        snapshot: createSnapshot(),
      })
    ).toMatchObject({
      text: "@unknown-token stays plain text here.",
      messageEnvelope: null,
      hasStructuredTargets: false,
      canonicalMentionsInTextOrder: [],
      replyTo: null,
    });
  });

  it("uses authored bare mentions as structured targets while preserving visible text", () => {
    expect(
      prepareSpaceComposerSubmission({
        authoredMentionsInTextOrder: [
          {
            profileId: AGENT_BUDGET_ID,
            relation: "wake",
            text: "@Budget Analyst",
          },
          {
            profileId: HUMAN_ANALYST_ID,
            relation: "reference",
            text: "@Alice",
          },
        ],
        missingSnapshotMessage: "missing snapshot",
        text: "@Budget Analyst please review this with @Alice.",
        snapshot: createSnapshot(),
      })
    ).toMatchObject({
      authoredMentionsInTextOrder: [
        {
          profileId: AGENT_BUDGET_ID,
          relation: "wake",
          text: "@Budget Analyst",
        },
        {
          profileId: HUMAN_ANALYST_ID,
          relation: "reference",
          text: "@Alice",
        },
      ],
      messageEnvelope: {
        activationTargets: [AGENT_BUDGET_ID],
        referenceTargets: [HUMAN_ANALYST_ID],
        text: "@Budget Analyst please review this with @Alice.",
      },
      text: "@Budget Analyst please review this with @Alice.",
      hasStructuredTargets: true,
    });
  });

  it("normalizes canonical mentions into the message envelope", () => {
    expect(
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "missing snapshot",
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
      hasStructuredTargets: true,
    });
  });

  it("keeps long follow-up text and code formatting outside the wake mention", () => {
    const agentProfileId = "agt_449dc84a-14c2-4afc-a3be-94dc008ddd9c";
    const agentName = "Prod Smoke Codex 0.7.1 20260531";
    const snapshot = createSnapshot({
      agents: [
        createAgentMember({
          profileId: agentProfileId,
          profileName: agentName,
          mentionAlias: null,
        }),
      ],
    });

    expect(
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "missing snapshot",
        text: `@${agentProfileId}(wake) DOGFOOD_REPORT: Confirmed \`openmeld --version\` and Felix (\`326d1bf2-a521-474f-8cb8-b6664c1c8c6f\`) can read the Space.`,
        snapshot,
      })
    ).toMatchObject({
      messageEnvelope: {
        activationTargets: [agentProfileId],
      },
      hasStructuredTargets: true,
    });

    expect(
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "missing snapshot",
        text: `@${agentName}(wake) DOGFOOD_FINDINGS: service status said route online, then later status changed (transient).`,
        snapshot,
      })
    ).toMatchObject({
      messageEnvelope: {
        activationTargets: [agentProfileId],
      },
      hasStructuredTargets: true,
    });
  });

  it("aligns top-level replyTo with messageEnvelope.replyToSignalId", () => {
    expect(
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "missing snapshot",
        replyTo: {
          signalId: " sig-origin ",
        },
        text: "hello world",
        snapshot: null,
      })
    ).toMatchObject({
      replyTo: {
        signalId: "sig-origin",
      },
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-origin",
        text: "hello world",
      },
    });
  });

  it("keeps replyTo and structured mentions together", () => {
    expect(
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "missing snapshot",
        replyTo: {
          signalId: "sig-origin",
        },
        text: "@Budget Analyst(wake) hello",
        snapshot: createSnapshot(),
      })
    ).toMatchObject({
      replyTo: {
        signalId: "sig-origin",
      },
      messageEnvelope: {
        activationTargets: [AGENT_BUDGET_ID],
        referenceTargets: [],
        replyToSignalId: "sig-origin",
        text: "@Budget Analyst(wake) hello",
      },
    });
  });

  it("requires a members snapshot when canonical attempts are present", () => {
    expect(() =>
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "Cannot validate canonical mentions right now.",
        text: "@Budget Analyst(wake) Please propose the rollout plan.",
        snapshot: null,
      })
    ).toThrow("Cannot validate canonical mentions right now.");
  });

  it("fails canonical syntax before snapshot-dependent resolution", () => {
    expect(() =>
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "missing snapshot",
        text: "@NameWith(Bracket)(wake) hello",
        snapshot: null,
      })
    ).toThrow(
      "That mention is not valid. Type @ and choose a member from the list."
    );
  });

  it("rejects invalid target lookup and duplicate assignments", () => {
    expect(() =>
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "missing snapshot",
        text: "@budget analyst(wake) hello",
        snapshot: createSnapshot(),
      })
    ).toThrow(
      "That mention does not match a current member. Type @ and choose a member from the list."
    );

    expect(() =>
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "missing snapshot",
        text: [
          "@Budget Analyst(wake) first",
          "@Budget Analyst(reference) second",
        ].join("\n"),
        snapshot: createSnapshot(),
      })
    ).toThrow("same target cannot appear in both wake and reference");
  });

  it("rejects wake mentions for human targets before submitting an envelope", () => {
    expect(
      captureSubmissionError(() =>
        prepareSpaceComposerSubmission({
          missingSnapshotMessage: "missing snapshot",
          text: "@Alice(wake) please handle this.",
          snapshot: createSnapshot(),
        })
      )
    ).toMatchObject({
      code: "addressing.relation_incompatible",
      message: expect.stringContaining(
        "wake is only allowed for agent targets"
      ),
    });
  });

  it("rejects missing canonical mention targets with a stable reason code", () => {
    expect(
      captureSubmissionError(() =>
        prepareSpaceComposerSubmission({
          missingSnapshotMessage: "missing snapshot",
          text: "@Missing Agent(wake) please handle this.",
          snapshot: createSnapshot(),
        })
      )
    ).toMatchObject({
      code: "addressing.target_not_in_current_space",
      message: expect.stringContaining(
        "That mention does not match a current member. Type @ and choose a member from the list."
      ),
    });
  });

  it("rejects unresolved target kind from the members snapshot before submitting an envelope", () => {
    const brokenAgent = {
      ...createAgentMember({
        profileId: AGENT_BUDGET_ID,
        profileName: "Budget Analyst",
        mentionAlias: null,
      }),
      profileKind: undefined,
    } as unknown as SpaceMemberAgentSnapshot;

    const error = captureSubmissionError(() =>
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "missing snapshot",
        text: "@Budget Analyst(wake) please handle this.",
        snapshot: createSnapshot({
          agents: [brokenAgent],
        }),
      })
    );

    expect(isSpaceComposerSubmissionError(error)).toBe(true);
    expect(error).toMatchObject({
      code: "addressing.target_kind_unresolved",
      message: `Cannot resolve Space Message Addressing target kind for profile ${AGENT_BUDGET_ID}.`,
    });
  });

  it("rejects duplicate targets inside the same relation before submitting an envelope", () => {
    expect(
      captureSubmissionError(() =>
        prepareSpaceComposerSubmission({
          missingSnapshotMessage: "missing snapshot",
          text: [
            "@Budget Analyst(wake) first request.",
            "@Budget Analyst(wake) duplicate request.",
          ].join("\n"),
          snapshot: createSnapshot(),
        })
      )
    ).toMatchObject({
      code: "addressing.duplicate_target",
      message: "same target appears more than once in wake",
    });
  });

  it("accepts wake mentions for blocked-readiness agent targets", () => {
    expect(
      prepareSpaceComposerSubmission({
        missingSnapshotMessage: "missing snapshot",
        text: "@Budget Analyst(wake) Please propose the rollout plan.",
        snapshot: createSnapshot({
          agents: [
            createAgentMember({
              agentExecutionReadiness:
                createMissingBindingAgentExecutionReadiness(AGENT_BUDGET_ID),
              profileId: AGENT_BUDGET_ID,
              profileName: "Budget Analyst",
              mentionAlias: null,
              wakeabilityStatus: "blocked",
              wakeabilityReasonText: "Offline from this device right now.",
            }),
          ],
        }),
      })
    ).toMatchObject({
      messageEnvelope: {
        activationTargets: [AGENT_BUDGET_ID],
        referenceTargets: [],
        text: "@Budget Analyst(wake) Please propose the rollout plan.",
      },
      hasStructuredTargets: true,
      resolvedStructuredTargets: {
        profileIdsInTextOrder: [AGENT_BUDGET_ID],
      },
    });
  });
});

function captureSubmissionError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw.");
}

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
  ];

  return createSpaceMembersSnapshot({
    spaceId: "ops-room",
    generatedAt: "2026-03-19T00:00:00.000Z",
    humans,
    agents,
  });
}

function createHumanMember(input: {
  profileId: string;
  profileName: string;
  mentionAlias: string | null;
}): SpaceMemberHumanSnapshot {
  return createSpaceMemberHumanSnapshot({
    status: "active",
    profileId: input.profileId,
    profileName: input.profileName,
    liveNow: false,
    mentionAlias: input.mentionAlias,
  });
}

function createAgentMember(input: {
  profileId: string;
  profileName: string;
  mentionAlias: string | null;
  agentExecutionReadiness?: NonNullable<
    NonNullable<
      SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
    >["agentExecutionReadiness"]
  > | null;
  wakeabilityReasonText?: string;
  wakeabilityStatus?: "ready" | "blocked";
}): SpaceMemberAgentSnapshot {
  const blocked = input.wakeabilityStatus === "blocked";
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
    liveNow: false,
    mentionAlias: input.mentionAlias,
    ...(agentExecutionReadiness === null ? {} : { agentExecutionReadiness }),
    wakeabilityReasonCodes: blocked ? ["route.not_registered"] : [],
    wakeabilityReasonText:
      input.wakeabilityReasonText ??
      (blocked
        ? "This agent is not connected to a local agent yet."
        : "This profile can be woken in Space"),
    wakeabilityStatus: input.wakeabilityStatus ?? "ready",
    wakeRouteEvidence: {
      observedAt: "2026-03-13T00:00:00.000Z",
      reasonCode: "online",
      status: "online",
    },
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
