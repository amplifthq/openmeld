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
        }),
      ],
    });

    expect(response.previousTurns[0]).toMatchObject({
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
    createdAtMs: number;
    deliveryId: string;
    dispatchId: string;
    failureCode: string | null;
    failureDetail: string | null;
    failureDetailTruncated: boolean;
    publicationState: "claimed" | "outcome_unknown" | "published" | null;
    publishedResultId: string | null;
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
    createdAtMs: 1_787_539_182_522,
    deliveryId: "delivery_1",
    dispatchId: "dispatch_1",
    failureCode: null,
    failureDetail: null,
    failureDetailTruncated: false,
    publicationState: null,
    publishedResultId: null,
    status: "accepted" as const,
    submissionId: "remote-agent-slack:event_1",
    submittedAtMs: 1_787_539_183_000,
    triggerMessageId: "1787539182.522639",
    updatedAtMs: 1_787_539_203_000,
    ...overrides,
  };
}
