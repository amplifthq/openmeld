import { describe, expect, it } from "vitest";
import {
  buildPersonalRemoteAgentConversationId,
  buildRemoteAgentRoutineRunConversationId,
  buildRemoteAgentRuntimeConversationId,
  CHANNEL_CONTEXT_MAX_MESSAGES,
  CHANNEL_CONTEXT_MESSAGE_TEXT_MAX_CHARS,
  CHANNEL_CONTEXT_TOTAL_TEXT_MAX_CHARS,
  channelContextSchema,
  DISPATCH_ERROR_SUMMARY_MAX_LENGTH,
  REMOTE_AGENT_ADMISSION_STAGE_OPERATIONS,
  REMOTE_AGENT_CONVERSATION_CONTINUITY_ENTRY_TEXT_MAX_CHARS,
  REMOTE_AGENT_RPC_OPERATIONS,
  REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES,
  remoteAgentAdmissionStageOperationSchema,
  remoteAgentConversationContinuityEntrySchema,
  remoteAgentCoreCallbackBodySchema,
  remoteAgentCoreCallbackEventSchema,
  remoteAgentCoreCallbackResponseSchema,
  remoteAgentRpcOperationSchema,
  remoteAgentRuntimeEvidenceOutcomeReasonCodeSchema,
  remoteAgentTurnEnvelopeSchema,
  remoteAgentWorkerAdmissionRejectedResponseSchema,
  remoteAgentWorkerCancellationRequestSchema,
  remoteAgentWorkerInputAttachmentsSchema,
  remoteAgentWorkerReadAdmissionResponseSchema,
  remoteAgentWorkerReadUsageDiagnosticsRequestSchema,
  remoteAgentWorkerRuntimeDiagnosticsRequestSchema,
  remoteAgentWorkerRuntimeDiagnosticsResponseSchema,
  remoteAgentWorkerSubmitMessagesResultSchema,
  remoteAgentWorkerSubmitTurnRequestSchema,
  remoteAgentWorkerSubmitTurnResponseSchema,
  routineWorkflowContinuationEventPayloadSchema,
  SPACE_FILE_MAX_SIZE_BYTES,
} from "../../src/index";

const TEST_CENTER_AGENT_MODEL_ROUTE = {
  automaticModelFallback: false,
  catalogUpdatedAt: "2026-07-31T00:00:00.000Z",
  contextWindow: 1_000_000,
  displayName: "DeepSeek V4 Flash",
  imageUnderstandingModel: {
    contextWindow: 500_000,
    displayName: "Grok 4.5",
    inputModalities: ["text", "image"],
    maxOutputTokens: 16_384,
    modelId: "x-ai/grok-4.5",
    provider: "openrouter",
    reasoningLevel: "high",
  },
  inputModalities: ["text"],
  maxOutputTokens: 16_384,
  modelId: "deepseek/deepseek-v4-flash",
  preference: {
    kind: "selected_model",
    modelId: "deepseek/deepseek-v4-flash",
  },
  provider: "openrouter",
  reasoningLevel: "high",
} as const;

describe("Remote Agent worker contracts", () => {
  it("requires a finalized replay ACK for admission lookup and keeps missing receipts unconfirmed", () => {
    const receipt = {
      v: 1,
      status: "found",
      ack: {
        accepted: false,
        createdAt: 1000,
        status: "pending",
        submissionId: "original-submission",
        idempotencyKey: "original-operation",
      },
    };
    expect(
      remoteAgentWorkerReadAdmissionResponseSchema.safeParse(receipt).success
    ).toBe(true);
    for (const ack of [
      { ...receipt.ack, accepted: true },
      { ...receipt.ack, idempotencyKey: undefined },
      { ...receipt.ack, submissionId: undefined },
    ]) {
      expect(
        remoteAgentWorkerReadAdmissionResponseSchema.safeParse({
          ...receipt,
          ack,
        }).success
      ).toBe(false);
    }
    for (const status of ["not_found", "unconfirmed"]) {
      expect(
        remoteAgentWorkerReadAdmissionResponseSchema.parse({ v: 1, status })
      ).toEqual({ v: 1, status });
      expect(
        remoteAgentWorkerReadAdmissionResponseSchema.safeParse({
          v: 1,
          status,
          ack: receipt.ack,
        }).success
      ).toBe(false);
    }
  });

  it("isolates personal conversations by organization, Agent and Space and rejects mismatched routing", () => {
    const identity = {
      organizationId: "org_1",
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      spaceId: "space_1",
    };
    const conversationId = buildPersonalRemoteAgentConversationId(identity);
    for (const other of [
      { organizationId: "org_2" },
      { agentProfileId: "agt_22222222-2222-4222-8222-222222222222" },
      { spaceId: "space_2" },
    ]) {
      expect(
        buildPersonalRemoteAgentConversationId({ ...identity, ...other })
      ).not.toBe(conversationId);
    }
    const request = {
      ...identity,
      v: 4,
      conversationId,
      conversationIdentity: {
        kind: "personal_agent",
        agentProfileId: identity.agentProfileId,
      },
      runtimeConversation: { generation: 0, id: conversationId },
      spaceDispatchContext: {
        dispatchChainId: "chain_1",
        autoRelayDepth: 0,
        visitedProfileIds: [],
        visitedProfileIdsHash: "hash_1",
      },
      agentProfileOwnerUserId: "user_1",
      bindingId: "binding_1",
      triggerMessageId: "signal_1",
      dispatchId: "dispatch_1",
      sourceClientMessageId: null,
      idempotencyKey: "dispatch_1",
      messages: [{ role: "user", content: "Help in this Space." }],
      author: {
        displayName: "Felix",
        profileId: "00000000-0000-4000-8000-000000000001",
        profileKind: "human",
      },
      onBehalfOf: null,
      modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
      turnEnvelope: createRemoteAgentTurnEnvelope(),
    };
    expect(
      remoteAgentWorkerSubmitTurnRequestSchema.safeParse(request).success
    ).toBe(true);
    const routineTrigger = {
      authorizedActions: [],
      destination: { kind: "space" as const, spaceId: identity.spaceId },
      routineId: "routine_1",
      routineName: "Daily review",
      runId: "routine_run_1",
      scheduledFor: 1_783_382_400_000,
      source: "routine" as const,
    };
    const routineConversationId = buildRemoteAgentRoutineRunConversationId({
      agentProfileId: identity.agentProfileId,
      organizationId: identity.organizationId,
      runId: routineTrigger.runId,
    });
    expect(
      buildRemoteAgentRoutineRunConversationId({
        agentProfileId: identity.agentProfileId,
        organizationId: identity.organizationId,
        runId: "routine_run_2",
      })
    ).not.toBe(routineConversationId);
    const routineRequest = {
      ...request,
      conversationId: routineConversationId,
      runtimeConversation: { generation: 0, id: routineConversationId },
      turnEnvelope: {
        ...request.turnEnvelope,
        sender: {
          createdByUserId: "user_1",
          delegatedBy: {
            displayName: "Felix",
            id: "member_1",
            ownerUserId: "user_1",
            verified: true,
          },
          kind: "routine",
          routineId: routineTrigger.routineId,
        },
        trigger: routineTrigger,
      },
    };
    expect(
      remoteAgentWorkerSubmitTurnRequestSchema.safeParse(routineRequest).success
    ).toBe(true);
    expect(
      remoteAgentWorkerSubmitTurnRequestSchema.safeParse({
        ...routineRequest,
        conversationId,
        runtimeConversation: { generation: 0, id: conversationId },
      }).success
    ).toBe(true);
    expect(
      remoteAgentWorkerSubmitTurnRequestSchema.safeParse({
        ...routineRequest,
        turnEnvelope: {
          ...routineRequest.turnEnvelope,
          trigger: { ...routineTrigger, runId: "routine_run_2" },
        },
      }).success
    ).toBe(false);
    for (const invalid of [
      { v: 3 },
      {
        conversationIdentity: {
          kind: "center_agent_task",
          taskId: "retired-task",
        },
      },
      { spaceId: "space_2" },
      { conversationId: "space_1" },
      { spaceDispatchContext: undefined },
      {
        conversationIdentity: {
          kind: "personal_agent",
          agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
        },
      },
    ]) {
      expect(
        remoteAgentWorkerSubmitTurnRequestSchema.safeParse({
          ...request,
          ...invalid,
        }).success
      ).toBe(false);
    }
  });
  it("admits ten canonical Space File images without widening legacy attachment limits", () => {
    const canonicalImages = Array.from({ length: 10 }, (_, index) => ({
      fileName: `screen-${index + 1}.png`,
      id: `space-file-${index + 1}`,
      mimeType: "image/png" as const,
      objectKey: `org/org_1/space/space_1/files/space-file-${index + 1}/revisions/revision-1`,
      sizeBytes: SPACE_FILE_MAX_SIZE_BYTES,
    }));

    expect(
      remoteAgentWorkerInputAttachmentsSchema.parse(canonicalImages)
    ).toEqual(canonicalImages);
    expect(
      remoteAgentWorkerInputAttachmentsSchema.safeParse([
        ...canonicalImages,
        {
          ...canonicalImages[0],
          id: "space-file-11",
          objectKey:
            "org/org_1/space/space_1/files/space-file-11/revisions/revision-1",
        },
      ]).success
    ).toBe(false);
    expect(
      remoteAgentWorkerInputAttachmentsSchema.safeParse(
        Array.from({ length: 5 }, (_, index) => ({
          id: `legacy-${index + 1}`,
          mimeType: "image/png" as const,
          sizeBytes: 1024,
        }))
      ).success
    ).toBe(false);
  });

  it("derives one deterministic internal runtime route per logical conversation generation", () => {
    expect(
      buildRemoteAgentRuntimeConversationId({
        generation: 0,
        logicalConversationId: "space_1",
        organizationId: "org_1",
      })
    ).toBe("space_1");

    const generationOne = buildRemoteAgentRuntimeConversationId({
      generation: 1,
      logicalConversationId: "space_1",
      organizationId: "org_1",
    });
    expect(generationOne).toContain("remote-agent-runtime-generation.v1");
    expect(generationOne).not.toBe(
      buildRemoteAgentRuntimeConversationId({
        generation: 1,
        logicalConversationId: "space_1",
        organizationId: "org_2",
      })
    );
  });

  it("accepts a version-four turn with a separately named runtime generation and bounded continuity", () => {
    const logicalConversationId = "space_1";
    const runtimeConversationId = buildRemoteAgentRuntimeConversationId({
      generation: 1,
      logicalConversationId,
      organizationId: "org_1",
    });
    const parsed = remoteAgentWorkerSubmitTurnRequestSchema.parse({
      v: 4,
      organizationId: "org_1",
      spaceId: "space_1",
      conversationId: logicalConversationId,
      runtimeConversation: {
        generation: 1,
        id: runtimeConversationId,
      },
      continuityContext: {
        entries: [
          {
            author: {
              displayName: "Felix",
              id: "profile_1",
              kind: "human",
            },
            content: {
              materializedContentHash:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              originalCharacterCount: 19,
              text: "Keep investigating.",
              truncated: false,
            },
            occurredAt: "2026-08-11T04:00:00.000Z",
            source: {
              kind: "space_signal",
              signalId: "signal_1",
              spaceId: "space_1",
              version:
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
          },
        ],
        fromGeneration: 0,
        logicalConversationId,
        toGeneration: 1,
        truncated: false,
        v: 1,
      },
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      agentProfileOwnerUserId: "user_1",
      bindingId: "binding_1",
      triggerMessageId: "signal_2",
      dispatchId: "dispatch_2",
      sourceClientMessageId: "client_2",
      idempotencyKey: "space_1:dispatch_2",
      messages: [{ role: "user", content: "What did you find?" }],
      author: {
        displayName: "Felix",
        profileId: "00000000-0000-4000-8000-000000000001",
        profileKind: "human",
      },
      onBehalfOf: null,
      modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
      turnEnvelope: createRemoteAgentTurnEnvelope(),
    });

    expect(parsed).toMatchObject({
      conversationId: logicalConversationId,
      runtimeConversation: { generation: 1, id: runtimeConversationId },
      v: 4,
    });
  });

  it("bounds continuity entry text by Unicode characters", () => {
    const createEntry = (text: string) => ({
      author: { kind: "human" as const },
      content: {
        materializedContentHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        originalCharacterCount: Array.from(text).length,
        text,
        truncated: false,
      },
      occurredAt: "2026-08-11T04:00:00.000Z",
      source: {
        kind: "space_signal" as const,
        signalId: "signal_1",
        spaceId: "space_1",
        version:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    });
    expect(
      remoteAgentConversationContinuityEntrySchema.safeParse(
        createEntry(
          "😀".repeat(REMOTE_AGENT_CONVERSATION_CONTINUITY_ENTRY_TEXT_MAX_CHARS)
        )
      ).success
    ).toBe(true);
    expect(
      remoteAgentConversationContinuityEntrySchema.safeParse(
        createEntry(
          "😀".repeat(
            REMOTE_AGENT_CONVERSATION_CONTINUITY_ENTRY_TEXT_MAX_CHARS + 1
          )
        )
      ).success
    ).toBe(false);
  });

  it("rejects a version-four runtime route that does not match its logical conversation generation", () => {
    const request = {
      v: 4,
      organizationId: "org_1",
      spaceId: "space_1",
      conversationId: "space_1",
      runtimeConversation: { generation: 1, id: "space_1" },
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      agentProfileOwnerUserId: "user_1",
      bindingId: "binding_1",
      triggerMessageId: "signal_2",
      dispatchId: "dispatch_2",
      sourceClientMessageId: "client_2",
      idempotencyKey: "space_1:dispatch_2",
      messages: [{ role: "user", content: "Continue." }],
      author: {
        displayName: "Felix",
        profileId: "00000000-0000-4000-8000-000000000001",
        profileKind: "human",
      },
      onBehalfOf: null,
      modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
      turnEnvelope: createRemoteAgentTurnEnvelope(),
    };

    expect(
      remoteAgentWorkerSubmitTurnRequestSchema.safeParse(request).success
    ).toBe(false);
  });

  it("keeps every durable admission stage on one shared contract", () => {
    expect(
      Object.values(REMOTE_AGENT_ADMISSION_STAGE_OPERATIONS).map((operation) =>
        remoteAgentAdmissionStageOperationSchema.parse(operation)
      )
    ).toEqual([
      "callback_retry_arm_completed",
      "callback_retry_arm_started",
      "durable_object_entered",
      "durable_object_exited",
      "flue_request_completed",
      "flue_request_started",
      "provider_registered",
      "storage_initialized",
      "submission_acknowledged",
      "submission_attachments_resolved",
      "submission_dedupe_completed",
      "submission_request_digested",
      "submission_started",
    ]);
    expect(
      remoteAgentAdmissionStageOperationSchema.safeParse("unknown_stage")
        .success
    ).toBe(false);
  });

  it("keeps every observed RPC operation on one shared contract", () => {
    expect(
      Object.values(REMOTE_AGENT_RPC_OPERATIONS).map((operation) =>
        remoteAgentRpcOperationSchema.parse(operation)
      )
    ).toEqual([
      "cancelExecution",
      "receiveExecutionInput",
      "readExecutionInput",
      "readExecutionState",
      "readAdmission",
      "readAdmissionStop",
      "reconcileExecution",
      "readRuntimeDiagnostics",
      "readUsageDiagnostics",
      "submitConversationTurn",
      "summarizeAgentActivityDigest",
    ]);
    expect(remoteAgentRpcOperationSchema.safeParse("unknownRpc").success).toBe(
      false
    );
  });

  it("keeps runtime evidence reason codes on one shared contract", () => {
    expect(
      remoteAgentRuntimeEvidenceOutcomeReasonCodeSchema.parse(
        REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_TIMEOUT
      )
    ).toBe("remote_agent.turn.timeout");
    expect(
      remoteAgentRuntimeEvidenceOutcomeReasonCodeSchema.parse(
        "remote_agent.routine_identity_mismatch"
      )
    ).toBe("remote_agent.routine_identity_mismatch");
    expect(
      remoteAgentRuntimeEvidenceOutcomeReasonCodeSchema.safeParse(
        "remote_agent.unbounded_new_reason"
      ).success
    ).toBe(false);
  });

  it("validates usage diagnostics RPC identity through the shared contract", () => {
    expect(
      remoteAgentWorkerReadUsageDiagnosticsRequestSchema.parse({
        organizationId: "org_123",
        runtimeConversationId:
          "remote-agent-runtime-generation.v1|7:org_123|9:space_123|2",
        spaceId: "space_123",
      })
    ).toEqual({
      organizationId: "org_123",
      runtimeConversationId:
        "remote-agent-runtime-generation.v1|7:org_123|9:space_123|2",
      spaceId: "space_123",
    });
    expect(
      remoteAgentWorkerReadUsageDiagnosticsRequestSchema.safeParse(null).success
    ).toBe(false);
  });

  it("keeps runtime diagnostics bounded and free of persisted payload bodies", () => {
    expect(
      remoteAgentWorkerRuntimeDiagnosticsRequestSchema.parse({
        runtimeConversationId:
          "remote-agent-runtime-generation.v1|7:org_123|9:space_123|2",
        spaceId: "space_123",
      })
    ).toEqual({
      runtimeConversationId:
        "remote-agent-runtime-generation.v1|7:org_123|9:space_123|2",
      spaceId: "space_123",
    });
    expect(
      remoteAgentWorkerRuntimeDiagnosticsResponseSchema.parse({
        activeRuns: [],
        attemptMarkers: [],
        callbackContexts: [
          {
            callbackAttempts: 1,
            callbackCompletedAt: null,
            callbackNextAttemptAt: "2026-07-28T00:00:05.000Z",
            callbackStatus: "retryable",
            dispatchId: "dispatch_123",
            hasCompletedText: true,
            lastCoreResponseReasonCode:
              "remote_agent.callback_failure_publish_failed",
            lastCoreResponseStatus: "retryable",
            lastFailureCode: "remote_agent.core_callback_failed",
            submissionId: "submission_123",
            updatedAtMs: 1000,
          },
        ],
        collectedAt: "2026-07-28T00:00:00.000Z",
        durableObjectAlarmAtMs: null,
        fibers: [],
        schedules: [],
        spaceId: "space_123",
        submissions: [],
        turnObservability: [
          {
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
                capabilityNames: [
                  "openmeld_read_center_agent_turn_diagnostics",
                ],
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
            submissionId: "submission-1",
            toolCallCount: 7,
            toolCallLimit: 64,
            updatedAtMs: 180,
          },
        ],
        v: 1,
      })
    ).toMatchObject({
      activeRuns: [],
      attemptMarkers: [],
      callbackContexts: [
        {
          callbackAttempts: 1,
          callbackCompletedAt: null,
          callbackNextAttemptAt: "2026-07-28T00:00:05.000Z",
          callbackStatus: "retryable",
          dispatchId: "dispatch_123",
          hasCompletedText: true,
          lastCoreResponseReasonCode:
            "remote_agent.callback_failure_publish_failed",
          lastCoreResponseStatus: "retryable",
          lastFailureCode: "remote_agent.core_callback_failed",
          submissionId: "submission_123",
          updatedAtMs: 1000,
        },
      ],
      collectedAt: "2026-07-28T00:00:00.000Z",
      durableObjectAlarmAtMs: null,
      fibers: [],
      schedules: [],
      spaceId: "space_123",
      submissions: [],
      v: 1,
    });
  });

  it("accepts the Think durable submission ACK shape including idempotent retry ACKs", () => {
    expect(
      remoteAgentWorkerSubmitMessagesResultSchema.parse({
        submissionId: "sub_123",
        idempotencyKey: "space_1:dispatch_1",
        requestId: "req_123",
        status: "pending",
        metadata: { source: "openmeld" },
        createdAt: 1_783_337_503_676,
        accepted: true,
      })
    ).toEqual({
      submissionId: "sub_123",
      idempotencyKey: "space_1:dispatch_1",
      requestId: "req_123",
      status: "pending",
      metadata: { source: "openmeld" },
      createdAt: 1_783_337_503_676,
      accepted: true,
    });

    expect(
      remoteAgentWorkerSubmitMessagesResultSchema.parse({
        submissionId: "sub_123",
        idempotencyKey: "space_1:dispatch_1",
        requestId: "req_retry",
        status: "running",
        createdAt: 1_783_337_503_676,
        accepted: false,
      }).accepted
    ).toBe(false);
  });

  it("requires the Think-created timestamp instead of accepting a Core-shaped ACK", () => {
    expect(
      remoteAgentWorkerSubmitMessagesResultSchema.safeParse({
        submissionId: "sub_123",
        idempotencyKey: "space_1:dispatch_1",
        status: "pending",
        accepted: true,
      }).success
    ).toBe(false);
  });

  it("represents deterministic worker admission rejection without inventing a submission", () => {
    const rejection = {
      idempotencyKey: "routine_run_1",
      message:
        "Remote Agent Routine execution identity does not match its turn envelope.",
      outcome: "rejected",
      reasonCode: "remote_agent.routine_identity_mismatch",
      v: 1,
    } as const;

    expect(
      remoteAgentWorkerAdmissionRejectedResponseSchema.parse(rejection)
    ).toEqual(rejection);
    expect(remoteAgentWorkerSubmitTurnResponseSchema.parse(rejection)).toEqual(
      rejection
    );
    expect(
      remoteAgentWorkerSubmitMessagesResultSchema.safeParse(rejection).success
    ).toBe(false);

    expect(
      remoteAgentWorkerAdmissionRejectedResponseSchema.parse({
        ...rejection,
        message:
          "Remote Agent rejected the turn before replay because its conversation history reached the safety limit.",
        reasonCode: "remote_agent.conversation_history_limit_exceeded",
      }).reasonCode
    ).toBe("remote_agent.conversation_history_limit_exceeded");
  });

  it("requires the Agent Profile owner on Core-originated turn submissions", () => {
    expect(
      remoteAgentWorkerSubmitTurnRequestSchema.parse({
        v: 1,
        organizationId: "org_1",
        spaceId: "space_1",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        agentProfileOwnerUserId: "user_1",
        bindingId: "binding_1",
        triggerMessageId: "signal_1",
        dispatchId: "dispatch_1",
        toolExecutionDeadlineAtMs: 1_783_337_743_676,
        sourceClientMessageId: "client_1",
        idempotencyKey: "space_1:dispatch_1",
        messages: [
          {
            role: "user",
            content: "Create a Release Agent.",
            attachments: [
              {
                id: "attachment-1",
                mimeType: "image/png",
                sizeBytes: 1024,
                width: 800,
                height: 600,
                fileName: "release-plan.png",
              },
            ],
          },
        ],
        author: {
          displayName: "Felix",
          profileId: "00000000-0000-4000-8000-000000000001",
          profileKind: "human",
        },
        onBehalfOf: null,
        turnEnvelope: createRemoteAgentTurnEnvelope(),
      })
    ).toMatchObject({
      agentProfileOwnerUserId: "user_1",
      idempotencyKey: "space_1:dispatch_1",
      toolExecutionDeadlineAtMs: 1_783_337_743_676,
      messages: [
        {
          attachments: [
            {
              id: "attachment-1",
              mimeType: "image/png",
              sizeBytes: 1024,
              width: 800,
              height: 600,
              fileName: "release-plan.png",
            },
          ],
        },
      ],
      turnEnvelope: {
        organization: {
          name: "OpenMeld Labs",
        },
        trigger: {
          source: "web_dm",
        },
      },
    });

    expect(
      remoteAgentWorkerSubmitTurnRequestSchema.safeParse({
        v: 1,
        organizationId: "org_1",
        spaceId: "space_1",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        agentProfileOwnerUserId: "user_1",
        bindingId: "binding_1",
        triggerMessageId: "signal_1",
        dispatchId: "dispatch_1",
        idempotencyKey: "space_1:dispatch_1",
        messages: [
          {
            role: "user",
            content: "Inspect these images.",
            attachments: Array.from({ length: 5 }, (_, index) => ({
              id: `attachment-${index}`,
              mimeType: "image/png",
              sizeBytes: 1024,
            })),
          },
        ],
        author: {
          displayName: "Felix",
          profileId: "00000000-0000-4000-8000-000000000001",
          profileKind: "human",
        },
        onBehalfOf: null,
        turnEnvelope: createRemoteAgentTurnEnvelope(),
      }).success
    ).toBe(false);

    expect(
      remoteAgentWorkerSubmitTurnRequestSchema.safeParse({
        v: 1,
        organizationId: "org_1",
        spaceId: "space_1",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "binding_1",
        triggerMessageId: "signal_1",
        dispatchId: "dispatch_1",
        idempotencyKey: "space_1:dispatch_1",
        messages: [{ role: "user", content: "Create a Release Agent." }],
        author: {
          displayName: "Felix",
          profileId: "00000000-0000-4000-8000-000000000001",
          profileKind: "human",
        },
        onBehalfOf: null,
      }).success
    ).toBe(false);
  });

  it("freezes the resolved model route on version 2 turn submissions", () => {
    const request = {
      v: 2,
      organizationId: "org_1",
      spaceId: "space_1",
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      agentProfileOwnerUserId: "user_1",
      bindingId: "binding_1",
      triggerMessageId: "signal_1",
      dispatchId: "dispatch_1",
      idempotencyKey: "space_1:dispatch_1",
      messages: [{ role: "user", content: "Continue the task." }],
      author: {
        displayName: "Felix",
        profileId: "00000000-0000-4000-8000-000000000001",
        profileKind: "human",
      },
      onBehalfOf: null,
      modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
      turnEnvelope: createRemoteAgentTurnEnvelope(),
    } as const;

    expect(remoteAgentWorkerSubmitTurnRequestSchema.parse(request)).toEqual(
      request
    );
    expect(
      remoteAgentWorkerSubmitTurnRequestSchema.safeParse({
        ...request,
        modelRoute: undefined,
      }).success
    ).toBe(false);
  });

  it("carries the Task conversation route on execution control without changing execution identity", () => {
    expect(
      remoteAgentWorkerCancellationRequestSchema.parse({
        conversationId: "center-agent-task:task_1",
        idempotencyKey: "task_attempt_1",
        organizationId: "org_1",
        reason: "Stopped by the user.",
        spaceId: "space_1",
        submissionId: "submission_1",
        v: 1,
      })
    ).toMatchObject({ conversationId: "center-agent-task:task_1" });
  });

  it("validates the Center Agent turn envelope shape", () => {
    expect(
      remoteAgentTurnEnvelopeSchema.parse(createRemoteAgentTurnEnvelope())
    ).toEqual({
      sender: {
        kind: "member",
        id: "member_1",
        displayName: "Felix",
        role: "owner",
        verified: true,
      },
      space: {
        id: "space_1",
        name: "Felix and Center Agent",
        kind: "dm",
        isCenterAgentDm: true,
      },
      organization: {
        id: "org_1",
        name: "OpenMeld Labs",
        personal: false,
        memberCount: 3,
      },
      centerAgent: {
        profileName: "Center Agent",
        profileHandle: "center-agent",
      },
      trigger: {
        source: "web_dm",
      },
    });

    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...createRemoteAgentTurnEnvelope(),
        trigger: { source: "slack" },
      }).success
    ).toBe(true);
  });

  it("accepts a frozen interaction environment while legacy senders remain valid", () => {
    const legacyEnvelope = createRemoteAgentTurnEnvelope();

    expect(remoteAgentTurnEnvelopeSchema.parse(legacyEnvelope)).toEqual(
      legacyEnvelope
    );
    expect(
      remoteAgentTurnEnvelopeSchema.parse({
        ...legacyEnvelope,
        interactionEnvironment: "requester_private",
      }).interactionEnvironment
    ).toBe("requester_private");
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...legacyEnvelope,
        interactionEnvironment: "unknown_audience",
      }).success
    ).toBe(false);
  });

  it("accepts only one bounded versioned Center Agent Context Scope Plan", () => {
    const envelope = createRemoteAgentTurnEnvelope();
    const contextScopePlan = {
      authenticationSecrets: "never_available" as const,
      interactionEnvironment: "requester_private" as const,
      memberMemory: "use_and_share" as const,
      organizationDocuments: "share_when_authorized" as const,
      organizationMemory: "share_when_authorized" as const,
      organizationSkills: "share_when_authorized" as const,
      protectedInformation: "share_when_authorized" as const,
      requesterIdentity: "verified_member" as const,
      resultAudience: "requester_only" as const,
      v: 1 as const,
    };

    expect(
      remoteAgentTurnEnvelopeSchema.parse({
        ...envelope,
        contextScopePlan,
      }).contextScopePlan
    ).toEqual(contextScopePlan);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...envelope,
        contextScopePlan: { ...contextScopePlan, v: 2 },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...envelope,
        contextScopePlan: {
          ...contextScopePlan,
          organizationDocuments: "unknown_handling",
        },
      }).success
    ).toBe(false);
  });

  it("accepts only a bounded optional Space guide projection", () => {
    const withGuide = {
      ...createRemoteAgentTurnEnvelope(),
      space: {
        ...createRemoteAgentTurnEnvelope().space,
        guide: "g".repeat(100_000),
      },
    };

    expect(remoteAgentTurnEnvelopeSchema.parse(withGuide)).toEqual(withGuide);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...withGuide,
        space: { ...withGuide.space, guide: "g".repeat(100_001) },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...withGuide,
        space: { ...withGuide.space, guide: "   " },
      }).success
    ).toBe(false);
  });

  it("keeps Slack reply placement and channel names optional without weakening strict parsing", () => {
    const slackEnvelope = {
      ...createRemoteAgentTurnEnvelope(),
      trigger: {
        source: "slack",
        channelName: "all",
      },
    };

    expect(remoteAgentTurnEnvelopeSchema.parse(slackEnvelope)).toEqual(
      slackEnvelope
    );
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...slackEnvelope,
        trigger: { source: "slack" },
      }).success
    ).toBe(true);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...slackEnvelope,
        trigger: {
          ...slackEnvelope.trigger,
          channelId: "C123",
          replyPlacement: "conversation",
        },
      }).success
    ).toBe(true);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...slackEnvelope,
        trigger: {
          ...slackEnvelope.trigger,
          replyPlacement: "sidebar",
        },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...slackEnvelope,
        trigger: {
          ...slackEnvelope.trigger,
          unexpectedId: "unexpected",
        },
      }).success
    ).toBe(false);
  });

  it("accepts one provider-neutral Message Channel trigger and memory source", () => {
    const messageChannelEnvelope = {
      ...createRemoteAgentTurnEnvelope(),
      space: {
        id: "lark:cli_123:oc_chat_123:om_message_123",
        name: "Lark conversation",
        kind: "space",
        isCenterAgentDm: false,
      },
      trigger: {
        source: "message_channel",
        provider: "lark",
        connectionId: "connection_123",
        conversationId: "lark:cli_123:oc_chat_123:om_message_123",
      },
      channelContext: {
        provider: "lark",
        conversationId: "lark:cli_123:oc_chat_123:om_message_123",
        currentMessageId: "om_current",
        sync: {
          mode: "snapshot",
          status: "complete",
        },
        messages: [],
      },
      memory: {
        items: [
          {
            source: "message_channel_conversation",
            provider: "lark",
            subject: "organization",
            text: "The launch thread is waiting on API access.",
          },
        ],
        truncated: false,
      },
    } as const;

    expect(remoteAgentTurnEnvelopeSchema.parse(messageChannelEnvelope)).toEqual(
      messageChannelEnvelope
    );
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...messageChannelEnvelope,
        channelContext: {
          ...messageChannelEnvelope.channelContext,
          provider: "feishu",
        },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...messageChannelEnvelope,
        memory: {
          items: [
            {
              ...messageChannelEnvelope.memory.items[0],
              provider: undefined,
            },
          ],
          truncated: false,
        },
      }).success
    ).toBe(false);
  });

  it("accepts one bounded provider-neutral channel context projection", () => {
    const channelContext = {
      provider: "slack",
      conversationId: "slack:T123:C123:1710000000.000100",
      currentMessageId: "1710000002.000300",
      sync: {
        mode: "snapshot",
        status: "complete",
      },
      messages: [
        {
          id: "1710000000.000100",
          author: {
            kind: "bot",
            id: "B123",
            displayName: "GitHub",
          },
          sentAtMs: 1_710_000_000_100,
          text: "Build failed in repository openmeld.",
        },
        {
          id: "1710000001.000200",
          author: {
            kind: "human",
            id: "U123",
            displayName: "Ashley",
          },
          sentAtMs: 1_710_000_001_200,
          text: "Can you diagnose the failure above?",
        },
      ],
    };

    expect(channelContextSchema.parse(channelContext)).toEqual(channelContext);
    expect(
      remoteAgentTurnEnvelopeSchema.parse({
        ...createRemoteAgentTurnEnvelope(),
        channelContext,
      })
    ).toMatchObject({ channelContext });
  });

  it("rejects ambiguous or oversized channel context projections", () => {
    const baseContext = {
      provider: "slack",
      conversationId: "slack:T123:C123:1710000000.000100",
      currentMessageId: "current",
      sync: {
        mode: "delta",
        status: "complete",
      },
      messages: [
        {
          id: "first",
          author: { kind: "human" },
          sentAtMs: 1000,
          text: "Earlier reply",
        },
      ],
    };

    expect(
      channelContextSchema.safeParse({
        ...baseContext,
        unexpected: true,
      }).success
    ).toBe(false);
    expect(
      channelContextSchema.safeParse({
        ...baseContext,
        messages: [
          ...baseContext.messages,
          {
            ...baseContext.messages[0],
            id: "older",
            sentAtMs: 999,
          },
        ],
      }).success
    ).toBe(false);
    expect(
      channelContextSchema.safeParse({
        ...baseContext,
        messages: [
          {
            ...baseContext.messages[0],
            id: baseContext.currentMessageId,
          },
        ],
      }).success
    ).toBe(false);
    expect(
      channelContextSchema.safeParse({
        ...baseContext,
        messages: Array.from(
          { length: CHANNEL_CONTEXT_MAX_MESSAGES + 1 },
          (_, index) => ({
            ...baseContext.messages[0],
            id: `message_${index}`,
            sentAtMs: index,
          })
        ),
      }).success
    ).toBe(false);
    expect(
      channelContextSchema.safeParse({
        ...baseContext,
        messages: [
          {
            ...baseContext.messages[0],
            text: "x".repeat(CHANNEL_CONTEXT_MESSAGE_TEXT_MAX_CHARS + 1),
          },
        ],
      }).success
    ).toBe(false);
    expect(
      channelContextSchema.safeParse({
        ...baseContext,
        messages: Array.from({ length: 5 }, (_, index) => ({
          ...baseContext.messages[0],
          id: `message_${index}`,
          sentAtMs: index,
          text: "x".repeat(CHANNEL_CONTEXT_TOTAL_TEXT_MAX_CHARS / 4),
        })),
      }).success
    ).toBe(false);
    expect(
      channelContextSchema.safeParse({
        ...baseContext,
        sync: { mode: "snapshot", status: "unavailable" },
      }).success
    ).toBe(false);
    expect(
      channelContextSchema.safeParse({
        ...baseContext,
        messages: [],
        sync: { mode: "snapshot", status: "unavailable" },
      }).success
    ).toBe(true);
  });

  it("requires a verified delegated member without impersonating a live speaker", () => {
    const routineEnvelope = {
      ...createRemoteAgentTurnEnvelope(),
      sender: {
        kind: "routine",
        routineId: "routine_1",
        createdByUserId: "user_1",
        delegatedBy: {
          id: "member_1",
          displayName: "Felix",
          ownerUserId: "user_1",
          verified: true,
        },
      },
      space: {
        id: "space_triage",
        name: "Feedback Triage",
        kind: "space",
        isCenterAgentDm: false,
      },
      trigger: {
        authorizedActions: [],
        destination: {
          kind: "space",
          spaceId: "space_triage",
        },
        source: "routine",
        routineId: "routine_1",
        runId: "run_1",
        scheduledFor: 1_783_382_400_000,
        routineName: "Triage feedback inbox",
      },
    };

    expect(remoteAgentTurnEnvelopeSchema.parse(routineEnvelope)).toEqual(
      routineEnvelope
    );
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...routineEnvelope,
        trigger: {
          ...routineEnvelope.trigger,
          externalActionPolicy: "read_only",
        },
      }).success
    ).toBe(true);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...routineEnvelope,
        trigger: {
          ...routineEnvelope.trigger,
          externalActionPolicy: "unsupported",
        },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...routineEnvelope,
        sender: {
          kind: "routine",
          routineId: "routine_1",
          createdByUserId: "user_1",
        },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...routineEnvelope,
        sender: {
          ...routineEnvelope.sender,
          delegatedBy: {
            ...routineEnvelope.sender.delegatedBy,
            ownerUserId: "user_other",
          },
        },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...routineEnvelope,
        sender: {
          kind: "routine",
          routineId: "routine_1",
        },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...routineEnvelope,
        trigger: {
          destination: {
            kind: "space",
            spaceId: "space_triage",
          },
          source: "routine",
          routineId: "routine_1",
          runId: "run_1",
          scheduledFor: 1_783_382_400_000,
        },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...routineEnvelope,
        sender: createRemoteAgentTurnEnvelope().sender,
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...routineEnvelope,
        sender: {
          kind: "routine",
          routineId: "routine_2",
          createdByUserId: "user_1",
          delegatedBy: routineEnvelope.sender.delegatedBy,
        },
      }).success
    ).toBe(false);
    const { destination: _destination, ...legacyRoutineTrigger } =
      routineEnvelope.trigger;
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...routineEnvelope,
        trigger: legacyRoutineTrigger,
      }).success
    ).toBe(true);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...routineEnvelope,
        trigger: {
          ...routineEnvelope.trigger,
          destination: {
            kind: "space",
            spaceId: "space_other",
          },
        },
      }).success
    ).toBe(false);
    const slackConversationId = "slack:T123:C456:1712345678.000100";
    const slackRoutineEnvelope = {
      ...routineEnvelope,
      space: {
        ...routineEnvelope.space,
        id: slackConversationId,
        name: "#product",
      },
      trigger: {
        ...routineEnvelope.trigger,
        destination: {
          channelId: "C456",
          conversationId: slackConversationId,
          kind: "slack_thread",
          label: "#product",
          teamId: "T123",
          threadTs: "1712345678.000100",
        },
      },
    };
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse(slackRoutineEnvelope).success
    ).toBe(true);
    const watchedTask = {
      kind: "space_wake" as const,
      sourceClientMessageId: "routine-child-message",
      spaceId: "space-agents",
      targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      v: 1 as const,
    };
    const outcome = {
      errorCode: null,
      eventId: "routine-child-terminal",
      occurredAtMs: 1_783_382_500_000,
      publishedSignalId: "signal-child-result",
      status: "succeeded" as const,
    };
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...slackRoutineEnvelope,
        trigger: {
          ...slackRoutineEnvelope.trigger,
          continuation: {
            delegation: {
              barrier: "all_terminal",
              children: [
                {
                  agentProfileId: watchedTask.targetProfileId,
                  role: "primary",
                  state: "terminal",
                  task: watchedTask,
                  terminalOutcome: outcome,
                },
              ],
              delegationId: "routine-delegation",
              generation: 1,
            },
            delegationId: "routine-delegation",
            outcome,
            subscriptionId: "routine-subscription",
            watchedTask,
          },
        },
      }).success
    ).toBe(true);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...slackRoutineEnvelope,
        trigger: {
          ...slackRoutineEnvelope.trigger,
          destination: {
            ...slackRoutineEnvelope.trigger.destination,
            conversationId: "slack:T123:C456:other",
          },
        },
      }).success
    ).toBe(false);
  });

  it("identifies every message that falls behind the latest channel context timestamp", () => {
    const result = channelContextSchema.safeParse({
      provider: "slack",
      conversationId: "slack:T123:C123:1710000000.000100",
      currentMessageId: "current",
      sync: {
        mode: "snapshot",
        status: "complete",
      },
      messages: [
        {
          id: "latest",
          author: { kind: "human" },
          sentAtMs: 100,
          text: "Latest message",
        },
        {
          id: "oldest",
          author: { kind: "human" },
          sentAtMs: 50,
          text: "Oldest message",
        },
        {
          id: "still-older-than-latest",
          author: { kind: "human" },
          sentAtMs: 80,
          text: "Still behind the latest message",
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected channel context ordering validation to fail.");
    }
    expect(
      result.error.issues
        .filter(
          (issue) =>
            issue.message ===
            "Channel context messages must be ordered by sentAtMs."
        )
        .map((issue) => issue.path)
    ).toEqual([
      ["messages", 1, "sentAtMs"],
      ["messages", 2, "sentAtMs"],
    ]);
  });

  it("keeps legacy sender and trigger variants strict", () => {
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...createRemoteAgentTurnEnvelope(),
        sender: {
          ...createRemoteAgentTurnEnvelope().sender,
          routineId: "routine_1",
        },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...createRemoteAgentTurnEnvelope(),
        trigger: {
          source: "space_wake",
          routineId: "routine_1",
          runId: "run_1",
          scheduledFor: 1_783_382_400_000,
          routineName: "Triage feedback inbox",
        },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...createRemoteAgentTurnEnvelope(),
        sender: {
          kind: "agent_profile",
          id: "agt_11111111-1111-4111-8111-111111111111",
          displayName: "Planning Agent",
          verified: false,
        },
        trigger: { source: "space_wake" },
      }).success
    ).toBe(true);
  });

  it("carries a Core-authored Message Channel identity for an anonymous member", () => {
    const envelope = remoteAgentTurnEnvelopeSchema.parse({
      ...createRemoteAgentTurnEnvelope(),
      sender: {
        displayName: "Ashley",
        id: "slack:T123:U123",
        kind: "member",
        messageChannelIdentity: {
          connectionId: "T123",
          provider: "slack",
          providerUserId: "U123",
        },
        verified: false,
      },
      trigger: {
        source: "slack",
        teamId: "T123",
      },
    });

    expect(envelope.sender).toMatchObject({
      kind: "member",
      messageChannelIdentity: {
        connectionId: "T123",
        provider: "slack",
        providerUserId: "U123",
      },
      verified: false,
    });
  });

  it("keeps task continuation identity consistent with its delegation snapshot", () => {
    const watchedTask = {
      kind: "space_wake" as const,
      sourceClientMessageId: "child-wake-1",
      spaceId: "space_1",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      v: 1 as const,
    };
    const outcome = {
      errorCode: null,
      eventId: "child-terminal-1",
      occurredAtMs: 1000,
      publishedSignalId: "signal-child-1",
      status: "succeeded" as const,
    };
    const envelope = {
      ...createRemoteAgentTurnEnvelope(),
      sender: {
        ...createRemoteAgentTurnEnvelope().sender,
        ownerUserId: "user_1",
        profileId: "human-profile-1",
      },
      trigger: {
        delegation: {
          barrier: "all_terminal" as const,
          children: [
            {
              agentProfileId: watchedTask.targetProfileId,
              role: "primary" as const,
              state: "terminal" as const,
              task: watchedTask,
              terminalOutcome: outcome,
            },
          ],
          delegationId: "delegation-1",
          generation: 1,
        },
        delegationId: "delegation-1",
        outcome,
        source: "task_continuation" as const,
        subscriptionId: "subscription-1",
        watchedTask,
      },
    };

    expect(remoteAgentTurnEnvelopeSchema.safeParse(envelope).success).toBe(
      true
    );
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...envelope,
        trigger: { ...envelope.trigger, delegationId: "delegation-other" },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...envelope,
        trigger: {
          ...envelope.trigger,
          watchedTask: { ...watchedTask, sourceClientMessageId: "other" },
        },
      }).success
    ).toBe(false);
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...envelope,
        trigger: {
          ...envelope.trigger,
          outcome: { ...outcome, eventId: "other-terminal" },
        },
      }).success
    ).toBe(false);
  });

  it("represents a general task-watch continuation separately from a delegation", () => {
    const watchedTask = {
      deliveryId: "delivery-watched-1",
      kind: "native_delivery" as const,
      v: 1 as const,
    };
    expect(
      remoteAgentTurnEnvelopeSchema.parse({
        ...createRemoteAgentTurnEnvelope(),
        sender: {
          ...createRemoteAgentTurnEnvelope().sender,
          ownerUserId: "user_1",
          profileId: "human-profile-1",
        },
        trigger: {
          outcome: {
            errorCode: null,
            eventId: "watched-terminal-1",
            occurredAtMs: 1000,
            publishedSignalId: "signal-watched-1",
            status: "succeeded",
          },
          source: "task_watch_continuation",
          subscriptionId: "subscription-watch-1",
          watchedTask,
          watchId: "watch-1",
        },
      }).trigger
    ).toMatchObject({
      source: "task_watch_continuation",
      watchId: "watch-1",
      watchedTask,
    });

    expect(
      remoteAgentTurnEnvelopeSchema.parse({
        ...createRemoteAgentTurnEnvelope(),
        sender: {
          ...createRemoteAgentTurnEnvelope().sender,
          ownerUserId: "user_1",
          profileId: "human-profile-1",
        },
        trigger: {
          outcome: {
            attentionCode: "permission_request",
            eventId: "watched-attention-1",
            occurredAtMs: 1001,
            status: "needs_attention",
          },
          source: "task_watch_continuation",
          subscriptionId: "subscription-watch-attention-1",
          watchedTask,
          watchId: "watch-attention-1",
        },
      }).trigger
    ).toMatchObject({
      outcome: { status: "needs_attention" },
      source: "task_watch_continuation",
    });
  });

  it("accepts bounded Center Agent memory on the turn envelope", () => {
    expect(
      remoteAgentTurnEnvelopeSchema.parse({
        ...createRemoteAgentTurnEnvelope(),
        memory: {
          items: [
            {
              source: "ca_dm",
              subject: "member",
              text: "The launch team deploys on Thursday.",
            },
            {
              source: "space_conversation",
              subject: "organization",
              text: "The shared release room tracks blockers.",
            },
            {
              source: "slack_conversation",
              subject: "organization",
              text: "The Slack launch channel tracks customer escalations.",
            },
          ],
          truncated: false,
        },
      })
    ).toMatchObject({
      memory: {
        items: [
          {
            source: "ca_dm",
            subject: "member",
          },
          {
            source: "space_conversation",
            subject: "organization",
          },
          {
            source: "slack_conversation",
            subject: "organization",
          },
        ],
        truncated: false,
      },
    });
    expect(
      remoteAgentTurnEnvelopeSchema.safeParse({
        ...createRemoteAgentTurnEnvelope(),
        memory: {
          items: [
            {
              source: "space_conversation",
              sourceConversationId: "space_launch_room",
              subject: "organization",
              text: "The shared release room tracks blockers.",
            },
          ],
          truncated: false,
        },
      }).success
    ).toBe(false);
  });

  it("requires callback identity fields that Core checks against the native delivery ledger", () => {
    expect(
      remoteAgentCoreCallbackBodySchema.parse({
        submissionId: "sub_123",
        idempotencyKey: "space_1:dispatch_1",
        organizationId: "org_1",
        spaceId: "space_1",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "binding_1",
        callbackAttempt: 2,
        triggerMessageId: "signal_1",
        dispatchId: "dispatch_1",
        status: "completed",
        text: "Done.",
        conversationCompaction: {
          completedAtMs: 1_804_000_000_000,
          count: 1,
          v: 1,
        },
        navigationTarget: {
          kind: "project",
          projectId: "project_123",
        },
        attachments: [
          {
            id: "attachment-1",
            mimeType: "image/png",
            sizeBytes: 1024,
            width: 1440,
            height: 900,
            fileName: "browser-screenshot.png",
          },
        ],
      })
    ).toMatchObject({
      attachments: [
        {
          id: "attachment-1",
          mimeType: "image/png",
          sizeBytes: 1024,
        },
      ],
      callbackAttempt: 2,
      conversationCompaction: {
        completedAtMs: 1_804_000_000_000,
        count: 1,
        v: 1,
      },
      navigationTarget: {
        kind: "project",
        projectId: "project_123",
      },
      status: "completed",
      submissionId: "sub_123",
      triggerMessageId: "signal_1",
    });
  });

  it("keeps work-loop checkpoints distinct from terminal callback bodies", () => {
    const checkpoint = {
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      bindingId: "binding_1",
      checkpoint: {
        reason: "tool_call_budget_exhausted" as const,
        toolCallLimit: 64,
        v: 1 as const,
      },
      dispatchId: "dispatch_1",
      idempotencyKey: "space_1:dispatch_1",
      organizationId: "org_1",
      spaceId: "space_1",
      status: "continuation_required" as const,
      submissionId: "sub_123",
      triggerMessageId: "signal_1",
    };

    expect(remoteAgentCoreCallbackEventSchema.parse(checkpoint)).toEqual(
      checkpoint
    );
    expect(
      remoteAgentCoreCallbackBodySchema.safeParse(checkpoint).success
    ).toBe(false);
    expect(
      remoteAgentCoreCallbackEventSchema.safeParse({
        ...checkpoint,
        checkpoint: {
          ...checkpoint.checkpoint,
          toolCallLimit: 0,
        },
      }).success
    ).toBe(false);
  });

  it("strictly validates both Routine Workflow continuation event variants", () => {
    const callback = {
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      bindingId: "binding_1",
      dispatchId: "dispatch_1",
      idempotencyKey: "space_1:dispatch_1",
      organizationId: "org_1",
      spaceId: "space_1",
      status: "completed" as const,
      submissionId: "sub_123",
      text: "Done.",
      triggerMessageId: "signal_1",
    };

    expect(
      routineWorkflowContinuationEventPayloadSchema.parse({
        callback,
        kind: "callback",
      })
    ).toEqual({ callback, kind: "callback" });
    expect(
      routineWorkflowContinuationEventPayloadSchema.parse({
        failureCode: "remote_agent.worker_submit_failed",
        kind: "terminal_failure",
      })
    ).toEqual({
      failureCode: "remote_agent.worker_submit_failed",
      kind: "terminal_failure",
    });
    expect(
      routineWorkflowContinuationEventPayloadSchema.safeParse({
        callback,
        failureCode: "remote_agent.worker_submit_failed",
        kind: "callback",
      }).success
    ).toBe(false);
    expect(
      routineWorkflowContinuationEventPayloadSchema.safeParse({
        callback,
        failureCode: "remote_agent.worker_submit_failed",
        kind: "terminal_failure",
      }).success
    ).toBe(false);
    expect(
      routineWorkflowContinuationEventPayloadSchema.safeParse({
        kind: "terminal_failure",
      }).success
    ).toBe(false);
  });

  it("bounds completed callback text to the product message limit", () => {
    expect(() =>
      remoteAgentCoreCallbackBodySchema.parse({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "binding_1",
        dispatchId: "dispatch_1",
        idempotencyKey: "space_1:dispatch_1",
        organizationId: "org_1",
        spaceId: "space_1",
        status: "completed",
        submissionId: "sub_123",
        text: "A".repeat(100_001),
        triggerMessageId: "signal_1",
      })
    ).toThrow();
  });

  it("accepts retryable Core callback responses for temporary publish failures", () => {
    expect(
      remoteAgentCoreCallbackResponseSchema.parse({
        status: "retryable",
        reasonCode: "remote_agent.callback_failure_publish_failed",
        retryAfterMs: 7000,
      })
    ).toEqual({
      status: "retryable",
      reasonCode: "remote_agent.callback_failure_publish_failed",
      retryAfterMs: 7000,
    });
  });

  it("accepts terminal failure callbacks with a stable reason code and user-facing message", () => {
    expect(
      remoteAgentCoreCallbackBodySchema.parse({
        submissionId: "sub_123",
        idempotencyKey: "space_1:dispatch_1",
        organizationId: "org_1",
        spaceId: "space_1",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "binding_1",
        triggerMessageId: "signal_1",
        dispatchId: "dispatch_1",
        status: "failed",
        failureCode: "remote_agent.turn_not_completed",
        failureMessage:
          "Remote Agent could not finish this request. Please try again or open diagnostics.",
        failureDetail:
          "Cloudflare AI binding request failed with 502 Bad Gateway.",
      })
    ).toMatchObject({
      failureDetail:
        "Cloudflare AI binding request failed with 502 Bad Gateway.",
      failureCode: "remote_agent.turn_not_completed",
      status: "failed",
      submissionId: "sub_123",
    });

    expect(
      remoteAgentCoreCallbackBodySchema.safeParse({
        submissionId: "sub_123",
        idempotencyKey: "space_1:dispatch_1",
        organizationId: "org_1",
        spaceId: "space_1",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "binding_1",
        triggerMessageId: "signal_1",
        dispatchId: "dispatch_1",
        status: "failed",
        failureCode: "remote_agent.turn_not_completed",
        failureMessage:
          "Remote Agent could not finish this request. Please try again or open diagnostics.",
        failureDetail: "x".repeat(DISPATCH_ERROR_SUMMARY_MAX_LENGTH + 1),
      }).success
    ).toBe(false);
  });
});

function createRemoteAgentTurnEnvelope() {
  return {
    sender: {
      kind: "member",
      id: "member_1",
      displayName: "Felix",
      role: "owner",
      verified: true,
    },
    space: {
      id: "space_1",
      name: "Felix and Center Agent",
      kind: "dm",
      isCenterAgentDm: true,
    },
    organization: {
      id: "org_1",
      name: "OpenMeld Labs",
      personal: false,
      memberCount: 3,
    },
    centerAgent: {
      profileName: "Center Agent",
      profileHandle: "center-agent",
    },
    trigger: {
      source: "web_dm",
    },
  };
}
