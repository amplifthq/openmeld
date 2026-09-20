import type {
  CenterAgentTurnDiagnostic,
  RemoteAgentTurnRuntimeEvidence,
  RemoteAgentWorkerRuntimeDiagnosticsResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  attachCenterAgentTurnRuntimeEvidence,
  projectCenterAgentTurnRuntimeEvidence,
} from "../src/remote-agent/application/center-agent-turn-diagnostics";
import type { RemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";

describe("Center Agent turn runtime evidence", () => {
  it("joins exact submission evidence across the current and previous turns", () => {
    const result = projectCenterAgentTurnRuntimeEvidence({
      runtimeDiagnosticsByConversationId: new Map([
        ["runtime-current", runtimeDiagnostics([])],
        [
          "runtime-previous",
          runtimeDiagnostics([evidence("submission-previous")]),
        ],
      ]),
      turns: [
        {
          runtimeConversationId: "runtime-current",
          turn: turn("submission-current"),
        },
        {
          runtimeConversationId: "runtime-previous",
          turn: turn("submission-previous"),
        },
      ],
    });

    expect(result[0]).toMatchObject({
      runtimeEvidence: null,
      runtimeEvidenceStatus: "not_recorded",
    });
    expect(result[1]).toMatchObject({
      runtimeEvidence: {
        firstModelEventAtMs: 110,
        toolCallCount: 7,
      },
      runtimeEvidenceStatus: "available",
    });
    expect(result[1]?.runtimeEvidence).not.toHaveProperty("submissionId");
  });

  it("marks every turn unavailable when the exact runtime read fails", () => {
    expect(
      projectCenterAgentTurnRuntimeEvidence({
        runtimeDiagnosticsByConversationId: new Map([
          ["runtime-current", null],
        ]),
        turns: [
          {
            runtimeConversationId: "runtime-current",
            turn: turn("submission-current"),
          },
        ],
      })
    ).toMatchObject([
      { runtimeEvidence: null, runtimeEvidenceStatus: "unavailable" },
    ]);
  });

  it("reads each frozen runtime generation for bounded turn history", async () => {
    const readRuntimeDiagnostics = vi.fn(
      async (input: { runtimeConversationId: string }) =>
        runtimeDiagnostics([
          evidence(`submission-${input.runtimeConversationId}`),
        ])
    );

    const result = await attachCenterAgentTurnRuntimeEvidence({
      deliveries: [delivery("current"), delivery("previous")],
      remoteAgentWorker: { readRuntimeDiagnostics } as never,
    });

    expect(readRuntimeDiagnostics).toHaveBeenCalledTimes(2);
    expect(readRuntimeDiagnostics).toHaveBeenCalledWith({
      runtimeConversationId: "current",
      spaceId: "space-1",
    });
    expect(readRuntimeDiagnostics).toHaveBeenCalledWith({
      runtimeConversationId: "previous",
      spaceId: "space-1",
    });
    expect(result).toMatchObject([
      { runtimeEvidenceStatus: "available" },
      { runtimeEvidenceStatus: "available" },
    ]);
  });
});

function delivery(
  runtimeConversationId: string
): RemoteAgentNativeDeliveryRecord {
  const submissionId = `submission-${runtimeConversationId}`;
  return {
    acceptedAtMs: 100,
    callbackReceivedAtMs: null,
    completedAtMs: null,
    conversationKind: "space",
    createdAtMs: 90,
    deliveryId: `delivery-${runtimeConversationId}`,
    dispatchId: `dispatch-${runtimeConversationId}`,
    executionRecoverySubmitRequest: null,
    failureCode: null,
    failureDetail: null,
    finalPublicationState: null,
    idempotencyKey: `request-${runtimeConversationId}`,
    organizationId: "org-1",
    profileId: "agt_11111111-1111-4111-8111-111111111111",
    publishedSignalId: null,
    routineRunId: null,
    spaceId: "space-1",
    status: "accepted",
    submissionId,
    submittedAtMs: 95,
    triggerMessageId: `trigger-${runtimeConversationId}`,
    updatedAtMs: 100,
    workerSubmitRequest: {
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      conversationId: runtimeConversationId,
      dispatchId: `dispatch-${runtimeConversationId}`,
      idempotencyKey: `request-${runtimeConversationId}`,
      organizationId: "org-1",
      spaceId: "space-1",
      v: 1,
    },
  } as unknown as RemoteAgentNativeDeliveryRecord;
}

function turn(submissionId: string): CenterAgentTurnDiagnostic {
  return {
    acceptedAtMs: 100,
    callbackReceivedAtMs: null,
    completedAtMs: null,
    createdAtMs: 90,
    deliveryId: `delivery-${submissionId}`,
    dispatchId: `dispatch-${submissionId}`,
    failureCode: null,
    failureDetail: null,
    failureDetailTruncated: false,
    publicationState: null,
    publishedResultId: null,
    runtimeEvidence: null,
    runtimeEvidenceStatus: "not_recorded",
    status: "accepted",
    submissionId,
    submittedAtMs: 95,
    triggerMessageId: `trigger-${submissionId}`,
    updatedAtMs: 100,
  };
}

function evidence(submissionId: string): RemoteAgentTurnRuntimeEvidence {
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
    recentCapabilityDiscovery: [],
    recentProviderRequests: [],
    recentToolCalls: [],
    submissionId,
    toolCallCount: 7,
    toolCallLimit: 64,
    updatedAtMs: 180,
  };
}

function runtimeDiagnostics(
  turnObservability: RemoteAgentTurnRuntimeEvidence[]
): RemoteAgentWorkerRuntimeDiagnosticsResponse {
  return {
    activeRuns: [],
    attemptMarkers: [],
    callbackContexts: [],
    collectedAt: "2026-08-25T00:00:00.000Z",
    durableObjectAlarmAtMs: null,
    fibers: [],
    schedules: [],
    spaceId: "space-1",
    submissions: [],
    turnObservability,
    v: 1,
  };
}
