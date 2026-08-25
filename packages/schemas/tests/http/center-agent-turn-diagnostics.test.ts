import {
  centerAgentReadTurnDiagnosticsResponseSchema,
  centerAgentReadTurnDiagnosticsRpcInputSchema,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";

describe("Center Agent turn diagnostics contracts", () => {
  it("accepts a bounded current-turn request", () => {
    expect(
      centerAgentReadTurnDiagnosticsRpcInputSchema.parse({
        context: {
          activeOrganizationId: "org_1",
          actorContext: {
            agentControllerRef: "hosted:center-agent",
            callerPrincipalId: "center-agent-owner",
            openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
            ownerUserId: "center-agent-owner",
            profileKind: "agent",
            requestId: "request-turn-diagnostics",
          },
          agentControllerConversationId: "remote-agent-slack:event_current",
        },
        limit: 2,
      })
    ).toMatchObject({ limit: 2 });
  });

  it("keeps recorded completion separate from failure and publication facts", () => {
    const response = centerAgentReadTurnDiagnosticsResponseSchema.parse({
      currentTurn: turn({
        deliveryId: "delivery_current",
        runtimeEvidence: runtimeEvidence(),
        runtimeEvidenceStatus: "available",
        status: "accepted",
        submissionId: "remote-agent-slack:event_current",
      }),
      organizationId: "org_1",
      previousTurns: [
        turn({
          completedAtMs: 1_787_539_424_635,
          deliveryId: "delivery_previous",
          failureCode: null,
          publicationState: "published",
          publishedResultId: "1787539424.635039",
          status: "completed",
          submissionId: "remote-agent-slack:event_previous",
          triggerMessageId: "1787539182.522639",
          conversationSource: {
            channelId: "D_CURRENT",
            isCurrentConversation: false,
            kind: "slack",
            teamId: "T_CURRENT",
            threadTs: "1787539182.522639",
          },
        }),
      ],
    });

    expect(response.currentTurn.runtimeEvidence).toEqual({
      budgetExhaustedAtMs: null,
      capabilityDescribeCount: 1,
      capabilitySearchCount: 2,
      codeModeToolCallCount: 3,
      directToolCallCount: 4,
      firstAssistantTextAtMs: 120,
      firstModelEventAtMs: 110,
      firstProviderRequestPreparedAtMs: 105,
      firstProviderResponseHeadersAtMs: 108,
      firstVisibleContentAtMs: null,
      lastModelCompletedAtMs: 180,
      modelCallCount: 2,
      modelId: "openai/gpt-5.4",
      providerAvailableToolCount: 80,
      providerDeferredToolCount: 68,
      providerExposedToolCount: 12,
      providerRequestCount: 2,
      recentCapabilityDiscovery: [
        {
          capabilityNames: ["openmeld_read_center_agent_turn_diagnostics"],
          observedAtMs: 125,
          operation: "search",
          resultCount: 1,
        },
      ],
      recentProviderRequests: [
        {
          availableToolCount: 80,
          deferredToolCount: 68,
          exposedToolCount: 12,
          modelId: "openai/gpt-5.4",
          preparedAtMs: 105,
        },
      ],
      recentToolCalls: [
        {
          calledAtMs: 130,
          source: "code_mode",
          toolName: "openmeld_read_center_agent_turn_diagnostics",
        },
      ],
      toolCallCount: 7,
      toolCallLimit: 64,
      updatedAtMs: 180,
    });

    expect(response.previousTurns[0]).toMatchObject({
      conversationSource: {
        isCurrentConversation: false,
        kind: "slack",
        threadTs: "1787539182.522639",
      },
      failureCode: null,
      publicationState: "published",
      status: "completed",
    });
  });

  it("rejects unbounded failure detail", () => {
    expect(
      centerAgentReadTurnDiagnosticsResponseSchema.safeParse({
        currentTurn: turn({ failureDetail: "x".repeat(2001) }),
        organizationId: "org_1",
        previousTurns: [],
      }).success
    ).toBe(false);
  });
});

function turn(
  overrides: Partial<{
    acceptedAtMs: number | null;
    callbackReceivedAtMs: number | null;
    completedAtMs: number | null;
    conversationSource:
      | {
          isCurrentConversation: boolean;
          kind: "space";
          spaceId: string;
        }
      | {
          channelId: string;
          isCurrentConversation: boolean;
          kind: "slack";
          teamId: string;
          threadTs: string;
        };
    createdAtMs: number;
    deliveryId: string;
    dispatchId: string;
    failureCode: string | null;
    failureDetail: string | null;
    failureDetailTruncated: boolean;
    publicationState: "claimed" | "outcome_unknown" | "published" | null;
    publishedResultId: string | null;
    runtimeEvidence: ReturnType<typeof runtimeEvidence> | null;
    runtimeEvidenceStatus: "available" | "not_recorded" | "unavailable";
    status:
      | "accepted"
      | "callback_rejected"
      | "completed"
      | "failed"
      | "flag_rejected"
      | "guardrail_rejected"
      | "retry_observed"
      | "submitted"
      | "worker_unavailable";
    submissionId: string | null;
    submittedAtMs: number | null;
    triggerMessageId: string;
    updatedAtMs: number;
  }> = {}
) {
  return {
    acceptedAtMs: 1_787_539_203_000,
    callbackReceivedAtMs: null,
    completedAtMs: null,
    conversationSource: {
      channelId: "D_CURRENT",
      isCurrentConversation: true,
      kind: "slack" as const,
      teamId: "T_CURRENT",
      threadTs: "1787539713.153179",
    },
    createdAtMs: 1_787_539_182_522,
    deliveryId: "delivery_1",
    dispatchId: "dispatch_1",
    failureCode: null,
    failureDetail: null,
    failureDetailTruncated: false,
    publicationState: null,
    publishedResultId: null,
    runtimeEvidence: null,
    runtimeEvidenceStatus: "not_recorded" as const,
    status: "accepted" as const,
    submissionId: "remote-agent-slack:event_1",
    submittedAtMs: 1_787_539_183_000,
    triggerMessageId: "1787539182.522639",
    updatedAtMs: 1_787_539_203_000,
    ...overrides,
  };
}

function runtimeEvidence() {
  return {
    budgetExhaustedAtMs: null,
    capabilityDescribeCount: 1,
    capabilitySearchCount: 2,
    codeModeToolCallCount: 3,
    directToolCallCount: 4,
    firstAssistantTextAtMs: 120,
    firstModelEventAtMs: 110,
    firstProviderRequestPreparedAtMs: 105,
    firstProviderResponseHeadersAtMs: 108,
    firstVisibleContentAtMs: null,
    lastModelCompletedAtMs: 180,
    modelCallCount: 2,
    modelId: "openai/gpt-5.4",
    providerAvailableToolCount: 80,
    providerDeferredToolCount: 68,
    providerExposedToolCount: 12,
    providerRequestCount: 2,
    recentCapabilityDiscovery: [
      {
        capabilityNames: ["openmeld_read_center_agent_turn_diagnostics"],
        observedAtMs: 125,
        operation: "search" as const,
        resultCount: 1,
      },
    ],
    recentProviderRequests: [
      {
        availableToolCount: 80,
        deferredToolCount: 68,
        exposedToolCount: 12,
        modelId: "openai/gpt-5.4",
        preparedAtMs: 105,
      },
    ],
    recentToolCalls: [
      {
        calledAtMs: 130,
        source: "code_mode" as const,
        toolName: "openmeld_read_center_agent_turn_diagnostics",
      },
    ],
    toolCallCount: 7,
    toolCallLimit: 64,
    updatedAtMs: 180,
  };
}
