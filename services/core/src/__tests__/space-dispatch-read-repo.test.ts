import {
  OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION,
} from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectionPostgresDatabase } from "../../test-support/postgresql-query.test-support";
import {
  DISPATCH_CONVERSATION_LIFECYCLE_DECISION_CODE,
  DISPATCH_EXECUTION_LIFECYCLE_DECISION_CODE,
  DISPATCH_OPENCLAW_BINDING_DECISION_CODE,
  DISPATCH_RUNTIME_TELEMETRY_DECISION_CODE,
  DISPATCH_STREAMING_TELEMETRY_DECISION_CODE,
  DISPATCH_STRUCTURED_ACTION_FAILURE_DECISION_CODE,
} from "../dispatch/application/dispatch-trace-decision-codes";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as dispatchLedgerPostgresql from "../dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";
import { listRecentOpenMeldDaemonOpsDecisions } from "../dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";
import {
  readDispatchLedgerStatus,
  readDispatchResultConversationFacts,
  readSpaceDispatchLookup,
  readSpaceDispatchLookupByClientMessageId,
  readSpaceDispatchTrace,
} from "../space/infrastructure/postgresql/space-dispatch-read-repo";

describe("space dispatch read repo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    // vi.mock module factories do not reach the worker-entry module graph in
    // vitest-pool-workers, so spy on the shared module namespace instead.
    vi.spyOn(
      dispatchLedgerPostgresql,
      "listRecentOpenMeldDaemonOpsDecisions"
    ).mockResolvedValue([]);
  });

  it.each([
    { dispatchStatus: "cancelled", attemptStatus: "failed_terminal" },
    { dispatchStatus: "dispatching", attemptStatus: "profile_queue_waiting" },
  ])("preserves trace records for $dispatchStatus / $attemptStatus", async ({
    dispatchStatus,
    attemptStatus,
  }) => {
    const result = await readSpaceDispatchTrace({
      db: createTraceDb({ dispatchStatus, attemptStatus }),
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockResolvedValue(null),
      spaceId: "space-1",
    });
    expect(result.trace?.dispatch.status).toBe(dispatchStatus);
    expect(result.trace?.latestAttempt?.status).toBe(attemptStatus);
    expect(result.correlation?.dispatchId).toBe("dispatch-1");
  });

  it("projects path-free Default Project failure context from the result inbox", async () => {
    const db = createTraceDb({
      resultInboxRowPatch: {
        resultPayloadJson: JSON.stringify({
          code: "service.task_result",
          payload: {
            agentId: "agt-target-1",
            attemptId: "attempt-1",
            deduped: false,
            errorCode: "project.local_connection.folder_missing",
            errorType: "config",
            projectFailureContext: {
              bindingGeneration: "binding-1",
              projectId: "project-1",
            },
            sourceEventId: "sig-source-1",
            status: "failed",
            taskId: "task-1",
          },
          v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
        }),
      },
    });

    const result = await readSpaceDispatchTrace({
      db,
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockResolvedValue(null),
      spaceId: "space-1",
    });

    expect(result.trace?.resultInbox?.projectFailureContext).toEqual({
      bindingGeneration: "binding-1",
      projectId: "project-1",
    });
  });

  it("keeps hosted controller normalization history stable after Binding mutation or deletion", async () => {
    const readRuntimeCoordinatorHeadLifecycleTrace = vi.fn();
    const mutableBindingControllerRef: { current: string | null } = {
      current: "builtin:codex",
    };
    const db = createTraceDb({
      mutableBindingControllerRef,
      nativeDeliveryRow: {
        bindingId: "binding-hosted-1",
        bindingUpdatedAtMs: 1_700_000_002_100,
        conversationKind: "space",
        createdAtMs: 1_700_000_002_000,
        deliveryId: "delivery-hosted-1",
        dispatchId: "dispatch-1",
        idempotencyKey: "idem-1",
        organizationId: "org-1",
        profileId: "agt-target-1",
        spaceId: "space-1",
        status: "accepted",
        storedAgentControllerRef: "not-a-controller-ref",
        storedAgentControllerRefStatus: "malformed",
        submissionId: "submission-hosted-1",
        updatedAtMs: 1_700_000_003_000,
      },
    });
    const readTrace = () =>
      readSpaceDispatchTrace({
        db,
        dispatchId: "dispatch-1",
        readReplySignalTrace: vi.fn().mockResolvedValue(null),
        readRuntimeCoordinatorHeadLifecycleTrace,
        spaceId: "space-1",
      });
    const result = await readTrace();

    expect(result.trace).toMatchObject({
      nativeDelivery: {
        bindingId: "binding-hosted-1",
        controllerNormalization: {
          canonicalAgentControllerRef: "hosted:center-agent",
          factSource: "remote_agent_native_delivery_ledger",
          reasonCode: "hosted_runtime_family_controller_canonicalized",
          storedAgentControllerRef: "not-a-controller-ref",
          storedAgentControllerRefStatus: "malformed",
        },
        destination: {
          conversationKind: "space",
          organizationId: "org-1",
          spaceId: "space-1",
          targetProfileId: "agt-target-1",
        },
        factSource: "remote_agent_native_delivery_ledger",
        runtimeFamily: "hosted_center_agent",
        status: "accepted",
        submissionId: "submission-hosted-1",
      },
      runtimeCoordinatorExecution: null,
      runtimeCoordinatorHeadLifecycle: null,
    });
    expect(result.correlation).toMatchObject({
      agentControllerRef: "hosted:center-agent",
      bindingId: "binding-hosted-1",
      runtimeCoordinatorExecutionId: null,
      openMeldServiceRuntimeId: null,
    });
    mutableBindingControllerRef.current = "builtin:claude-code";
    const afterBindingMutation = await readTrace();
    mutableBindingControllerRef.current = null;
    const afterBindingDeletion = await readTrace();
    expect(afterBindingMutation.trace?.nativeDelivery).toEqual(
      result.trace?.nativeDelivery
    );
    expect(afterBindingDeletion.trace?.nativeDelivery).toEqual(
      result.trace?.nativeDelivery
    );
    expect(readRuntimeCoordinatorHeadLifecycleTrace).not.toHaveBeenCalled();
    const nativeDeliveryQuery = vi
      .mocked(db.query)
      .mock.calls.map(([query]) =>
        typeof query === "string" ? query : query.text
      )
      .find((text) => text.includes('deliveries.delivery_id AS "deliveryId"'));
    expect(nativeDeliveryQuery).toBeDefined();
    expect(nativeDeliveryQuery).not.toContain(
      "openMeldDaemon_agent_profile_bindings"
    );
  });

  it("locates a historical hosted failure through the native-delivery publication signal", async () => {
    const readFinalVisibleMessageTrace = vi.fn().mockReturnValue({
      finalVisibleMessage: {
        createdAt: "2026-08-26T03:01:25.000Z",
        dispatchId: "dispatch-1",
        factSource: "space_signal_by_published_signal_id",
        noticeType: null,
        profileId: "agt-target-1",
        profileKind: "agent",
        profileName: "Center Agent",
        reasonCode: "remote_agent.turn_not_completed",
        signalId: "sig-hosted-failure-1",
        signalType: "signal.text",
        statusType: null,
        targetProfileId: "agt-target-1",
        text: "Center Agent could not complete this request.",
      },
      finalVisibleMessageLinkage: {
        candidateSignalIds: ["sig-hosted-failure-1"],
        claimSignalId: null,
        reasonCode: "final_visible_message.matched_published_signal",
        selectedSignalId: "sig-hosted-failure-1",
        sourceFact: "published_signal_candidate",
        status: "matched_published_signal",
      },
    });

    const result = await readSpaceDispatchTrace({
      db: createTraceDb({
        nativeDeliveryRow: {
          bindingId: "binding-hosted-1",
          bindingUpdatedAtMs: 1_700_000_002_100,
          conversationKind: "space",
          createdAtMs: 1_700_000_002_000,
          deliveryId: "delivery-hosted-1",
          dispatchId: "dispatch-1",
          idempotencyKey: "idem-1",
          organizationId: "org-1",
          profileId: "agt-target-1",
          publishedSignalId: "sig-hosted-failure-1",
          spaceId: "space-1",
          status: "failed",
          storedAgentControllerRef: "hosted:center-agent",
          storedAgentControllerRefStatus: "canonical",
          submissionId: "submission-hosted-1",
          updatedAtMs: 1_700_000_003_000,
        },
        resultInboxRowPatch: {
          publishedSignalId: null,
        },
        resultRow: null,
      }),
      dispatchId: "dispatch-1",
      readFinalVisibleMessageTrace,
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      spaceId: "space-1",
    });

    expect(readFinalVisibleMessageTrace).toHaveBeenCalledWith({
      dispatchId: "dispatch-1",
      publishedSignalIdCandidates: ["sig-hosted-failure-1"],
      targetProfileId: "agt-target-1",
    });
    expect(result.trace?.nativeDelivery).toMatchObject({ status: "failed" });
    expect(result.trace?.finalVisibleOutcome).toMatchObject({
      delivered: true,
      publicationKind: "failure_notice",
      reasonCode: "remote_agent.turn_not_completed",
      signalId: "sig-hosted-failure-1",
      status: "visible_failure",
    });
  });

  it("qualifies joined ledger status reads through the shared repo", async () => {
    let capturedQuery = "";
    const db = createProjectionPostgresDatabase(({ text }) => {
      capturedQuery = text;
      return [
        {
          status: "queued",
          lastAttemptAtMs: 1_700_000_000_000,
          latestAttemptStatus: "dispatching",
          latestAttemptErrorCode: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 2,
        },
      ];
    });

    const result = await readDispatchLedgerStatus({
      db,
      idempotencyKey: "idem-1",
    });

    expect(capturedQuery).toContain("WHERE ledger.idempotency_key = $1");
    expect(result).toEqual({
      status: "queued",
      lastAttemptAtMs: 1_700_000_000_000,
      latestAttemptStatus: "dispatching",
      latestAttemptErrorCode: null,
      daemonSessionId: "daemon-session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
    });
  });

  it("normalizes lookup rows through the shared repo", async () => {
    const db = createProjectionPostgresDatabase(() => [
      {
        dispatchId: "dispatch-1",
        sourceSignalId: "sig-source-1",
        targetProfileId: "agt-target-1",
        dispatchStatus: "dispatching",
        attemptCount: 2,
        latestAttemptId: "attempt-2",
        latestAttemptStatus: "waiting_result",
        latestAttemptErrorCode: null,
        latestAttemptErrorMessage: null,
      },
    ]);

    const result = await readSpaceDispatchLookup({
      clientMessageId: "client-message-1",
      db,
      sourceSignalId: "sig-source-1",
      spaceId: "space-1",
      targetProfileId: "agt-target-1",
    });

    expect(result).toEqual({
      query: {
        spaceId: "space-1",
        sourceSignalId: "sig-source-1",
        clientMessageId: "client-message-1",
        targetProfileId: "agt-target-1",
      },
      matches: [
        {
          dispatchId: "dispatch-1",
          sourceSignalId: "sig-source-1",
          targetProfileId: "agt-target-1",
          status: "dispatching",
          attemptCount: 2,
          latestAttemptId: "attempt-2",
          latestAttemptStatus: "waiting_result",
          latestAttemptErrorCode: null,
          latestAttemptErrorMessage: null,
        },
      ],
    });
  });

  it("reads dispatch lookup rows by durable source client message id", async () => {
    let capturedQuery = "";
    let capturedBindings: unknown[] = [];
    const db = createProjectionPostgresDatabase(({ text, values }) => {
      capturedQuery = text;
      capturedBindings = values ?? [];
      return [
        {
          dispatchId: "dispatch-1",
          sourceSignalId: "sig-source-1",
          targetProfileId: "agt-target-1",
          dispatchStatus: "dispatching",
          attemptCount: 2,
          latestAttemptId: "attempt-2",
          latestAttemptStatus: "waiting_result",
          latestAttemptErrorCode: null,
          latestAttemptErrorMessage: null,
        },
      ];
    });

    const result = await readSpaceDispatchLookupByClientMessageId({
      clientMessageId: "client-message-1",
      db,
      spaceId: "space-1",
      targetProfileId: "agt-target-1",
    });

    expect(capturedQuery).toContain("ledger.source_client_message_id = $2");
    expect(capturedQuery).not.toContain("ledger.source_event_id = $2");
    expect(capturedBindings).toEqual([
      "space-1",
      "client-message-1",
      "agt-target-1",
    ]);
    expect(result).toEqual({
      query: {
        spaceId: "space-1",
        sourceSignalId: "sig-source-1",
        clientMessageId: "client-message-1",
        targetProfileId: "agt-target-1",
      },
      matches: [
        {
          dispatchId: "dispatch-1",
          sourceSignalId: "sig-source-1",
          targetProfileId: "agt-target-1",
          status: "dispatching",
          attemptCount: 2,
          latestAttemptId: "attempt-2",
          latestAttemptStatus: "waiting_result",
          latestAttemptErrorCode: null,
          latestAttemptErrorMessage: null,
        },
      ],
    });
  });

  it("fails closed before querying when clientMessageId lookup key is empty", async () => {
    const db = createProjectionPostgresDatabase(() => {
      throw new Error("An empty lookup must not reach the database");
    });

    await expect(
      readSpaceDispatchLookupByClientMessageId({
        clientMessageId: "  ",
        db,
        spaceId: "space-1",
        targetProfileId: "agt-target-1",
      })
    ).rejects.toThrow("clientMessageId is required");

    expect(db.query).not.toHaveBeenCalled();
  });

  it("builds a dispatch trace snapshot from shared read-side queries", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([
      createDecisionRecord({
        decisionCode: DISPATCH_STREAMING_TELEMETRY_DECISION_CODE,
        payload: {
          streamingMode: "stream",
          previewEmitted: true,
          firstStdoutAtMs: 1_700_000_005_000,
          firstOutputAtMs: 1_700_000_006_000,
        },
      }),
      createDecisionRecord({
        decisionCode: DISPATCH_RUNTIME_TELEMETRY_DECISION_CODE,
        payload: {
          agentControllerConversationId: "thread-1",
          agentControllerRef: "builtin:openai",
          resolvedAgentControllerConversationId: "conv-1",
          agentControllerConversationKind: "thread",
          effectiveRuntimeWorkingDirectory: "/tmp/demo",
          runtimeWorkspaceFingerprint: "sha256:workspace-demo",
          promptFingerprint: "sha256:demo",
          promptLength: 42,
          promptPreview: "Dispatch prompt preview",
          processId: 321,
          exitCode: 0,
          exitObservedAtMs: 1_700_000_007_000,
          firstStderrAtMs: 1_700_000_006_500,
          processSpawnedAtMs: 1_700_000_004_000,
          stdinClosedAtMs: 1_700_000_004_500,
          timeoutTriggeredAtMs: null,
          openClawGatewayAgentId: "agt-openclaw-1",
          openClawGatewayRestartAttempted: true,
          openClawGatewayVisibility: "visible_after_restart",
        },
      }),
      createDecisionRecord({
        decisionCode: DISPATCH_EXECUTION_LIFECYCLE_DECISION_CODE,
        payload: {
          phase: "running",
          progressEvidenceState: "active",
          phaseEnteredAtMs: 1_700_000_004_250,
          lastLifecycleAtMs: 1_700_000_007_250,
          finalizationTimeoutMs: 60_000,
          startTimeoutMs: 10_000,
          taskProgressEvidenceStaleAfterMs: 30_000,
          waitWindowMs: 120_000,
        },
      }),
      createDecisionRecord({
        decisionCode: DISPATCH_CONVERSATION_LIFECYCLE_DECISION_CODE,
        payload: {
          agentControllerConversationResume: {
            status: "continued",
          },
          localRuntimeContext: {
            status: "reused",
            reason: null,
          },
          bootstrap: {
            status: "applied",
            reason: null,
          },
        },
      }),
      createDecisionRecord({
        decisionCode: DISPATCH_OPENCLAW_BINDING_DECISION_CODE,
        payload: {
          classification: "canonical_owned",
          bindingSource: "daemon-launch",
          upgradeApplied: true,
        },
      }),
      createDecisionRecord({
        decisionCode: DISPATCH_STRUCTURED_ACTION_FAILURE_DECISION_CODE,
        payload: {
          carrierKind: "invalid_json",
          invalidOutputPreview: "{oops",
          publicFailureReason: "Malformed action payload",
          repairMode: "required_check",
          spaceActionCandidatePresent: false,
          spaceActionParseError: "invalid json",
        },
      }),
      createDecisionRecord({
        decisionCode: "dispatch.reply.emit_failed",
        payload: {},
      }),
    ]);

    const db = createTraceDb();
    const replySignal = {
      factSource: "space_signal_by_published_signal_id" as const,
      signalId: "sig-reply-1",
      profileId: "agt-target-1",
      profileKind: "agent" as const,
      profileName: "Codex",
      text: "Final reply",
      createdAt: "2024-11-14T22:13:20.000Z",
    };
    const finalVisibleMessage = {
      factSource: "space_signal_by_published_signal_id" as const,
      signalId: "sig-reply-1",
      signalType: "signal.text" as const,
      dispatchId: "dispatch-1",
      targetProfileId: "agt-target-1",
      profileId: "agt-target-1",
      profileKind: "agent" as const,
      profileName: "Codex",
      text: "Final reply",
      reasonCode: null,
      noticeType: null,
      statusType: null,
      createdAt: "2024-11-14T22:13:20.000Z",
    };
    const readReplySignalTrace = vi.fn().mockReturnValue(replySignal);
    const readFinalVisibleMessageTrace = vi.fn().mockReturnValue({
      finalVisibleMessage,
      finalVisibleMessageLinkage: {
        status: "matched_published_signal",
        reasonCode: "final_visible_message.matched_published_signal",
        sourceFact: "published_signal_candidate",
        candidateSignalIds: ["sig-reply-1"],
        claimSignalId: null,
        selectedSignalId: "sig-reply-1",
      },
    });

    const result = await readSpaceDispatchTrace({
      db,
      dispatchId: "dispatch-1",
      readFinalVisibleMessageTrace,
      readReplySignalTrace,
      spaceId: "space-1",
    });

    expect(result.correlation).toMatchObject({
      modelVersion: "openmeld.observability.wake.v1",
      clientMessageId: "client-message-1",
      sourceSignalId: "sig-source-1",
      targetProfileId: "agt-target-1",
      dispatchId: "dispatch-1",
      latestAttemptId: "attempt-1",
      claimLeaseId: null,
      bindingId: null,
      openMeldServiceRuntimeId: null,
      agentControllerRef: null,
      resultRef: "result-1",
      publishedSignalId: "sig-reply-1",
      replySignalId: "sig-reply-1",
    });
    expect(result.trace?.dispatch).toMatchObject({
      factSource: "dispatch_ledger",
      dispatchId: "dispatch-1",
      latestAttemptId: "attempt-1",
      sourceClientMessageId: "client-message-1",
      status: "dispatching",
    });
    expect(result.trace?.latestAttempt).toMatchObject({
      factSource: "dispatch_attempt",
      attemptId: "attempt-1",
      status: "waiting_result",
    });
    expect(result.trace?.claimLease).toBeNull();
    expect(result.trace?.result).toMatchObject({
      factSource: "dispatch_result",
      resultRef: "result-1",
      publishedSignalId: "sig-reply-1",
      publicOutcome: "succeeded",
    });
    expect(result.trace?.resultInbox).toMatchObject({
      factSource: "dispatch_result_inbox",
      resultKey: "dispatch-1::attempt-1",
      attemptId: "attempt-1",
      publishState: "reply_published",
      publishedSignalId: "sig-reply-1",
    });
    expect(result.trace?.recentOpsDecisions).toHaveLength(1);
    expect(result.trace?.streaming).toMatchObject({
      streamingMode: "stream",
      previewEmitted: true,
    });
    expect(result.trace?.runtime).toMatchObject({
      processId: 321,
      exitCode: 0,
    });
    expect(result.trace?.origin).toMatchObject({
      agentControllerConversationId: "thread-1",
      effectiveRuntimeWorkingDirectory: "/tmp/demo",
    });
    expect(result.trace?.prompt).toEqual({
      fingerprint: "sha256:demo",
      length: 42,
      preview: "Dispatch prompt preview",
    });
    expect(result.trace?.execution).toMatchObject({
      phase: "running",
      progressEvidenceState: "active",
    });
    expect(result.trace?.dispatchExecution).toMatchObject({
      agentControllerConversationResume: {
        status: "continued",
      },
      bootstrap: {
        status: "applied",
        reason: null,
      },
    });
    expect(result.trace?.openClawGatewayVisibility).toMatchObject({
      agentId: "agt-openclaw-1",
      gatewayVisibility: "visible_after_restart",
    });
    expect(result.trace?.openClawBinding).toMatchObject({
      classification: "canonical_owned",
      bindingSource: "daemon-launch",
      upgradeApplied: true,
    });
    expect(result.trace?.structuredActionFailure).toMatchObject({
      carrierKind: "invalid_json",
      publicFailureReason: "Malformed action payload",
    });
    expect(result.trace?.replySignal).toEqual(replySignal);
    expect(result.trace?.finalVisibleMessage).toEqual(finalVisibleMessage);
    expect(result.trace?.finalVisibleMessageLinkage).toMatchObject({
      status: "matched_published_signal",
      selectedSignalId: "sig-reply-1",
    });
    expect(readReplySignalTrace).toHaveBeenCalledWith({
      dispatchId: "dispatch-1",
      publishedSignalId: "sig-reply-1",
    });
    expect(readFinalVisibleMessageTrace).toHaveBeenCalledWith({
      dispatchId: "dispatch-1",
      publishedSignalIdCandidates: ["sig-reply-1"],
      targetProfileId: "agt-target-1",
    });
    expect(listRecentOpenMeldDaemonOpsDecisions).toHaveBeenCalledTimes(1);
    expect(listRecentOpenMeldDaemonOpsDecisions).toHaveBeenCalledWith({
      db,
      correlationId: "dispatch-1",
      limit: 200,
    });
  });

  it("reads final visible messages from RuntimeCoordinator head publication candidates before result signals", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([]);
    const finalVisibleMessage = {
      factSource: "space_signal_by_published_signal_id" as const,
      signalId: "sig-head-failure-1",
      signalType: "signal.system_notice" as const,
      dispatchId: "dispatch-1",
      targetProfileId: "agt-target-1",
      profileId: "openmeld-system",
      profileKind: "system" as const,
      profileName: "OpenMeld",
      text: "Runner is connected to a different OpenMeld account.",
      reasonCode: "agent_profile_binding.owner_mismatch",
      noticeType: "terminal_failure" as const,
      statusType: null,
      createdAt: "2024-11-14T22:13:21.000Z",
    };
    const readRuntimeCoordinatorHeadLifecycleTrace = vi
      .fn()
      .mockImplementation(({ request }) =>
        Promise.resolve({
          lifecycle: {
            createdAtMs: 1_700_000_001_100,
            duplicateDispatchCount: 0,
            executionLinkedAtMs: null,
            modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
            noExecutionDecision: {
              decidedAtMs: 1_700_000_001_200,
              publicationCategory: "binding_required",
              reasonCode: "agent_profile_binding.owner_mismatch",
              source: "dispatch_preflight",
              userRecoveryAction: "reconnect_agent_binding",
            },
            ownerUserId: "owner-1",
            primaryDispatchId: "dispatch-1",
            publicationIntent: {
              intentId:
                "twl_space-1_sig-source-1_agt-target-1::no-execution-failure",
              kind: "no_execution_failure",
              publicationCategory: "binding_required",
              readyAtMs: 1_700_000_001_300,
              reasonCode: "agent_profile_binding.owner_mismatch",
              status: "ready_for_phase_6",
              userRecoveryAction: "reconnect_agent_binding",
            },
            publicationOutcome: {
              failurePublicationCommandId: "fpc-1",
              finalMessageKind: "failure_notice",
              observedAtMs: 1_700_000_001_400,
              publicationErrorCode: null,
              publishedSignalId: "sig-head-failure-1",
              status: "failure_published",
            },
            runtimeCoordinatorExecutionId: null,
            status: "publication_intent_ready",
            targetWakeLifecycleIdentity: request.targetWakeLifecycleIdentity,
            targetWakeLifecycleId:
              request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
            updatedAtMs: 1_700_000_001_400,
            waitingBoundary: null,
          },
          ok: true,
          readStatus: "found",
        })
      );
    const readFinalVisibleMessageTrace = vi.fn().mockReturnValue({
      finalVisibleMessage,
      finalVisibleMessageLinkage: {
        status: "matched_published_signal",
        reasonCode: "final_visible_message.matched_published_signal",
        sourceFact: "published_signal_candidate",
        candidateSignalIds: ["sig-head-failure-1", "sig-result-inbox-1"],
        claimSignalId: null,
        selectedSignalId: "sig-head-failure-1",
      },
    });

    const result = await readSpaceDispatchTrace({
      db: createTraceDb({
        resultRow: null,
        resultInboxRowPatch: {
          publishedSignalId: "sig-result-inbox-1",
        },
        runtimeCoordinatorExecutionRow: undefined,
      }),
      dispatchId: "dispatch-1",
      readFinalVisibleMessageTrace,
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      readRuntimeCoordinatorHeadLifecycleTrace,
      spaceId: "space-1",
    });

    expect(readFinalVisibleMessageTrace).toHaveBeenCalledWith({
      dispatchId: "dispatch-1",
      publishedSignalIdCandidates: ["sig-head-failure-1", "sig-result-inbox-1"],
      targetProfileId: "agt-target-1",
    });
    expect(result.trace?.finalVisibleMessage).toEqual(finalVisibleMessage);
    expect(result.trace?.finalVisibleOutcome).toMatchObject({
      delivered: true,
      publicationKind: "failure_notice",
      reasonCode: "agent_profile_binding.owner_mismatch",
      signalId: "sig-head-failure-1",
      sourceFact: "final_visible_message",
      status: "visible_failure",
    });
    expect(result.correlation.publishedSignalId).toBeNull();
  });

  it("reads stopped notices from RuntimeCoordinator accepted cancellation events before late result signals", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([]);
    const finalVisibleMessage = {
      factSource: "space_signal_by_published_signal_id" as const,
      signalId: "sig-stop-1",
      signalType: "signal.system_notice" as const,
      dispatchId: "dispatch-1",
      targetProfileId: "agt-target-1",
      profileId: "openmeld-system",
      profileKind: "system" as const,
      profileName: "OpenMeld",
      text: "Wake was stopped for @Agent.",
      reasonCode: "adapter.cancel.accepted",
      noticeType: "wake_stopped" as const,
      statusType: null,
      createdAt: "2024-11-14T22:13:21.000Z",
    };
    const readFinalVisibleMessageTrace = vi.fn().mockReturnValue({
      finalVisibleMessage,
      finalVisibleMessageLinkage: {
        status: "matched_published_signal",
        reasonCode: "final_visible_message.matched_published_signal",
        sourceFact: "published_signal_candidate",
        candidateSignalIds: ["sig-stop-1", "sig-late-reply-1", "sig-inbox-1"],
        claimSignalId: null,
        selectedSignalId: "sig-stop-1",
      },
    });

    const result = await readSpaceDispatchTrace({
      db: createTraceDb({
        resultInboxRowPatch: {
          publishedSignalId: "sig-inbox-1",
        },
        resultRowPatch: {
          publishedSignalId: "sig-late-reply-1",
        },
        runtimeCoordinatorEventRows: [
          {
            event_id: "event-cancel-accepted",
            event_type: "cancellation_control_accepted",
            idempotency_key: "wake-stop-control:accepted",
            observed_at_ms: 1_700_000_003_250,
            payload_json: JSON.stringify({
              accepted: true,
              stoppedNoticePublication: {
                publishedSignalId: "sig-stop-1",
                status: "published",
              },
            }),
            reason_code: "adapter.cancel.accepted",
            runtime_coordinator_execution_id: "rce-dispatch-1",
            status_after: "cancelled",
          },
        ],
        runtimeCoordinatorExecutionRow: {
          status: "cancelled",
          terminal_outcome_json: JSON.stringify({
            kind: "cancelled",
            observedAtMs: 1_700_000_003_250,
            reasonCode: "adapter.cancel.accepted",
          }),
        },
      }),
      dispatchId: "dispatch-1",
      readFinalVisibleMessageTrace,
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      spaceId: "space-1",
    });

    expect(readFinalVisibleMessageTrace).toHaveBeenCalledWith({
      dispatchId: "dispatch-1",
      publishedSignalIdCandidates: [
        "sig-stop-1",
        "sig-late-reply-1",
        "sig-inbox-1",
      ],
      targetProfileId: "agt-target-1",
    });
    expect(result.trace?.finalVisibleMessage).toEqual(finalVisibleMessage);
    expect(result.trace?.finalVisibleOutcome).toMatchObject({
      delivered: true,
      publicationKind: "stopped_notice",
      reasonCode: "adapter.cancel.accepted",
      signalId: "sig-stop-1",
      sourceFact: "final_visible_message",
      status: "visible_stopped",
    });
  });

  it("falls back to the latest dispatch result inbox fact when the latest attempt has no result", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([]);
    const db = createTraceDb({
      resultInboxRows: [
        null,
        {
          resultKey: "dispatch-1::attempt-original",
          attemptId: "attempt-original",
          taskId: "task-1",
          targetProfileId: "agt-target-1",
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 4,
          submittedConnectionGeneration: 3,
          acceptedAtMs: 1_700_000_003_500,
          publishState: "result_accepted",
          publishedSignalId: null,
          publicationErrorCode: null,
          updatedAtMs: 1_700_000_003_500,
        },
      ],
    });

    const result = await readSpaceDispatchTrace({
      db,
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      spaceId: "space-1",
    });

    expect(result.trace?.latestAttempt?.attemptId).toBe("attempt-1");
    expect(result.trace?.resultInbox).toMatchObject({
      factSource: "dispatch_result_inbox",
      resultKey: "dispatch-1::attempt-original",
      attemptId: "attempt-original",
      publishState: "result_accepted",
    });
  });

  it("surfaces quarantined legacy result inbox facts without treating them as replies", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([]);
    const db = createTraceDb({
      resultInboxRowPatch: {
        publishState: "legacy_result_quarantined",
        publishedSignalId: null,
        publicationErrorCode: "runtime_coordinator.execution_token_required",
      },
      resultRow: null,
    });

    const result = await readSpaceDispatchTrace({
      db,
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      spaceId: "space-1",
    });

    expect(result.trace?.resultInbox).toMatchObject({
      factSource: "dispatch_result_inbox",
      resultKey: "dispatch-1::attempt-1",
      publishState: "legacy_result_quarantined",
      publishedSignalId: null,
      publicationErrorCode: "runtime_coordinator.execution_token_required",
    });
  });

  it("surfaces stopped suppressed result inbox facts for late replies", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([]);
    const db = createTraceDb({
      resultInboxRowPatch: {
        publishState: "reply_suppressed_stopped",
        publishedSignalId: "sig-stop-1",
        publicationErrorCode: "runtime_coordinator.wake_stop_requested",
      },
      resultRow: null,
    });

    const result = await readSpaceDispatchTrace({
      db,
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      spaceId: "space-1",
    });

    expect(result.trace?.resultInbox).toMatchObject({
      factSource: "dispatch_result_inbox",
      resultKey: "dispatch-1::attempt-1",
      publishState: "reply_suppressed_stopped",
      publishedSignalId: "sig-stop-1",
      publicationErrorCode: "runtime_coordinator.wake_stop_requested",
    });
  });

  it("surfaces runtime coordinator diagnostic events through dispatch trace", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([]);
    const db = createTraceDb({
      runtimeCoordinatorEventRows: [
        {
          event_id: "event-owner-conflict-stale",
          event_type: "owner_conflict_stale_token",
          idempotency_key: "rce-dispatch-1::run-old::owner-conflict",
          observed_at_ms: 1_700_000_003_250,
          payload_json: JSON.stringify({
            conflictSummary: "stale owner conflict ignored",
            tokenFingerprint: "etfp_v1_bbbbbbbbbbbbbbbb",
            tokenStatus: "superseded",
          }),
          reason_code: "owner_conflict.stale_token",
          runtime_coordinator_execution_id: "rce-dispatch-1",
          status_after: null,
        },
      ],
      runtimeCoordinatorExecutionRow: {
        status: "delivery_accepted",
      },
    });

    const result = await readSpaceDispatchTrace({
      db,
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      spaceId: "space-1",
    });

    expect(result.trace?.runtimeCoordinatorEvents).toEqual([
      expect.objectContaining({
        eventType: "owner_conflict_stale_token",
        factSource: "runtime_coordinator_projection",
        reasonCode: "owner_conflict.stale_token",
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
      }),
    ]);
  });

  it("reads RuntimeCoordinator head lifecycle through verified dispatch owner evidence", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([]);
    const readRuntimeCoordinatorHeadLifecycleTrace = vi
      .fn()
      .mockImplementation(({ request }) =>
        Promise.resolve({
          lifecycle: {
            createdAtMs: 1_700_000_001_100,
            duplicateDispatchCount: 0,
            executionLinkedAtMs: null,
            modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
            noExecutionDecision: {
              decidedAtMs: 1_700_000_001_200,
              publicationCategory: "binding_required",
              reasonCode: "agent_profile_binding.missing",
              source: "dispatch_preflight",
              userRecoveryAction: "set_up_agent_binding",
            },
            ownerUserId: "owner-1",
            primaryDispatchId: "dispatch-1",
            publicationIntent: {
              intentId:
                "twl_space-1_sig-source-1_agt-target-1::no-execution-failure",
              kind: "no_execution_failure",
              publicationCategory: "binding_required",
              readyAtMs: 1_700_000_001_300,
              reasonCode: "agent_profile_binding.missing",
              status: "ready_for_phase_6",
              userRecoveryAction: "set_up_agent_binding",
            },
            runtimeCoordinatorExecutionId: null,
            status: "publication_intent_ready",
            targetWakeLifecycleIdentity: request.targetWakeLifecycleIdentity,
            targetWakeLifecycleId:
              request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
            updatedAtMs: 1_700_000_001_300,
            waitingBoundary: null,
          },
          ok: true,
          readStatus: "found",
        })
      );

    const result = await readSpaceDispatchTrace({
      db: createTraceDb({
        runtimeCoordinatorExecutionRow: undefined,
      }),
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      readRuntimeCoordinatorHeadLifecycleTrace,
      spaceId: "space-1",
    });

    expect(readRuntimeCoordinatorHeadLifecycleTrace).toHaveBeenCalledWith({
      dispatch: expect.objectContaining({
        dispatchId: "dispatch-1",
        owner: {
          id: "owner-1",
          kind: "owner_account",
        },
      }),
      ownerUserId: "owner-1",
      request: {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        targetWakeLifecycleIdentity: expect.objectContaining({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          sourceSignalId: "sig-source-1",
          spaceId: "space-1",
          targetProfileId: "agt-target-1",
        }),
      },
    });
    expect(result.trace?.runtimeCoordinatorHeadLifecycle).toMatchObject({
      factSource: "runtime_coordinator_head_lifecycle",
      noExecutionDecision: {
        reasonCode: "agent_profile_binding.missing",
        userRecoveryAction: "set_up_agent_binding",
      },
      publicationIntent: {
        reasonCode: "agent_profile_binding.missing",
        status: "ready_for_phase_6",
      },
      readStatus: "found",
      runtimeCoordinatorExecutionId: null,
      status: "publication_intent_ready",
    });
  });

  it.each([
    "missing_reader",
    "rejected_read",
    "thrown_read",
  ])("keeps unavailable task Context in v7 after $0", async (failure) => {
    const readRuntimeCoordinatorHeadLifecycleTrace =
      failure === "missing_reader"
        ? undefined
        : vi.fn(() => {
            const error = new Error("Head authority unavailable");
            if (failure === "thrown_read") {
              throw error;
            }
            return Promise.reject(error);
          });
    for (const version of [6, 7, 8] as const) {
      const result = await readSpaceDispatchTrace({
        db: createTraceDb({ runtimeCoordinatorExecutionRow: undefined }),
        dispatchId: "dispatch-1",
        readReplySignalTrace: vi.fn().mockReturnValue(null),
        readRuntimeCoordinatorHeadLifecycleTrace,
        responseContractVersion: version,
        spaceId: "space-1",
      });
      const head = result.trace?.runtimeCoordinatorHeadLifecycle;
      expect(head?.readStatus).toBe("authority_unavailable");
      if (version >= 7) {
        expect(head?.executionContext).toEqual({
          readStatus: "authority_unavailable",
          reasonCode:
            failure === "missing_reader"
              ? "runtime_coordinator.head_owner_evidence_unavailable"
              : "runtime_coordinator.head_lifecycle_trace_unavailable",
        });
      } else {
        expect(head).not.toHaveProperty("executionContext");
      }
    }
  });

  it.each([
    {
      reasonCode: "wake.device_wait.readiness_checking",
      trigger: "agent_readiness_reported",
      userRecoveryAction: "check_status",
      userVisibleState: "waiting_for_agent_readiness",
      waitingCategory: "local_agent_unavailable",
      waitingFor: "agent_readiness_report",
    },
    {
      reasonCode: "daemon.service.draining",
      trigger: "agent_readiness_reported",
      userRecoveryAction: "check_status",
      userVisibleState: "waiting_for_agent_readiness",
      waitingCategory: "local_agent_unavailable",
      waitingFor: "agent_readiness_report",
    },
    {
      reasonCode: "wake.device_wait.access_check_unavailable",
      trigger: "space_access_rechecked",
      userRecoveryAction: "check_status",
      userVisibleState: "waiting_for_space_access",
      waitingCategory: "space_access_unavailable",
      waitingFor: "space_access_check",
    },
  ])("negotiates $reasonCode and task context without changing older trace shapes", async (waiting) => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([]);
    const readRuntimeCoordinatorHeadLifecycleTrace = vi
      .fn()
      .mockImplementation(({ request }) =>
        Promise.resolve({
          ok: true,
          readStatus: "found",
          executionContext: {
            readStatus: "found",
            contextId: "11111111-1111-4111-8111-111111111111",
            access: "space_context",
            permissionSource: "context_restriction",
            workspace: "isolated",
          },
          lifecycle: {
            createdAtMs: 1_700_000_001_100,
            duplicateDispatchCount: 0,
            executionLinkedAtMs: null,
            modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
            noExecutionDecision: null,
            ownerUserId: "owner-1",
            primaryDispatchId: "dispatch-1",
            publicationIntent: null,
            runtimeCoordinatorExecutionId: null,
            status: "waiting",
            targetWakeLifecycleIdentity: request.targetWakeLifecycleIdentity,
            targetWakeLifecycleId:
              request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
            updatedAtMs: 1_700_000_001_300,
            waitingBoundary: {
              deadlineAtMs: 1_700_000_300_000,
              deadlineOutcome: "publication_intent_ready",
              observedAtMs: 1_700_000_001_200,
              softDeadlineAtMs: 1_700_000_030_000,
              waitingSinceMs: 1_700_000_001_100,
              triggerOwner: "runtime_coordinator",
              ...waiting,
            },
          },
        })
      );
    for (const version of [undefined, 2, 3, 4, 5, 6, 7, 8] as const) {
      const result = await readSpaceDispatchTrace({
        db: createTraceDb({ runtimeCoordinatorExecutionRow: undefined }),
        dispatchId: "dispatch-1",
        readReplySignalTrace: vi.fn().mockReturnValue(null),
        readRuntimeCoordinatorHeadLifecycleTrace,
        responseContractVersion: version,
        spaceId: "space-1",
      });
      expect(result.trace?.runtimeCoordinatorHeadLifecycle).toMatchObject({
        status: "waiting",
        runtimeCoordinatorExecutionId: null,
        waitingBoundary:
          version !== undefined && version >= 5
            ? {
                reasonCode: waiting.reasonCode,
                waitingFor: waiting.waitingFor,
                deadlineAt: "2023-11-14T22:18:20.000Z",
              }
            : null,
      });
      if (version !== undefined && version >= 7) {
        expect(
          result.trace?.runtimeCoordinatorHeadLifecycle?.executionContext
        ).toMatchObject({
          access: "space_context",
          permissionSource: "context_restriction",
        });
      } else {
        expect(
          result.trace?.runtimeCoordinatorHeadLifecycle
        ).not.toHaveProperty("executionContext");
      }
    }
  });

  it.each([
    3, 4, 5,
  ] as const)("projects expiry recovery for Trace v%s without reusing an offline repair action", async (version) => {
    const decision = {
      reasonCode: "wake.device_wait.expired",
      publicationCategory: "local_agent_unavailable",
      userRecoveryAction: "send_new_wake",
    };
    const readRuntimeCoordinatorHeadLifecycleTrace = vi
      .fn()
      .mockImplementation(({ request }) =>
        Promise.resolve({
          ok: true,
          readStatus: "found",
          lifecycle: {
            createdAtMs: 1_700_000_001_100,
            updatedAtMs: 1_700_000_001_300,
            duplicateDispatchCount: 0,
            executionLinkedAtMs: null,
            modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
            ownerUserId: "owner-1",
            primaryDispatchId: "dispatch-1",
            runtimeCoordinatorExecutionId: null,
            status: "publication_intent_ready",
            waitingBoundary: null,
            targetWakeLifecycleIdentity: request.targetWakeLifecycleIdentity,
            targetWakeLifecycleId:
              request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
            noExecutionDecision: {
              ...decision,
              decidedAtMs: 1_700_000_001_300,
              source: "runtime_coordinator_head_waiting_deadline",
            },
            publicationIntent: {
              ...decision,
              intentId: "expiry-intent",
              kind: "no_execution_failure",
              readyAtMs: 1_700_000_001_300,
              status: "ready_for_phase_6",
            },
          },
        })
      );
    const result = await readSpaceDispatchTrace({
      db: createTraceDb({ runtimeCoordinatorExecutionRow: undefined }),
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      readRuntimeCoordinatorHeadLifecycleTrace,
      responseContractVersion: version,
      spaceId: "space-1",
    });
    expect(result.trace?.runtimeCoordinatorHeadLifecycle).toMatchObject({
      noExecutionDecision: {
        reasonCode: "wake.device_wait.expired",
        userRecoveryAction: version === 5 ? "send_new_wake" : "check_status",
      },
      publicationIntent: {
        reasonCode: "wake.device_wait.expired",
        userRecoveryAction: version === 5 ? "send_new_wake" : "check_status",
      },
    });
  });

  it("keeps pending route registration compatible while exposing it to the current trace contract", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([]);
    const readRuntimeCoordinatorHeadLifecycleTrace = vi
      .fn()
      .mockImplementation(({ request }) =>
        Promise.resolve({
          lifecycle: {
            createdAtMs: 1_700_000_001_100,
            duplicateDispatchCount: 0,
            executionLinkedAtMs: null,
            modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
            noExecutionDecision: null,
            ownerUserId: "owner-1",
            primaryDispatchId: "dispatch-1",
            publicationIntent: null,
            runtimeCoordinatorExecutionId: null,
            status: "waiting",
            targetWakeLifecycleIdentity: request.targetWakeLifecycleIdentity,
            targetWakeLifecycleId:
              request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
            updatedAtMs: 1_700_000_001_300,
            waitingBoundary: {
              deadlineAtMs: 1_700_000_300_000,
              deadlineOutcome: "publication_intent_ready",
              observedAtMs: 1_700_000_001_200,
              reasonCode: "daemon.profile.pending_first_report",
              softDeadlineAtMs: 1_700_000_030_000,
              trigger: "wake_route_reported",
              triggerOwner: "runtime_coordinator",
              userRecoveryAction: "wait_for_wake_route_report",
              userVisibleState: "waiting_for_wake_route_report",
              waitingCategory: "wake_route_registration_pending",
              waitingFor: "wake_route_report",
              waitingSinceMs: 1_700_000_001_100,
            },
          },
          ok: true,
          readStatus: "found",
        })
      );

    const result = await readSpaceDispatchTrace({
      db: createTraceDb({
        runtimeCoordinatorExecutionRow: undefined,
      }),
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      readRuntimeCoordinatorHeadLifecycleTrace,
      spaceId: "space-1",
    });

    expect(result.trace?.runtimeCoordinatorHeadLifecycle).toMatchObject({
      readStatus: "found",
      status: "waiting",
      waitingBoundary: null,
    });

    const currentResult = await readSpaceDispatchTrace({
      db: createTraceDb({
        runtimeCoordinatorExecutionRow: undefined,
      }),
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      readRuntimeCoordinatorHeadLifecycleTrace,
      responseContractVersion: 2,
      spaceId: "space-1",
    });

    expect(currentResult.trace?.runtimeCoordinatorHeadLifecycle).toMatchObject({
      readStatus: "found",
      status: "waiting",
      waitingBoundary: {
        deadlineAt: "2023-11-14T22:18:20.000Z",
        reasonCode: "daemon.profile.pending_first_report",
        softDeadlineAt: "2023-11-14T22:13:50.000Z",
        userRecoveryAction: "wait_for_wake_route_report",
        waitingFor: "wake_route_report",
      },
    });

    readRuntimeCoordinatorHeadLifecycleTrace.mockImplementation(({ request }) =>
      Promise.resolve({
        lifecycle: {
          createdAtMs: 1_700_000_001_100,
          duplicateDispatchCount: 0,
          executionLinkedAtMs: null,
          modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
          noExecutionDecision: {
            decidedAtMs: 1_700_000_300_000,
            publicationCategory: "wake_route_registration_pending",
            reasonCode: "daemon.profile.pending_first_report",
            source: "runtime_coordinator_head_waiting_deadline",
            userRecoveryAction: "wait_for_wake_route_report",
          },
          ownerUserId: "owner-1",
          primaryDispatchId: "dispatch-1",
          publicationIntent: {
            intentId: "pending-first-report-failure-1",
            kind: "no_execution_failure",
            publicationCategory: "wake_route_registration_pending",
            readyAtMs: 1_700_000_300_000,
            reasonCode: "daemon.profile.pending_first_report",
            status: "ready_for_phase_6",
            userRecoveryAction: "wait_for_wake_route_report",
          },
          runtimeCoordinatorExecutionId: null,
          status: "publication_intent_ready",
          targetWakeLifecycleIdentity: request.targetWakeLifecycleIdentity,
          targetWakeLifecycleId:
            request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
          updatedAtMs: 1_700_000_300_000,
          waitingBoundary: null,
        },
        ok: true,
        readStatus: "found",
      })
    );

    const terminalResult = await readSpaceDispatchTrace({
      db: createTraceDb({
        runtimeCoordinatorExecutionRow: undefined,
      }),
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      readRuntimeCoordinatorHeadLifecycleTrace,
      spaceId: "space-1",
    });

    expect(terminalResult.trace?.runtimeCoordinatorHeadLifecycle).toMatchObject(
      {
        noExecutionDecision: null,
        publicationIntent: null,
        readStatus: "found",
        status: "publication_intent_ready",
        waitingBoundary: null,
      }
    );

    const currentTerminalResult = await readSpaceDispatchTrace({
      db: createTraceDb({
        runtimeCoordinatorExecutionRow: undefined,
      }),
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      readRuntimeCoordinatorHeadLifecycleTrace,
      responseContractVersion: 2,
      spaceId: "space-1",
    });

    expect(
      currentTerminalResult.trace?.runtimeCoordinatorHeadLifecycle
    ).toMatchObject({
      noExecutionDecision: {
        publicationCategory: "wake_route_registration_pending",
        reasonCode: "daemon.profile.pending_first_report",
        userRecoveryAction: "wait_for_wake_route_report",
      },
      publicationIntent: {
        publicationCategory: "wake_route_registration_pending",
        reasonCode: "daemon.profile.pending_first_report",
        userRecoveryAction: "wait_for_wake_route_report",
      },
      readStatus: "found",
      status: "publication_intent_ready",
      waitingBoundary: null,
    });
  });

  it("down-projects current-only readiness no-execution facts for strict v2 and legacy trace clients", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([]);
    const readRuntimeCoordinatorHeadLifecycleTrace = vi
      .fn()
      .mockImplementation(({ request }) =>
        Promise.resolve({
          lifecycle: {
            createdAtMs: 1_700_000_001_100,
            duplicateDispatchCount: 0,
            executionLinkedAtMs: null,
            modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
            noExecutionDecision: {
              decidedAtMs: 1_700_000_001_400,
              publicationCategory: "workspace_unavailable",
              reasonCode: "workspace.invalid",
              source: "dispatch_preflight",
              userRecoveryAction: "review_agent_settings",
            },
            ownerUserId: "owner-1",
            primaryDispatchId: "dispatch-1",
            publicationIntent: {
              intentId: "workspace-unavailable-intent-1",
              kind: "no_execution_failure",
              publicationCategory: "workspace_unavailable",
              readyAtMs: 1_700_000_001_400,
              reasonCode: "workspace.invalid",
              status: "ready_for_phase_6",
              userRecoveryAction: "review_agent_settings",
            },
            runtimeCoordinatorExecutionId: null,
            status: "publication_intent_ready",
            targetWakeLifecycleIdentity: request.targetWakeLifecycleIdentity,
            targetWakeLifecycleId:
              request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
            updatedAtMs: 1_700_000_001_400,
            waitingBoundary: null,
          },
          ok: true,
          readStatus: "found",
        })
      );
    const commonInput = {
      db: createTraceDb({ runtimeCoordinatorExecutionRow: undefined }),
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      readRuntimeCoordinatorHeadLifecycleTrace,
      spaceId: "space-1",
    };

    const previousResult = await readSpaceDispatchTrace({
      ...commonInput,
      responseContractVersion: 2,
    });
    expect(previousResult.trace?.runtimeCoordinatorHeadLifecycle).toMatchObject(
      {
        noExecutionDecision: null,
        publicationIntent: null,
        readStatus: "found",
        status: "publication_intent_ready",
      }
    );

    const legacyResult = await readSpaceDispatchTrace(commonInput);
    expect(legacyResult.trace?.runtimeCoordinatorHeadLifecycle).toMatchObject({
      noExecutionDecision: null,
      publicationIntent: null,
      readStatus: "found",
      status: "publication_intent_ready",
    });

    const currentResult = await readSpaceDispatchTrace({
      ...commonInput,
      responseContractVersion: SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION,
    });
    const v3Result = await readSpaceDispatchTrace({
      ...commonInput,
      responseContractVersion: 3,
    });
    const {
      executionContext: _executionContext,
      ...currentHeadWithoutContext
    } = currentResult.trace?.runtimeCoordinatorHeadLifecycle ?? {};
    expect(v3Result.trace?.runtimeCoordinatorHeadLifecycle).toEqual(
      currentHeadWithoutContext
    );
    expect(v3Result.trace?.runtimeCoordinatorHeadLifecycle).not.toHaveProperty(
      "executionContext"
    );
    expect(currentResult.trace?.runtimeCoordinatorHeadLifecycle).toMatchObject({
      executionContext: {
        readStatus: "authority_unavailable",
        reasonCode: "execution_context.diagnostics_not_reported",
      },
      noExecutionDecision: {
        publicationCategory: "workspace_unavailable",
        reasonCode: "workspace.invalid",
        userRecoveryAction: "review_agent_settings",
      },
      publicationIntent: {
        publicationCategory: "workspace_unavailable",
        reasonCode: "workspace.invalid",
        userRecoveryAction: "review_agent_settings",
      },
      readStatus: "found",
      status: "publication_intent_ready",
    });
  });

  it("surfaces the runtime token diagnostic trace matrix without token secrets", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([]);
    const rawToken = "rcet_v1_never_persist_this_runtime_execution_token";
    const eventRows = [
      {
        event_id: "event-token-superseded",
        event_type: "execution_token_validation_failed",
        idempotency_key: "rce-dispatch-1::run-old::late-result",
        observed_at_ms: 1_700_000_003_250,
        payload_json: JSON.stringify({
          ignoredEventSummary: "late result ignored",
          runId: "run-old",
          tokenFingerprint: "etfp_v1_bbbbbbbbbbbbbbbb",
          tokenStatus: "superseded",
        }),
        reason_code: "execution_token_superseded",
        runtime_coordinator_execution_id: "rce-dispatch-1",
        status_after: null,
      },
      {
        event_id: "event-token-terminal-late",
        event_type: "execution_token_terminal_late",
        idempotency_key: "rce-dispatch-1::run-old::after-terminal",
        observed_at_ms: 1_700_000_003_350,
        payload_json: JSON.stringify({
          ignoredEventSummary: "result arrived after terminal outcome",
          runId: "run-old",
          tokenFingerprint: "etfp_v1_bbbbbbbbbbbbbbbb",
          tokenStatus: "terminal",
        }),
        reason_code: "execution_token_terminal_late",
        runtime_coordinator_execution_id: "rce-dispatch-1",
        status_after: "result_accepted",
      },
      {
        event_id: "event-owner-conflict-stale",
        event_type: "owner_conflict_stale_token",
        idempotency_key: "rce-dispatch-1::run-old::owner-conflict",
        observed_at_ms: 1_700_000_003_450,
        payload_json: JSON.stringify({
          conflictSummary: "stale owner conflict ignored",
          tokenFingerprint: "etfp_v1_bbbbbbbbbbbbbbbb",
          tokenStatus: "superseded",
        }),
        reason_code: "owner_conflict.stale_token",
        runtime_coordinator_execution_id: "rce-dispatch-1",
        status_after: null,
      },
    ];
    const db = createTraceDb({
      runtimeCoordinatorEventRows: eventRows,
      runtimeCoordinatorExecutionRow: {
        status: "result_accepted",
      },
    });

    const result = await readSpaceDispatchTrace({
      db,
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      spaceId: "space-1",
    });

    expect(JSON.stringify(result)).not.toContain(rawToken);
    expect(result.correlation.runtimeCoordinatorExecutionId).toBe(
      "rce-dispatch-1"
    );
    expect(result.trace?.runtimeCoordinatorEvents).toEqual(
      eventRows.map((row) =>
        expect.objectContaining({
          eventType: row.event_type,
          factSource: "runtime_coordinator_projection",
          reasonCode: row.reason_code,
          runtimeCoordinatorExecutionId: "rce-dispatch-1",
        })
      )
    );
  });

  it("does not leak raw execution tokens from invalid runtime coordinator event rows", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([]);
    const rawToken = "rcet_v1_abcdefghijklmnopqrstuvwxyz123456";
    const db = createTraceDb({
      runtimeCoordinatorEventRows: [
        {
          event_id: "event-raw-token",
          event_type: "execution_token_validation_failed",
          idempotency_key: "raw-token-event",
          observed_at_ms: 1_700_000_003_250,
          payload_json: JSON.stringify({
            executionToken: rawToken,
            tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaa",
          }),
          reason_code: "execution_token_mismatch",
          runtime_coordinator_execution_id: "rce-dispatch-1",
          status_after: null,
        },
      ],
      runtimeCoordinatorExecutionRow: {
        status: "delivery_accepted",
      },
    });

    const result = await readSpaceDispatchTrace({
      db,
      dispatchId: "dispatch-1",
      readReplySignalTrace: vi.fn().mockReturnValue(null),
      spaceId: "space-1",
    });

    expect(JSON.stringify(result)).not.toContain(rawToken);
    expect(result.trace?.runtimeCoordinatorEvents).toEqual([]);
  });

  it("rejects dispatch trace when result evidence does not match the ledger fact", async () => {
    const db = createTraceDb({
      resultRowPatch: {
        spaceId: "space-other",
      },
    });

    await expect(
      readSpaceDispatchTrace({
        db,
        dispatchId: "dispatch-1",
        readReplySignalTrace: vi.fn().mockReturnValue(null),
        spaceId: "space-1",
      })
    ).rejects.toThrow("invalid dispatch result trace evidence");
  });

  it("surfaces dispatch result trace read failures instead of reporting missing evidence", async () => {
    const db = createTraceDb({
      resultReadError: new Error("D1 read failed"),
    });

    await expect(
      readSpaceDispatchTrace({
        db,
        dispatchId: "dispatch-1",
        readReplySignalTrace: vi.fn().mockReturnValue(null),
        spaceId: "space-1",
      })
    ).rejects.toThrow(
      "dispatch result trace read failed for dispatch dispatch-1"
    );
  });

  it("rejects dispatch trace when result inbox evidence does not match the ledger fact", async () => {
    const db = createTraceDb({
      resultInboxRowPatch: {
        targetProfileId: "agt-other",
      },
    });

    await expect(
      readSpaceDispatchTrace({
        db,
        dispatchId: "dispatch-1",
        readReplySignalTrace: vi.fn().mockReturnValue(null),
        spaceId: "space-1",
      })
    ).rejects.toThrow("invalid dispatch result inbox trace evidence");
  });

  it("surfaces dispatch result inbox trace read failures", async () => {
    const db = createTraceDb({
      resultInboxReadError: new Error("D1 read failed"),
    });

    await expect(
      readSpaceDispatchTrace({
        db,
        dispatchId: "dispatch-1",
        readReplySignalTrace: vi.fn().mockReturnValue(null),
        spaceId: "space-1",
      })
    ).rejects.toThrow(
      "dispatch result inbox trace read failed for dispatch dispatch-1"
    );
  });

  it("reads archived dispatch result dispatch execution facts from runtime and lifecycle decisions", async () => {
    vi.mocked(listRecentOpenMeldDaemonOpsDecisions).mockResolvedValue([
      createDecisionRecord({
        decisionCode: DISPATCH_RUNTIME_TELEMETRY_DECISION_CODE,
        payload: {
          agentControllerConversationId: "thread-1",
          effectiveRuntimeWorkingDirectory: "/tmp/demo",
          runtimeWorkspaceFingerprint: "sha256:workspace-demo",
          agentControllerRef: "builtin:codex",
          resolvedAgentControllerConversationId:
            "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
          agentControllerConversationKind: "thread",
        },
      }),
      createDecisionRecord({
        decisionCode: DISPATCH_CONVERSATION_LIFECYCLE_DECISION_CODE,
        payload: {
          attemptId: "attempt-1",
          agentControllerConversationResume: {
            status: "continued",
          },
          localRuntimeContext: {
            status: "reused",
            reason: null,
          },
          bootstrap: {
            status: "applied",
            reason: null,
          },
        },
      }),
    ]);

    const result = await readDispatchResultConversationFacts({
      db: createTraceDb(),
      dispatchId: "dispatch-1",
    });

    expect(result).toEqual({
      dispatchExecution: {
        agentControllerConversationResume: {
          status: "continued",
        },
        localRuntimeContext: {
          status: "reused",
          reason: null,
        },
        bootstrap: {
          status: "applied",
          reason: null,
        },
      },
      runtimeWorkspace: {
        path: "/tmp/demo",
        fingerprint: "sha256:workspace-demo",
      },
      agentControllerConversation: {
        agentControllerConversationId: "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
        agentControllerRef: "builtin:codex",
        agentControllerConversationKind: "thread",
      },
    });
    expect(listRecentOpenMeldDaemonOpsDecisions).toHaveBeenCalledTimes(1);
    expect(listRecentOpenMeldDaemonOpsDecisions).toHaveBeenCalledWith({
      db: expect.anything(),
      correlationId: "dispatch-1",
      limit: 200,
    });
  });
});

const createTraceDb = (
  input: {
    dispatchStatus?: string;
    attemptStatus?: string;
    mutableBindingControllerRef?: { current: string | null };
    resultInboxReadError?: Error;
    resultInboxRowPatch?: Record<string, unknown>;
    resultInboxRows?: Array<Record<string, unknown> | null>;
    resultReadError?: Error;
    resultRow?: Record<string, unknown> | null;
    resultRowPatch?: Record<string, unknown>;
    nativeDeliveryRow?: Record<string, unknown> | null;
    runtimeCoordinatorEventRows?: Record<string, unknown>[];
    runtimeCoordinatorExecutionRow?: Record<string, unknown>;
  } = {}
) =>
  createProjectionPostgresDatabase(({ text }) => {
    if (text.includes("openMeldDaemon_agent_profile_bindings")) {
      return input.nativeDeliveryRow
        ? [
            {
              ...input.nativeDeliveryRow,
              storedAgentControllerRef:
                input.mutableBindingControllerRef?.current ?? null,
            },
          ]
        : [];
    }
    if (
      text.includes('FROM "openmeld"."openMeldDaemon_dispatch_ledger"') &&
      text.includes("WHERE dispatch_id = $1")
    ) {
      return [
        {
          dispatchId: "dispatch-1",
          idempotencyKey: "idem-1",
          sourceEventId: "sig-source-1",
          sourceClientMessageId: "client-message-1",
          dispatchOwnerKind: "owner_account",
          dispatchOwnerId: "owner-1",
          targetProfileId: "agt-target-1",
          status: input.dispatchStatus ?? "dispatching",
          spaceId: "space-1",
          firstSeenAtMs: 1_700_000_001_000,
          lastAttemptAtMs: 1_700_000_002_000,
          attemptCount: 1,
          latestAttemptId: "attempt-1",
        },
      ];
    }
    if (text.includes('FROM "openmeld"."openMeldDaemon_dispatch_attempts"')) {
      return [
        {
          attemptId: "attempt-1",
          dispatchId: "dispatch-1",
          idempotencyKey: "idem-1",
          attemptNo: 1,
          status: input.attemptStatus ?? "waiting_result",
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 2,
          leaseEpoch: 4,
          createdAtMs: 1_700_000_002_000,
          startedAtMs: 1_700_000_003_000,
          finishedAtMs: null,
          errorCode: null,
          errorMessage: null,
        },
      ];
    }
    if (
      text.includes(
        'FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"'
      )
    ) {
      return input.nativeDeliveryRow ? [input.nativeDeliveryRow] : [];
    }
    if (text.includes('FROM "openmeld"."openMeldDaemon_dispatch_results"')) {
      if (input.resultReadError) {
        throw input.resultReadError;
      }
      const row =
        input.resultRow === undefined
          ? {
              resultRef: "result-1",
              dispatchId: "dispatch-1",
              spaceId: "space-1",
              actorProfileId: "agt-target-1",
              replyToSignalId: "sig-source-1",
              resultKind: "final_text",
              publicOutcome: "succeeded",
              publishedSignalId: "sig-reply-1",
              statusType: null,
              createdAtMs: 1_700_000_004_000,
              ...input.resultRowPatch,
            }
          : input.resultRow;
      return row ? [row] : [];
    }
    if (
      text.includes('FROM "openmeld"."openMeldDaemon_dispatch_result_inbox"')
    ) {
      if (input.resultInboxReadError) {
        throw input.resultInboxReadError;
      }
      const nextRow = input.resultInboxRows?.shift();
      if (input.resultInboxRows && nextRow === null) {
        return [];
      }
      return [
        {
          resultKey: "dispatch-1::attempt-1",
          dispatchId: "dispatch-1",
          attemptId: "attempt-1",
          taskId: "task-1",
          targetProfileId: "agt-target-1",
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 4,
          submittedConnectionGeneration: 3,
          resultPayloadJson: JSON.stringify({
            code: "service.task_result",
            payload: {
              agentId: "agt-target-1",
              attemptId: "attempt-1",
              deduped: false,
              output: "done",
              sourceEventId: "sig-source-1",
              status: "success",
              taskId: "task-1",
            },
            v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
          }),
          acceptedAtMs: 1_700_000_003_500,
          publishState: "reply_published",
          publishedSignalId: "sig-reply-1",
          publicationErrorCode: null,
          updatedAtMs: 1_700_000_004_000,
          ...(nextRow ?? {}),
          ...input.resultInboxRowPatch,
        },
      ];
    }
    if (
      text.includes(
        'FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions"'
      )
    ) {
      return input.runtimeCoordinatorExecutionRow
        ? [
            {
              attempt_id: "attempt-1",
              binding_id: "binding-1",
              agent_controller_ref: "builtin:codex",
              claim_lease_id: null,
              connection_generation: 2,
              created_at_ms: 1_700_000_002_250,
              daemon_session_id: "daemon-session-1",
              dispatch_id: "dispatch-1",
              lease_epoch: 4,
              model_version: "openmeld.runtime_coordinator.execution.v1",
              runtime_coordinator_execution_id: "rce-dispatch-1",
              openmeld_service_runtime_id: "runtime-1",
              openmeld_service_runtime_id_source: "runtime_registry_authority",
              source_client_message_id: "client-message-1",
              space_id: "space-1",
              status: "delivery_accepted",
              target_profile_id: "agt-target-1",
              terminal_outcome_json: null,
              updated_at_ms: 1_700_000_002_500,
              ...input.runtimeCoordinatorExecutionRow,
            },
          ]
        : [];
    }
    if (
      text.includes(
        'FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events"'
      )
    ) {
      return (input.runtimeCoordinatorEventRows ?? []).map((row) => ({
        event_id: "event-1",
        event_type: "runtime_evidence_observed",
        idempotency_key: "event-idempotency-1",
        observed_at_ms: 1_700_000_003_000,
        payload_json: "{}",
        reason_code: null,
        runtime_coordinator_execution_id: "rce-dispatch-1",
        status_after: null,
        ...row,
      }));
    }
    throw new Error(`Unexpected query: ${text}`);
  });

const createDecisionRecord = (input: {
  decisionCode: string;
  payload: Record<string, unknown>;
}) => ({
  id: `${input.decisionCode}-1`,
  decisionCode: input.decisionCode,
  decidedBy: "test",
  source: "test",
  decidedAtMs: 1_700_000_010_000,
  correlationId: "dispatch-1",
  expectedRecoveryCriteria: "n/a",
  decisionPayloadJson: JSON.stringify(input.payload),
});
