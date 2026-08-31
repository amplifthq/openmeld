import { describe, expect, it } from "vitest";
import {
  CENTER_AGENT_DELEGATION_COMPLETION_MODES,
  centerAgentDelegationCompletionModeSchema,
  centerAgentListAgentTasksBodySchema,
  centerAgentListAgentTasksResponseSchema,
  centerAgentPostSpaceMessageBodySchema,
  centerAgentSpaceAuthoringContractResponseSchema,
  centerAgentWakeAgentProfilesInSpaceBodySchema,
  centerAgentWakeAgentProfilesInSpaceResponseSchema,
  centerAgentWakePublicationCommandSchema,
  centerAgentWatchAgentTaskBodySchema,
} from "../../src/index";

const HUMAN_REFERENCE = "00000000-0000-4000-8000-000000000004";
const PRIMARY = "agt_00000000-0000-4000-8000-000000000001";
const SECONDARY = "agt_00000000-0000-4000-8000-000000000002";
const FALLBACK = "agt_00000000-0000-4000-8000-000000000003";

describe("Center Agent Space authoring contract", () => {
  it("requires the current two-relation structured Reference capability", () => {
    expect(
      centerAgentSpaceAuthoringContractResponseSchema.parse({
        addressingModel: "wake_reference",
        structuredReferenceTargets: true,
      })
    ).toEqual({
      addressingModel: "wake_reference",
      structuredReferenceTargets: true,
    });
    expect(
      centerAgentSpaceAuthoringContractResponseSchema.safeParse({
        addressingModel: "wake_reference",
        structuredReferenceTargets: false,
      }).success
    ).toBe(false);
  });

  it("advertises the current Human Mention authoring capability", () => {
    expect(
      centerAgentSpaceAuthoringContractResponseSchema.parse({
        addressingModel: "wake_reference_mention",
        structuredMentionTargets: true,
        structuredReferenceTargets: true,
      })
    ).toEqual({
      addressingModel: "wake_reference_mention",
      structuredMentionTargets: true,
      structuredReferenceTargets: true,
    });
  });
});

describe("Center Agent delegation request", () => {
  it("owns one shared completion-mode vocabulary", () => {
    expect(centerAgentDelegationCompletionModeSchema.options).toEqual([
      ...CENTER_AGENT_DELEGATION_COMPLETION_MODES,
    ]);
  });

  it.each(
    CENTER_AGENT_DELEGATION_COMPLETION_MODES
  )("accepts the explicit %s completion mode", (completionMode) => {
    expect(
      centerAgentWakeAgentProfilesInSpaceBodySchema.parse({
        agentProfileIds: [PRIMARY, SECONDARY],
        completionMode,
        spaceId: "space-1",
        text: "Run the checks.",
      }).completionMode
    ).toBe(completionMode);
  });

  it("accepts one distinct fallback without treating it as an initial target", () => {
    expect(
      centerAgentWakeAgentProfilesInSpaceBodySchema.parse({
        agentProfileIds: [PRIMARY],
        completionMode: "resume_parent_when_all_terminal",
        fallbackAgentProfileId: FALLBACK,
        spaceId: "space-1",
        text: "Clone the repository.",
      })
    ).toMatchObject({
      agentProfileIds: [PRIMARY],
      fallbackAgentProfileId: FALLBACK,
    });
  });

  it("keeps Reference profiles structured and separate from Wake targets", () => {
    expect(
      centerAgentWakeAgentProfilesInSpaceBodySchema.parse({
        agentProfileIds: [PRIMARY],
        completionMode: "resume_parent_when_all_terminal",
        referenceProfileIds: [HUMAN_REFERENCE, SECONDARY],
        spaceId: "space-1",
        text: "Run the checks with the launch owner as context.",
      })
    ).toMatchObject({
      agentProfileIds: [PRIMARY],
      referenceProfileIds: [HUMAN_REFERENCE, SECONDARY],
    });
  });

  it("keeps Human Mentions separate from Agent Wake and Reference targets", () => {
    expect(
      centerAgentWakeAgentProfilesInSpaceBodySchema.parse({
        agentProfileIds: [PRIMARY],
        completionMode: "resume_parent_when_all_terminal",
        mentionProfileIds: [HUMAN_REFERENCE],
        referenceProfileIds: [SECONDARY],
        spaceId: "space-1",
        text: "Run the checks and notify the launch owner.",
      })
    ).toMatchObject({
      agentProfileIds: [PRIMARY],
      mentionProfileIds: [HUMAN_REFERENCE],
      referenceProfileIds: [SECONDARY],
    });
  });

  it("accepts a Reference-only Center Agent Space message", () => {
    expect(
      centerAgentPostSpaceMessageBodySchema.parse({
        referenceProfileIds: [HUMAN_REFERENCE, SECONDARY],
        spaceId: "space-1",
        text: "The launch notes are ready.",
      })
    ).toMatchObject({
      referenceProfileIds: [HUMAN_REFERENCE, SECONDARY],
    });
  });

  it("accepts a Human Mention on a Center Agent Space message", () => {
    expect(
      centerAgentPostSpaceMessageBodySchema.parse({
        mentionProfileIds: [HUMAN_REFERENCE],
        referenceProfileIds: [SECONDARY],
        spaceId: "space-1",
        text: "The launch notes are ready.",
      })
    ).toMatchObject({
      mentionProfileIds: [HUMAN_REFERENCE],
      referenceProfileIds: [SECONDARY],
    });
  });

  it.each([
    {
      agentProfileIds: [PRIMARY],
      referenceProfileIds: [PRIMARY],
    },
    {
      agentProfileIds: [PRIMARY],
      completionMode: "resume_parent_when_all_terminal",
      fallbackAgentProfileId: FALLBACK,
      referenceProfileIds: [FALLBACK],
    },
  ])("rejects a profile that is both executable work and Reference context", (addressing) => {
    const result = centerAgentWakeAgentProfilesInSpaceBodySchema.safeParse({
      spaceId: "space-1",
      text: "Run the task.",
      ...addressing,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        message:
          "A profile cannot be both a Wake target and a Reference target.",
        path: ["referenceProfileIds", 0],
      });
    }
  });

  it("normalizes a legacy delegated publication command to no References", () => {
    const command = centerAgentWakePublicationCommandSchema.parse(
      buildWakePublicationCommand()
    );
    expect(command.referenceTargets).toEqual([]);
    expect(command.mentionTargets).toEqual([]);
    expect(command.spaceAddressingVersion).toBeUndefined();
  });

  it("persists Human Mentions in delegated Wake publication commands", () => {
    const command = centerAgentWakePublicationCommandSchema.parse({
      ...buildWakePublicationCommand(),
      mentionTargets: [HUMAN_REFERENCE],
      spaceAddressingVersion: "1",
    });
    expect(command.mentionTargets).toEqual([HUMAN_REFERENCE]);
    expect(command.spaceAddressingVersion).toBe("1");
  });

  it.each([
    {
      activationTargets: [PRIMARY],
      referenceTargets: [PRIMARY],
    },
    {
      activationTargets: [PRIMARY],
      fallbackAgentProfileId: FALLBACK,
      referenceTargets: [FALLBACK],
    },
  ])("rejects overlapping executable and Reference targets in a durable publication command", (addressing) => {
    const result = centerAgentWakePublicationCommandSchema.safeParse({
      ...buildWakePublicationCommand(),
      ...addressing,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        message:
          "A profile cannot be both a Wake target and a Reference target.",
        path: ["referenceTargets", 0],
      });
    }
  });

  it("rejects ambiguous fallback relationships", () => {
    for (const payload of [
      {
        agentProfileIds: [PRIMARY],
        fallbackAgentProfileId: PRIMARY,
      },
      {
        agentProfileIds: [PRIMARY, SECONDARY],
        fallbackAgentProfileId: FALLBACK,
      },
      {
        agentProfileIds: [PRIMARY],
        completionMode: "resume_parent_on_each_terminal",
        fallbackAgentProfileId: FALLBACK,
      },
    ]) {
      expect(
        centerAgentWakeAgentProfilesInSpaceBodySchema.safeParse({
          completionMode: "child_reports_directly",
          spaceId: "space-1",
          text: "Run the task.",
          ...payload,
        }).success
      ).toBe(false);
    }
  });

  it("requires an explicit completion mode when a fallback is present", () => {
    expect(
      centerAgentWakeAgentProfilesInSpaceBodySchema.safeParse({
        agentProfileIds: [PRIMARY],
        fallbackAgentProfileId: FALLBACK,
        spaceId: "space-1",
        text: "Run the task.",
      }).success
    ).toBe(false);
  });

  it("keeps accepted Wake responses backward compatible", () => {
    const response = centerAgentWakeAgentProfilesInSpaceResponseSchema.parse(
      buildWakeResponse({
        signal: buildSignal(),
      })
    );

    expect(response).toMatchObject({
      signal: { id: "signal-1" },
    });
    expect(response).not.toHaveProperty("publicationStatus");
  });

  it("represents a durably queued delegated Wake without pretending it failed", () => {
    const response = buildWakeResponse({
      childTasks: [
        {
          completionCondition: "terminal" as const,
          subscriptionId: "subscription-1",
          task: {
            kind: "space_wake" as const,
            sourceClientMessageId: "client-message-1",
            spaceId: "space-1",
            targetProfileId: PRIMARY,
            v: 1 as const,
          },
        },
      ],
      delegationId: "delegation-1",
      publicationStatus: "pending" as const,
      retryAfterSeconds: 15,
    });

    expect(
      centerAgentWakeAgentProfilesInSpaceResponseSchema.parse(response)
    ).toMatchObject({
      delegationId: "delegation-1",
      publicationStatus: "pending",
      retryAfterSeconds: 15,
    });
    expect(
      centerAgentWakeAgentProfilesInSpaceResponseSchema.safeParse({
        ...response,
        signal: buildSignal(),
      }).success
    ).toBe(false);
  });

  it("rejects incomplete publication status shapes", () => {
    expect(
      centerAgentWakeAgentProfilesInSpaceResponseSchema.safeParse(
        buildWakeResponse({ publicationStatus: "accepted" })
      ).success
    ).toBe(false);
    expect(
      centerAgentWakeAgentProfilesInSpaceResponseSchema.safeParse(
        buildWakeResponse({
          publicationStatus: "pending",
          retryAfterSeconds: 15,
        })
      ).success
    ).toBe(false);
  });
});

describe("Center Agent task watch request", () => {
  it("requires one exact task handle and an explicit completion condition", () => {
    expect(
      centerAgentWatchAgentTaskBodySchema.parse({
        completionCondition: "terminal",
        instruction: "Continue the release after this exact task completes.",
        task: {
          deliveryId: "delivery-1",
          kind: "native_delivery",
          v: 1,
        },
      })
    ).toMatchObject({
      completionCondition: "terminal",
      task: { deliveryId: "delivery-1", kind: "native_delivery" },
    });
  });

  it("does not accept an Agent Profile as a watch target", () => {
    expect(
      centerAgentWatchAgentTaskBodySchema.safeParse({
        completionCondition: "terminal",
        instruction: "Continue later.",
        task: {
          kind: "agent_profile",
          profileId: PRIMARY,
          v: 1,
        },
      }).success
    ).toBe(false);
  });
});

describe("Center Agent task discovery", () => {
  it("returns exact task handles with truthful watch conditions", () => {
    expect(
      centerAgentListAgentTasksResponseSchema.parse({
        hasMore: false,
        organizationId: "org-1",
        tasks: [
          {
            outcome: null,
            registeredAtMs: 1000,
            registrationSource: "codex_user_prompt_submit",
            supportedCompletionConditions: ["terminal"],
            task: {
              agentControllerRef: "builtin:codex",
              hostId: "device-1",
              kind: "controller_task",
              taskId: "turn-1",
              v: 1,
            },
          },
        ],
      })
    ).toMatchObject({
      tasks: [
        {
          supportedCompletionConditions: ["terminal"],
          task: { kind: "controller_task", taskId: "turn-1" },
        },
      ],
    });
  });

  it("keeps discovery bounded and validates controller filters", () => {
    expect(
      centerAgentListAgentTasksBodySchema.parse({
        agentControllerRef: "builtin:codex",
        limit: 20,
      })
    ).toEqual({
      agentControllerRef: "builtin:codex",
      limit: 20,
    });
    expect(
      centerAgentListAgentTasksBodySchema.safeParse({ limit: 21 }).success
    ).toBe(false);
  });
});

function buildWakeResponse(overrides: Record<string, unknown>) {
  return {
    agentProfileIds: [PRIMARY],
    attribution: {
      actorProfileId: "agt_00000000-0000-4000-8000-000000000004",
      onBehalfOf: null,
    },
    organizationId: "org-1",
    resource: { id: "space-1", type: "space" },
    spaceId: "space-1",
    ...overrides,
  };
}

function buildWakePublicationCommand() {
  return {
    activationTargets: [PRIMARY],
    attribution: {
      actorProfileId: "agt_00000000-0000-4000-8000-000000000004",
      onBehalfOf: null,
    },
    clientMessageId: "ca-wake:legacy",
    completionMode: "resume_parent_when_all_terminal",
    context: {
      activeOrganizationId: "org-1",
      actorContext: {
        profileKind: "agent",
        profileName: "Center Agent",
        requestId: "request-parent",
        openMeldProfileId: "agt_00000000-0000-4000-8000-000000000004",
      },
      agentControllerConversationId: "submission-parent",
    },
    delegationId: "delegation-1",
    fallbackAgentProfileId: null,
    organizationId: "org-1",
    parentSubmissionId: "submission-parent",
    profile: {
      kind: "agent",
      profileId: "agt_00000000-0000-4000-8000-000000000004",
      profileName: "Center Agent",
    },
    spaceId: "space-1",
    subscriptionIds: ["subscription-1"],
    text: "Run the task.",
    v: 1,
  };
}

function buildSignal() {
  return {
    data: {
      messageEnvelope: {
        activationTargets: [PRIMARY],
        referenceTargets: [],
        text: "Run the task.",
      },
      meta: { clientMessageId: "client-message-1" },
      text: "Run the task.",
    },
    id: "signal-1",
    profile: {
      kind: "agent" as const,
      profileId: "agt_00000000-0000-4000-8000-000000000004",
      profileName: "Center Agent",
    },
    spaceId: "space-1",
    ts: 1000,
    type: "signal.text" as const,
    v: 1 as const,
  };
}
