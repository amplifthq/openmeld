import {
  RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
} from "@openmeld/schemas";
import type {
  GetSpaceDispatchLookupResponse,
  SpaceDispatchTraceResponse,
  SpaceDispatchTraceSnapshot,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  isRuntimeCoordinatorExecutionLocallyQueued,
  projectWakeTraceWaterfall,
} from "../space/application/wake-trace-waterfall";
import type { OpenMeldDaemonDispatchOutboxRecoveryCandidate } from "../space/infrastructure/outbox/dispatch-outbox-repo";

const CLIENT_MESSAGE_ID = "cm_01J00000000000000000000001";
const ISO = "2026-05-13T00:00:00.000Z";
const OWNER_VIEWER = {
  viewerOwnerUserId: "owner-1",
  viewerProfileId: "human-root",
  creatorProfileIdByProfileId: {
    "human-root": null,
    "agent-1": "human-root",
    "agent-sibling": "human-root",
  },
} as const;
const SIBLING_VIEWER = {
  viewerOwnerUserId: "owner-1",
  viewerProfileId: "agent-sibling",
  creatorProfileIdByProfileId: OWNER_VIEWER.creatorProfileIdByProfileId,
} as const;

describe("wake trace waterfall projection", () => {
  it("projects a source signal without dispatch evidence as a missing planner output", () => {
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map(),
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]?.targetLabel).toBe("@Ada");
    expect(response.items[0]?.summary).toEqual({
      status: "missing",
      terminalStep: "planner",
      reasonCode: "wake_trace.planner_output_not_found",
    });
    expect(response.items[0]?.correlation.selector).toEqual({
      kind: "client_message",
      spaceId: "space-1",
      clientMessageId: CLIENT_MESSAGE_ID,
      targetProfileId: "agent-1",
    });
    expect(response.items[0]?.executionContext).toEqual({
      resolutionStatus: "not_started",
      factSource: "none",
      reasonCode: "wake_execution_context.dispatch_not_found",
      bindingId: null,
      openMeldServiceRuntimeId: null,
      agentControllerRef: null,
      agentControllerConversationId: null,
      agentControllerConversationKind: null,
      runtimeWorkspacePath: null,
      runtimeWorkspaceFingerprint: null,
    });
    expect(response.items[0]?.steps.map((step) => step.name)).toEqual([
      "source_signal",
      "planner",
      "dispatch",
      "head_lifecycle",
      "attempt",
      "result_inbox",
      "result",
      "reply_signal",
    ]);
    expect(response.items[0]?.steps[0]).toMatchObject({
      name: "source_signal",
      status: "found",
      factSource: "space_signal_by_client_message_id",
      observedAt: ISO,
      ids: {
        clientMessageId: CLIENT_MESSAGE_ID,
        sourceSignalId: "sig-source-1",
        targetProfileId: "agent-1",
      },
    });
    expect(response.items[0]?.steps[1]).toMatchObject({
      name: "planner",
      status: "missing",
      reasonCode: "wake_trace.planner_output_not_found",
    });
  });

  it("projects source-signal selected wake evidence without a client message id", () => {
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: null,
      sourceSignalId: "sig-source-1",
      lookup: emptyLookup({
        clientMessageId: null,
        sourceSignalId: "sig-source-1",
      }),
      lookupError: null,
      outboxRecords: [],
      sourceSignal: {
        factSource: "space_signal_by_source_signal_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map(),
    });

    expect(response.query).toEqual({
      spaceId: "space-1",
      clientMessageId: null,
      sourceSignalId: "sig-source-1",
      targetProfileId: null,
    });
    expect(response.items[0]?.correlation.selector).toEqual({
      kind: "source_signal",
      spaceId: "space-1",
      sourceSignalId: "sig-source-1",
      targetProfileId: "agent-1",
    });
    expect(response.items[0]?.correlation.clientMessageId).toBeNull();
    expect(response.items[0]?.steps[0]).toMatchObject({
      name: "source_signal",
      status: "found",
      factSource: "space_signal_by_source_signal_id",
      ids: {
        clientMessageId: null,
        sourceSignalId: "sig-source-1",
        targetProfileId: "agent-1",
      },
    });
  });

  it.each([
    "dispatching",
    "waiting_result",
  ] as const)("keeps Dispatch Ledger %s evidence historical when no execution authority exists", (latestAttemptStatus) => {
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: {
        ...emptyLookup(),
        matches: [
          {
            attemptCount: 1,
            dispatchId: "dispatch-1",
            latestAttemptErrorCode: null,
            latestAttemptErrorMessage: null,
            latestAttemptId: "attempt-1",
            latestAttemptStatus,
            sourceSignalId: "sig-source-1",
            status: "dispatching",
            targetProfileId: "agent-1",
          },
        ],
      },
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map(),
    });

    expect(response.items[0]?.summary).toEqual({
      reasonCode: null,
      status: "pending",
      terminalStep: null,
    });
  });

  it("projects a replied wake from dispatch, result, and reply facts", () => {
    const trace = buildRepliedTrace();
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: {
        query: {
          spaceId: "space-1",
          sourceSignalId: null,
          clientMessageId: CLIENT_MESSAGE_ID,
          targetProfileId: null,
        },
        matches: [
          {
            dispatchId: "dispatch-1",
            sourceSignalId: "sig-source-1",
            targetProfileId: "agent-1",
            status: "succeeded",
            attemptCount: 1,
            latestAttemptId: "attempt-1",
            latestAttemptStatus: "succeeded",
            latestAttemptErrorCode: null,
            latestAttemptErrorMessage: null,
          },
        ],
      },
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]?.summary).toEqual({
      status: "replied",
      terminalStep: "reply_signal",
      reasonCode: null,
    });
    expect(response.items[0]?.correlation).toMatchObject({
      clientMessageId: CLIENT_MESSAGE_ID,
      sourceSignalId: "sig-source-1",
      targetProfileId: "agent-1",
      dispatchId: "dispatch-1",
      latestAttemptId: "attempt-1",
      claimLeaseId: null,
      bindingId: "binding-1",
      openMeldServiceRuntimeId: "runtime-1",
      agentControllerRef: "builtin:codex",
      resultRef: "result-1",
      publishedSignalId: "sig-reply-1",
      replySignalId: "sig-reply-1",
    });
    expect(response.items[0]?.executionContext).toEqual({
      resolutionStatus: "resolved",
      factSource: "dispatch_trace_origin",
      reasonCode: null,
      bindingId: "binding-1",
      openMeldServiceRuntimeId: "runtime-1",
      agentControllerRef: "builtin:codex",
      agentControllerConversationId: "conv-1",
      agentControllerConversationKind: "thread",
      runtimeWorkspacePath: "/tmp/openmeld-workspace",
      runtimeWorkspaceFingerprint: "sha256:workspace-1",
    });
    expect(
      response.items[0]?.steps.map((step) => [
        step.name,
        step.status,
        step.factSource,
      ])
    ).toEqual([
      ["source_signal", "found", "space_signal_by_client_message_id"],
      ["planner", "found", "dispatch_outbox"],
      ["dispatch", "found", "dispatch_ledger"],
      ["head_lifecycle", "missing", null],
      ["attempt", "found", "dispatch_attempt"],
      ["result_inbox", "found", "dispatch_result_inbox"],
      ["result", "found", "dispatch_result"],
      ["reply_signal", "found", "space_signal_by_published_signal_id"],
    ]);
    expect(response.items[0]?.steps.map((step) => step.name)).not.toContain(
      "claim"
    );
  });

  it.each([
    true,
    false,
  ])("redacts Context ids with native origin present=%s", (hasNativeOrigin) => {
    const trace = buildRepliedTrace();
    trace.runtimeCoordinatorHeadLifecycle = {
      factSource: "runtime_coordinator_head_lifecycle",
      readStatus: "missing",
      reasonCode: "runtime_coordinator.head_lifecycle_not_found",
      targetWakeLifecycleId: "wake-1",
      executionContext: {
        readStatus: "found",
        contextId: "11111111-1111-4111-8111-111111111111",
        access: "space_context",
        workspace: "isolated",
        permissionSource: "context_restriction",
      },
    };
    if (!hasNativeOrigin) {
      trace.origin = null;
      trace.executionIdentity = null;
      trace.runtimeCoordinatorExecution = null;
    }
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: SIBLING_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: {
        query: {
          spaceId: "space-1",
          sourceSignalId: null,
          clientMessageId: CLIENT_MESSAGE_ID,
          targetProfileId: null,
        },
        matches: [
          {
            dispatchId: "dispatch-1",
            sourceSignalId: "sig-source-1",
            targetProfileId: "agent-1",
            status: "succeeded",
            attemptCount: 1,
            latestAttemptId: "attempt-1",
            latestAttemptStatus: "succeeded",
            latestAttemptErrorCode: null,
            latestAttemptErrorMessage: null,
          },
        ],
      },
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.correlation).toMatchObject({
      bindingId: null,
      openMeldServiceRuntimeId: null,
      agentControllerRef: hasNativeOrigin ? "builtin:codex" : null,
    });
    expect(response.items[0]?.executionContext).toEqual({
      taskContext: {
        assignment: {
          readStatus: "found",
          contextId: null,
          access: "space_context",
          workspace: "isolated",
          permissionSource: "context_restriction",
        },
        conversationResume:
          trace.dispatchExecution?.agentControllerConversationResume ?? null,
      },
      resolutionStatus: "redacted",
      factSource: hasNativeOrigin ? "dispatch_trace_origin" : "dispatch_record",
      reasonCode: "wake_execution_context.local_origin_facts_redacted",
      bindingId: null,
      openMeldServiceRuntimeId: null,
      agentControllerRef: hasNativeOrigin ? "builtin:codex" : null,
      agentControllerConversationId: null,
      agentControllerConversationKind: null,
      runtimeWorkspacePath: null,
      runtimeWorkspaceFingerprint: null,
    });
  });

  it("projects a verified final reply claim as reply signal evidence", () => {
    const trace = buildRepliedTrace();
    if (!trace.finalVisibleMessage) {
      throw new Error("replied trace test fixture must include final message");
    }
    trace.replySignal = null;
    trace.finalVisibleMessage = {
      ...trace.finalVisibleMessage,
      factSource: "space_final_reply_claim",
      signalId: "sig-claim-final",
    };

    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: {
        query: {
          spaceId: "space-1",
          sourceSignalId: null,
          clientMessageId: CLIENT_MESSAGE_ID,
          targetProfileId: null,
        },
        matches: [
          {
            dispatchId: "dispatch-1",
            sourceSignalId: "sig-source-1",
            targetProfileId: "agent-1",
            status: "succeeded",
            attemptCount: 1,
            latestAttemptId: "attempt-1",
            latestAttemptStatus: "succeeded",
            latestAttemptErrorCode: null,
            latestAttemptErrorMessage: null,
          },
        ],
      },
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(
      response.items[0]?.steps.find((step) => step.name === "reply_signal")
    ).toMatchObject({
      name: "reply_signal",
      status: "found",
      factSource: "space_final_reply_claim",
      ids: {
        publishedSignalId: "sig-claim-final",
        replySignalId: "sig-claim-final",
      },
    });
  });

  it("uses RuntimeCoordinator identity and omits legacy claim from the waterfall", () => {
    const trace = {
      ...buildRepliedTrace(),
      executionIdentity: null,
      runtimeCoordinatorExecution: {
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        spaceId: "space-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        sourceClientMessageId: CLIENT_MESSAGE_ID,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-rc-1",
        },
        bindingId: "binding-rc-1",
        agentControllerRef: "builtin:codex",
        status: "reply_published",
        terminalOutcome: {
          kind: "reply_published",
          reasonCode: null,
          observedAtMs: Date.parse(ISO),
        },
        createdAtMs: Date.parse(ISO),
        updatedAtMs: Date.parse(ISO),
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 1,
        },
        factSource: "runtime_coordinator_projection",
      },
      runtimeCoordinatorHeadLifecycle: buildHeadLifecycleTrace({
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
        status: "execution_linked",
      }),
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.correlation).toMatchObject({
      runtimeCoordinatorExecutionId: "rce-dispatch-1",
      bindingId: "binding-rc-1",
      openMeldServiceRuntimeId: "runtime-rc-1",
      agentControllerRef: "builtin:codex",
      claimLeaseId: null,
    });
    expect(response.items[0]?.steps[3]).toMatchObject({
      name: "head_lifecycle",
      status: "found",
      reasonCode: "runtime_coordinator.head_execution_linked",
      ids: {
        targetWakeLifecycleId: "twl_v1|7:space-1|12:sig-source-1|7:agent-1",
      },
    });
    expect(response.items[0]?.steps.map((step) => step.name)).not.toContain(
      "claim"
    );
  });

  it("omits claim from token-backed published results", () => {
    const baseTrace = buildRepliedTrace();
    if (!baseTrace.result) {
      throw new Error("replied trace test fixture must include result");
    }
    const trace = {
      ...baseTrace,
      claimLease: null,
      executionIdentity: null,
      result: {
        ...baseTrace.result,
        publicOutcome: "post_message",
        resultKind: "space_action",
      },
      runtimeCoordinatorExecution: {
        runtimeCoordinatorExecutionId: "rce-dispatch-2",
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        spaceId: "space-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        sourceClientMessageId: CLIENT_MESSAGE_ID,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-rc-1",
        },
        bindingId: "binding-rc-1",
        agentControllerRef: "builtin:codex",
        status: "reply_published",
        terminalOutcome: {
          kind: "reply_published",
          reasonCode: null,
          observedAtMs: Date.parse(ISO),
        },
        createdAtMs: Date.parse(ISO),
        updatedAtMs: Date.parse(ISO),
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 1,
        },
        factSource: "runtime_coordinator_projection",
      },
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toMatchObject({
      status: "replied",
      terminalStep: "reply_signal",
    });
    expect(response.items[0]?.correlation).toMatchObject({
      runtimeCoordinatorExecutionId: "rce-dispatch-2",
      claimLeaseId: null,
      resultRef: "result-1",
      publishedSignalId: "sig-reply-1",
    });
    expect(response.items[0]?.steps.map((step) => step.name)).not.toContain(
      "claim"
    );
  });

  it("keeps adapter access failure as the summary reason when a terminal failure notice is visible", () => {
    const baseTrace = buildRepliedTrace();
    if (!(baseTrace.latestAttempt && baseTrace.result)) {
      throw new Error("replied trace test fixture must include attempt/result");
    }
    const trace = {
      ...baseTrace,
      latestAttempt: {
        ...baseTrace.latestAttempt,
        status: "failed_terminal",
        errorCode: "auth.required",
        errorMessage:
          "Your organization has disabled Claude subscription access for Claude Code",
      },
      result: {
        ...baseTrace.result,
        publicOutcome: "system_notice",
        publishedSignalId: "sig-terminal-failure-1",
      },
      resultInbox: baseTrace.resultInbox
        ? {
            ...baseTrace.resultInbox,
            publishedSignalId: "sig-terminal-failure-1",
          }
        : null,
      replySignal: null,
      finalVisibleMessage: {
        factSource: "space_signal_by_published_signal_id",
        signalId: "sig-terminal-failure-1",
        signalType: "signal.system_notice",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        profileId: "openmeld-system",
        profileKind: "system",
        profileName: "OpenMeld",
        text: "Claude Code subscription access is unavailable for this account.",
        reasonCode: "auth.required",
        noticeType: "terminal_failure",
        statusType: null,
        createdAt: ISO,
      },
      origin: {
        agentControllerConversationId: "conv-auth-required-1",
        agentControllerRef: "builtin:claude-code",
        agentControllerConversationKind: "session",
        resolvedAgentControllerConversationId: "conv-auth-required-1",
        effectiveRuntimeWorkingDirectory: "/tmp/claude-workspace",
        runtimeWorkspaceFingerprint: "sha256:claude-workspace",
      },
      runtimeCoordinatorExecution: {
        runtimeCoordinatorExecutionId: "rce-dispatch-auth-required-1",
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        spaceId: "space-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        sourceClientMessageId: CLIENT_MESSAGE_ID,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-rc-1",
        },
        bindingId: "binding-rc-1",
        agentControllerRef: "builtin:claude-code",
        status: "reply_published",
        terminalOutcome: {
          kind: "reply_published",
          reasonCode: null,
          observedAtMs: Date.parse(ISO),
        },
        createdAtMs: Date.parse(ISO),
        updatedAtMs: Date.parse(ISO),
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 1,
        },
        factSource: "runtime_coordinator_projection",
      },
    } satisfies SpaceDispatchTraceSnapshot;

    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "failed",
      terminalStep: "reply_signal",
      reasonCode: "auth.required",
    });
    expect(response.items[0]?.executionContext).toEqual({
      resolutionStatus: "resolved",
      factSource: "dispatch_trace_origin",
      reasonCode: null,
      bindingId: "binding-rc-1",
      openMeldServiceRuntimeId: "runtime-rc-1",
      agentControllerRef: "builtin:claude-code",
      agentControllerConversationId: "conv-auth-required-1",
      agentControllerConversationKind: "session",
      runtimeWorkspacePath: "/tmp/claude-workspace",
      runtimeWorkspaceFingerprint: "sha256:claude-workspace",
    });
    expect(
      response.items[0]?.steps.find((step) => step.name === "reply_signal")
    ).toMatchObject({
      name: "reply_signal",
      status: "found",
      reasonCode: "final_visible_message.terminal_failure_notice",
      ids: {
        publishedSignalId: "sig-terminal-failure-1",
        replySignalId: null,
      },
    });
    expect(response.items[0]?.summary.reasonCode).not.toBe(
      "reply_signal.not_found"
    );
  });

  it("keeps RuntimeCoordinator running as the trace summary when legacy transport evidence is terminal", () => {
    const baseTrace = buildRepliedTrace();
    if (!baseTrace.latestAttempt) {
      throw new Error("replied trace test fixture must include latestAttempt");
    }
    const trace = {
      ...baseTrace,
      dispatch: {
        ...baseTrace.dispatch,
        status: "failed_terminal",
      },
      latestAttempt: {
        ...baseTrace.latestAttempt,
        status: "failed_terminal",
        errorCode: "daemon.profile.offline",
      },
      claimLease: null,
      executionIdentity: null,
      result: null,
      resultInbox: null,
      replySignal: null,
      finalVisibleMessage: null,
      runtimeCoordinatorExecution: {
        runtimeCoordinatorExecutionId: "rce-dispatch-running-1",
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        spaceId: "space-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        sourceClientMessageId: CLIENT_MESSAGE_ID,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-rc-1",
        },
        bindingId: "binding-rc-1",
        agentControllerRef: "builtin:codex",
        status: "running",
        terminalOutcome: null,
        createdAtMs: Date.parse(ISO),
        updatedAtMs: Date.parse(ISO),
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 1,
        },
        factSource: "runtime_coordinator_projection",
      },
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "running",
      terminalStep: null,
      reasonCode: "runtime_coordinator.running",
    });
    expect(response.items[0]?.steps[2]).toMatchObject({
      name: "dispatch",
      status: "found",
      reasonCode: "dispatch.legacy_transport_terminal_diagnostic_only",
    });
    expect(response.items[0]?.steps[4]).toMatchObject({
      name: "attempt",
      status: "found",
      reasonCode: "attempt.legacy_transport_terminal_diagnostic_only",
    });
  });

  it.each([
    [
      "local_execution_lane_concurrency",
      "runtime.local_queue.waiting_local_execution_lane",
    ],
    ["workspace_conflict", "runtime.local_queue.waiting_workspace_conflict"],
    [
      "agent_profile_concurrency",
      "runtime.local_queue.waiting_agent_profile_concurrency",
    ],
    [
      "agent_controller_maintenance",
      "runtime.local_queue.waiting_controller_maintenance",
    ],
  ])("projects accepted local queue diagnostics (%s) while the runtime has not started", (waitReason, reasonCode) => {
    const baseTrace = buildRepliedTrace();
    const trace = {
      ...baseTrace,
      dispatch: {
        ...baseTrace.dispatch,
        status: "dispatching",
      },
      latestAttempt: baseTrace.latestAttempt
        ? {
            ...baseTrace.latestAttempt,
            status: "dispatching",
            finishedAt: null,
          }
        : null,
      claimLease: null,
      executionIdentity: null,
      result: null,
      resultInbox: null,
      replySignal: null,
      finalVisibleMessage: null,
      runtimeCoordinatorExecution: {
        runtimeCoordinatorExecutionId: "rce-dispatch-local-queue",
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        spaceId: "space-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        sourceClientMessageId: CLIENT_MESSAGE_ID,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-rc-1",
        },
        bindingId: "binding-rc-1",
        agentControllerRef: "builtin:codex",
        status: "accepted_local",
        terminalOutcome: null,
        createdAtMs: Date.parse(ISO),
        updatedAtMs: Date.parse(ISO),
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 1,
        },
        factSource: "runtime_coordinator_projection",
      },
      runtimeCoordinatorEvents: [
        {
          eventId: "event-local-queue",
          eventType: "lifecycle_accepted_local",
          factSource: "runtime_coordinator_projection",
          idempotencyKey: "lifecycle:dispatch-1:attempt-1:accepted_local",
          observedAtMs: Date.parse(ISO),
          payloadJson: JSON.stringify({
            lifecycleAtMs: Date.parse(ISO),
            localQueue: {
              status: "queued",
              waitReason,
            },
            phase: "accepted_local",
          }),
          reasonCode: null,
          runtimeCoordinatorExecutionId: "rce-dispatch-local-queue",
          statusAfter: "accepted_local",
        },
      ],
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "running",
      terminalStep: null,
      reasonCode,
    });
    expect(isRuntimeCoordinatorExecutionLocallyQueued(trace)).toBe(true);
    // The frame sent when the Service starts the Wake ends the local wait.
    const [queuedEvent] = trace.runtimeCoordinatorEvents;
    if (!queuedEvent) {
      throw new Error("Expected the queued lifecycle event");
    }
    expect(
      isRuntimeCoordinatorExecutionLocallyQueued({
        ...trace,
        runtimeCoordinatorEvents: [
          queuedEvent,
          {
            ...queuedEvent,
            eventId: "event-local-start",
            payloadJson: JSON.stringify({
              localQueue: null,
              phase: "accepted_local",
            }),
          },
        ],
      })
    ).toBe(false);
  });

  it("projects an occupied Agent Controller conversation as nonterminal running work", () => {
    const baseTrace = buildRepliedTrace();
    const trace = {
      ...baseTrace,
      dispatch: {
        ...baseTrace.dispatch,
        status: "dispatching",
      },
      latestAttempt: baseTrace.latestAttempt
        ? {
            ...baseTrace.latestAttempt,
            status: "waiting_result",
            finishedAt: null,
          }
        : null,
      result: null,
      resultInbox: null,
      replySignal: null,
      finalVisibleMessage: null,
      runtimeCoordinatorExecution: {
        runtimeCoordinatorExecutionId: "rce-dispatch-conversation-occupied",
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        spaceId: "space-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        sourceClientMessageId: CLIENT_MESSAGE_ID,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-rc-1",
        },
        bindingId: "binding-rc-1",
        agentControllerRef: "builtin:codex",
        status: "running",
        terminalOutcome: null,
        createdAtMs: Date.parse(ISO),
        updatedAtMs: Date.parse(ISO),
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 1,
        },
        factSource: "runtime_coordinator_projection",
      },
      runtimeCoordinatorEvents: [
        {
          eventId: "event-conversation-occupied",
          eventType: "lifecycle_running",
          factSource: "runtime_coordinator_projection",
          idempotencyKey: "lifecycle:dispatch-1:attempt-1:running:occupied",
          observedAtMs: Date.parse(ISO),
          payloadJson: JSON.stringify({
            agentControllerConversationOccupancy: {
              agentControllerConversationId: "thread-1",
              contractVersion: 1,
              state: "occupied",
            },
            lifecycleAtMs: Date.parse(ISO),
            phase: "running",
          }),
          reasonCode: null,
          runtimeCoordinatorExecutionId: "rce-dispatch-conversation-occupied",
          statusAfter: "running",
        },
      ],
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "running",
      terminalStep: null,
      reasonCode: "runtime.agent_controller_conversation.occupied",
    });
  });

  it("does not show RuntimeCoordinator retryable failure as normal running work", () => {
    const baseTrace = buildRetryableTrace();
    const trace = {
      ...baseTrace,
      runtimeCoordinatorExecution: {
        runtimeCoordinatorExecutionId: "rce-dispatch-retryable-1",
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        spaceId: "space-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        sourceClientMessageId: CLIENT_MESSAGE_ID,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-rc-1",
        },
        bindingId: "binding-rc-1",
        agentControllerRef: "builtin:codex",
        status: "failed_retryable",
        terminalOutcome: {
          kind: "failed_retryable",
          reasonCode: "runtime_coordinator.handoff_pending_or_unavailable",
          observedAtMs: Date.parse(ISO),
        },
        createdAtMs: Date.parse(ISO),
        updatedAtMs: Date.parse(ISO),
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 1,
        },
        factSource: "runtime_coordinator_projection",
      },
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "pending",
      terminalStep: null,
      reasonCode: "runtime_coordinator.handoff_pending_or_unavailable",
    });
  });

  it("does not infer execution failure from legacy transport facts when RuntimeCoordinator authority was not created", () => {
    const baseTrace = buildRepliedTrace();
    if (!baseTrace.latestAttempt) {
      throw new Error("replied trace test fixture must include latestAttempt");
    }
    const trace = {
      ...baseTrace,
      dispatch: {
        ...baseTrace.dispatch,
        status: "failed_terminal",
      },
      latestAttempt: {
        ...baseTrace.latestAttempt,
        status: "failed_terminal",
        errorCode: "queue.dlq.exhausted",
      },
      result: null,
      resultInbox: null,
      replySignal: null,
      finalVisibleMessage: null,
      runtimeCoordinatorCreationDiagnostics: [
        {
          modelVersion: RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
          factSource: "runtime_coordinator_projection",
          spaceId: "space-1",
          dispatchId: "dispatch-1",
          targetProfileId: "agent-1",
          sourceClientMessageId: CLIENT_MESSAGE_ID,
          creationStatus: "not_created",
          reasonCode: "runtime_coordinator.authority_unavailable",
          observedAtMs: Date.parse(ISO),
          legacyAttemptId: "attempt-1",
        },
      ],
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "pending",
      terminalStep: null,
      reasonCode: "runtime_coordinator.authority_unavailable",
    });
    expect(response.items[0]?.steps[2]).toMatchObject({
      name: "dispatch",
      status: "found",
      reasonCode: "dispatch.legacy_transport_terminal_diagnostic_only",
    });
    expect(response.items[0]?.steps[4]).toMatchObject({
      name: "attempt",
      status: "found",
      reasonCode: "attempt.legacy_transport_terminal_diagnostic_only",
    });
    expect(
      response.items[0]?.steps.find((step) => step.name === "result_inbox")
    ).toMatchObject({
      name: "result_inbox",
      status: "pending",
      reasonCode: "result_inbox.not_observed_yet",
    });
  });

  it("shows RuntimeCoordinator head no-execution publication intent without claiming Space failure publication", () => {
    const baseTrace = buildRepliedTrace();
    if (!baseTrace.latestAttempt) {
      throw new Error("replied trace test fixture must include latestAttempt");
    }
    const trace = {
      ...baseTrace,
      dispatch: {
        ...baseTrace.dispatch,
        status: "failed_terminal",
      },
      latestAttempt: {
        ...baseTrace.latestAttempt,
        status: "failed_terminal",
        errorCode: "agent_profile_binding.missing",
      },
      claimLease: null,
      executionIdentity: null,
      result: null,
      resultInbox: null,
      replySignal: null,
      finalVisibleMessage: null,
      runtimeCoordinatorCreationDiagnostics: [
        {
          modelVersion: RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
          factSource: "runtime_coordinator_projection",
          spaceId: "space-1",
          dispatchId: "dispatch-1",
          targetProfileId: "agent-1",
          sourceClientMessageId: CLIENT_MESSAGE_ID,
          creationStatus: "not_created",
          reasonCode: "runtime_coordinator.authority_unavailable",
          observedAtMs: Date.parse(ISO),
          legacyAttemptId: "attempt-1",
        },
      ],
      runtimeCoordinatorHeadLifecycle: buildHeadLifecycleTrace({
        noExecutionReason: "agent_profile_binding.missing",
        status: "publication_intent_ready",
      }),
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "pending",
      terminalStep: null,
      reasonCode: "final_visible_outcome.publication_pending",
    });
    expect(response.items[0]?.steps[2]).toMatchObject({
      name: "dispatch",
      status: "found",
      reasonCode: "dispatch.legacy_transport_terminal_diagnostic_only",
    });
    expect(response.items[0]?.steps[3]).toMatchObject({
      name: "head_lifecycle",
      status: "found",
      factSource: "runtime_coordinator_head_lifecycle",
      reasonCode: "runtime_coordinator.head_publication_intent_ready",
      ids: {
        targetWakeLifecycleId: "twl_v1|7:space-1|12:sig-source-1|7:agent-1",
      },
    });
    expect(
      response.items[0]?.steps.find((step) => step.name === "reply_signal")
    ).toMatchObject({
      name: "reply_signal",
      status: "pending",
      factSource: "runtime_coordinator_head_lifecycle",
      reasonCode: "final_visible_outcome.publication_pending",
    });
  });

  it("shows RuntimeCoordinator head authority as unavailable instead of rebuilding truth from D1", () => {
    const trace = {
      ...buildRetryableTrace(),
      runtimeCoordinatorHeadLifecycle: {
        factSource: "runtime_coordinator_head_lifecycle",
        readStatus: "authority_unavailable",
        reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
        targetWakeLifecycleId: "twl_v1|7:space-1|12:sig-source-1|7:agent-1",
      },
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "pending",
      terminalStep: null,
      reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
    });
    expect(response.items[0]?.steps[3]).toMatchObject({
      name: "head_lifecycle",
      status: "degraded",
      reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
    });
  });

  it("keeps legacy retryable Queue and D1 evidence below an accepted RuntimeCoordinator head", () => {
    const trace = {
      ...buildRetryableTrace(),
      runtimeCoordinatorCreationDiagnostics: [
        {
          modelVersion: RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
          factSource: "runtime_coordinator_projection",
          spaceId: "space-1",
          dispatchId: "dispatch-1",
          targetProfileId: "agent-1",
          sourceClientMessageId: CLIENT_MESSAGE_ID,
          creationStatus: "not_created",
          reasonCode: "queue.dlq.exhausted",
          observedAtMs: Date.parse(ISO),
          legacyAttemptId: "attempt-1",
        },
      ],
      runtimeCoordinatorHeadLifecycle: buildHeadLifecycleTrace({
        status: "accepted",
      }),
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "pending",
      terminalStep: null,
      reasonCode: "runtime_coordinator.head_accepted",
    });
    expect(response.items[0]?.steps[3]).toMatchObject({
      name: "head_lifecycle",
      status: "found",
      reasonCode: "runtime_coordinator.head_accepted",
    });
    expect(response.items[0]?.steps[4]).toMatchObject({
      name: "attempt",
      status: "pending",
      reasonCode: "route.temporarily_unavailable",
    });
  });

  it("keeps local service identity mismatch diagnostic evidence below an accepted head in the waterfall summary", () => {
    const retryableTrace = buildRetryableTrace();
    const latestAttempt = retryableTrace.latestAttempt;
    if (!latestAttempt) {
      throw new Error(
        "retryable trace test fixture must include latestAttempt"
      );
    }
    const trace = {
      ...retryableTrace,
      latestAttempt: {
        ...latestAttempt,
        errorCode: "local_service.identity_mismatch",
        errorMessage:
          "daemon route does not match the target profile Core primary binding runtime identity",
      },
      runtimeCoordinatorCreationDiagnostics: [
        {
          modelVersion: RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
          factSource: "runtime_coordinator_projection",
          spaceId: "space-1",
          dispatchId: "dispatch-1",
          targetProfileId: "agent-1",
          sourceClientMessageId: CLIENT_MESSAGE_ID,
          creationStatus: "not_created",
          reasonCode: "local_service.identity_mismatch",
          observedAtMs: Date.parse(ISO),
          legacyAttemptId: "attempt-1",
        },
      ],
      runtimeCoordinatorHeadLifecycle: buildHeadLifecycleTrace({
        status: "accepted",
      }),
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "pending",
      terminalStep: null,
      reasonCode: "runtime_coordinator.head_accepted",
    });
    expect(response.items[0]?.steps[4]).toMatchObject({
      name: "attempt",
      status: "pending",
      reasonCode: "local_service.identity_mismatch",
    });
  });

  it("does not let stale result inbox publication failure override a running RuntimeCoordinator execution", () => {
    const baseTrace = buildRepliedTrace();
    if (!baseTrace.resultInbox) {
      throw new Error("replied trace test fixture must include result inbox");
    }
    const trace = {
      ...baseTrace,
      claimLease: null,
      executionIdentity: null,
      result: null,
      resultInbox: {
        ...baseTrace.resultInbox,
        publishState: "reply_publication_failed",
        publicationErrorCode: "space.signal.persist_failed",
        publishedSignalId: null,
      },
      replySignal: null,
      finalVisibleMessage: null,
      runtimeCoordinatorExecution: {
        runtimeCoordinatorExecutionId: "rce-dispatch-running-with-old-result",
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        spaceId: "space-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        sourceClientMessageId: CLIENT_MESSAGE_ID,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-rc-1",
        },
        bindingId: "binding-rc-1",
        agentControllerRef: "builtin:codex",
        status: "running",
        terminalOutcome: null,
        createdAtMs: Date.parse(ISO),
        updatedAtMs: Date.parse(ISO),
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 1,
        },
        factSource: "runtime_coordinator_projection",
      },
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "running",
      terminalStep: null,
      reasonCode: "runtime_coordinator.running",
    });
    expect(
      response.items[0]?.steps.find((step) => step.name === "result_inbox")
    ).toMatchObject({
      name: "result_inbox",
      status: "found",
      reasonCode: "result_inbox.legacy_terminal_diagnostic_only",
    });
    expect(
      response.items[0]?.steps.find((step) => step.name === "reply_signal")
    ).toMatchObject({
      name: "reply_signal",
      status: "pending",
      reasonCode: "result_inbox.waiting_for_runtime_result",
    });
  });

  it("shows a terminal-late completed result as recoverable evidence instead of a missing result", () => {
    const baseTrace = buildRepliedTrace();
    if (!(baseTrace.latestAttempt && baseTrace.resultInbox)) {
      throw new Error("replied trace test fixture must include attempt/inbox");
    }
    const trace = {
      ...baseTrace,
      dispatch: {
        ...baseTrace.dispatch,
        status: "failed_terminal",
      },
      latestAttempt: {
        ...baseTrace.latestAttempt,
        status: "failed_terminal",
        errorCode: "runtime.progress_stale",
      },
      result: null,
      resultInbox: {
        ...baseTrace.resultInbox,
        publishState: "late_result_available",
        publishedSignalId: "sig-late-result-available",
      },
      replySignal: null,
      finalVisibleMessage: {
        factSource: "space_signal_by_published_signal_id",
        signalId: "sig-late-result-available",
        signalType: "signal.system_notice",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        profileId: "openmeld-system",
        profileKind: "system",
        profileName: "OpenMeld",
        text: "Ada completed this Wake after the connection was lost.",
        reasonCode: "runtime_coordinator.late_result_available",
        noticeType: "terminal_failure",
        statusType: null,
        createdAt: ISO,
      },
      runtimeCoordinatorExecution: {
        runtimeCoordinatorExecutionId: "rce-dispatch-late-result",
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        spaceId: "space-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        sourceClientMessageId: CLIENT_MESSAGE_ID,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-rc-1",
        },
        bindingId: "binding-rc-1",
        agentControllerRef: "builtin:codex",
        status: "failed_terminal",
        terminalOutcome: {
          kind: "timed_out",
          reasonCode: "runtime.progress_stale",
          observedAtMs: Date.parse(ISO),
        },
        createdAtMs: Date.parse(ISO),
        updatedAtMs: Date.parse(ISO),
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 1,
        },
        factSource: "runtime_coordinator_projection",
      },
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(
      response.items[0]?.steps.find((step) => step.name === "result_inbox")
    ).toMatchObject({
      status: "found",
      reasonCode: "result_inbox.late_result_available",
    });
    expect(
      response.items[0]?.steps.find((step) => step.name === "result")
    ).toMatchObject({
      status: "found",
      factSource: "dispatch_result_inbox",
      reasonCode: "result_inbox.late_result_available",
    });
    expect(
      response.items[0]?.steps.find((step) => step.name === "reply_signal")
    ).toMatchObject({
      status: "found",
      reasonCode: "reply_signal.late_result_recovery_notice",
    });
  });

  it("keeps a visible final reply as the summary when late publication failure evidence exists", () => {
    const baseTrace = buildRepliedTrace();
    if (!baseTrace.resultInbox) {
      throw new Error("replied trace test fixture must include result inbox");
    }
    const trace = {
      ...baseTrace,
      resultInbox: {
        ...baseTrace.resultInbox,
        publishState: "reply_publication_failed",
        publicationErrorCode: "space.signal.persist_failed",
        publishedSignalId: null,
      },
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "replied",
      terminalStep: "reply_signal",
      reasonCode: null,
    });
  });

  it("shows reply publication failure as final visible outcome retrying when no final message exists", () => {
    const baseTrace = buildRepliedTrace();
    if (!baseTrace.resultInbox) {
      throw new Error("replied trace test fixture must include result inbox");
    }
    const trace = {
      ...baseTrace,
      resultInbox: {
        ...baseTrace.resultInbox,
        publishState: "reply_publication_failed",
        publicationErrorCode: "space.signal.persist_failed",
        publishedSignalId: null,
      },
      replySignal: null,
      finalVisibleMessage: null,
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "pending",
      terminalStep: null,
      reasonCode: "final_visible_outcome.publication_retrying",
    });
    expect(
      response.items[0]?.steps.find((step) => step.name === "reply_signal")
    ).toMatchObject({
      name: "reply_signal",
      status: "pending",
      factSource: "dispatch_result_inbox",
      reasonCode: "final_visible_outcome.publication_retrying",
    });
  });

  it("shows stale progress evidence instead of normal running for a running RuntimeCoordinator execution", () => {
    const baseTrace = buildRepliedTrace();
    const trace = {
      ...baseTrace,
      claimLease: null,
      executionIdentity: null,
      result: null,
      resultInbox: null,
      replySignal: null,
      finalVisibleMessage: null,
      execution: {
        phase: "running",
        phaseEnteredAt: ISO,
        lastLifecycleAt: ISO,
        progressEvidenceState: "stalled",
        timeoutPolicy: {
          startTimeoutMs: 30_000,
          waitWindowMs: 30_000,
          finalizationTimeoutMs: 30_000,
          taskProgressEvidenceStaleAfterMs: 90_000,
        },
      },
      runtimeCoordinatorExecution: {
        runtimeCoordinatorExecutionId: "rce-dispatch-stale-running",
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        spaceId: "space-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        sourceClientMessageId: CLIENT_MESSAGE_ID,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-rc-1",
        },
        bindingId: "binding-rc-1",
        agentControllerRef: "builtin:codex",
        status: "running",
        terminalOutcome: null,
        createdAtMs: Date.parse(ISO),
        updatedAtMs: Date.parse(ISO),
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 1,
        },
        factSource: "runtime_coordinator_projection",
      },
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "running",
      terminalStep: null,
      reasonCode: "runtime.progress_stale",
    });
  });

  it("uses RuntimeCoordinator progress-stale decision evidence when legacy progress evidence still looks active", () => {
    const baseTrace = buildRepliedTrace();
    const trace = {
      ...baseTrace,
      claimLease: null,
      executionIdentity: null,
      result: null,
      resultInbox: null,
      replySignal: null,
      finalVisibleMessage: null,
      execution: {
        phase: "running",
        phaseEnteredAt: ISO,
        lastLifecycleAt: ISO,
        progressEvidenceState: "active",
        timeoutPolicy: {
          startTimeoutMs: 30_000,
          waitWindowMs: 30_000,
          finalizationTimeoutMs: 30_000,
          taskProgressEvidenceStaleAfterMs: 90_000,
        },
      },
      runtimeCoordinatorExecution: {
        runtimeCoordinatorExecutionId: "rce-dispatch-rc-stale-policy",
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        spaceId: "space-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        sourceClientMessageId: CLIENT_MESSAGE_ID,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-rc-1",
        },
        bindingId: "binding-rc-1",
        agentControllerRef: "builtin:codex",
        status: "running",
        terminalOutcome: null,
        createdAtMs: Date.parse(ISO),
        updatedAtMs: Date.parse(ISO),
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 1,
        },
        factSource: "runtime_coordinator_projection",
      },
      runtimeCoordinatorEvents: [
        {
          eventId: "event-rc-progress-stale-policy",
          eventType: "runtime_coordinator_decision_recorded",
          factSource: "runtime_coordinator_projection",
          idempotencyKey: "decision:1",
          observedAtMs: Date.parse(ISO),
          payloadJson: JSON.stringify({
            action: "keep_waiting",
            eventKind: "timeout",
            reasonCode: "runtime_coordinator.progress_stale_policy_pending",
          }),
          reasonCode: "runtime_coordinator.progress_stale_policy_pending",
          runtimeCoordinatorExecutionId: "rce-dispatch-rc-stale-policy",
          statusAfter: "running",
        },
      ],
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "running",
      terminalStep: null,
      reasonCode: "runtime.progress_stale",
    });
  });

  it("shows a no-token legacy result as quarantined diagnostics instead of a reply", () => {
    const baseTrace = buildRepliedTrace();
    if (!baseTrace.resultInbox) {
      throw new Error("replied trace test fixture must include result inbox");
    }
    const trace = {
      ...baseTrace,
      result: null,
      resultInbox: {
        ...baseTrace.resultInbox,
        publishState: "legacy_result_quarantined",
        publishedSignalId: null,
        publicationErrorCode: "runtime_coordinator.execution_token_required",
      },
      replySignal: null,
      finalVisibleMessage: null,
    } satisfies SpaceDispatchTraceSnapshot;
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "failed",
      terminalStep: "result_inbox",
      reasonCode: "runtime_coordinator.execution_token_required",
    });
    expect(
      response.items[0]?.steps.find((step) => step.name === "result_inbox")
    ).toMatchObject({
      name: "result_inbox",
      status: "failed",
      factSource: "dispatch_result_inbox",
      reasonCode: "runtime_coordinator.execution_token_required",
    });
    expect(
      response.items[0]?.steps.find((step) => step.name === "result")
    ).toMatchObject({
      name: "result",
      status: "not_applicable",
      reasonCode: "result_inbox.legacy_result_quarantined",
    });
    expect(
      response.items[0]?.steps.find((step) => step.name === "reply_signal")
    ).toMatchObject({
      name: "reply_signal",
      status: "failed",
      reasonCode: "runtime_coordinator.execution_token_required",
    });
  });

  it("keeps retryable dispatch failures pending instead of terminal failed", () => {
    const trace = buildRetryableTrace();
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: {
        query: {
          spaceId: "space-1",
          sourceSignalId: null,
          clientMessageId: CLIENT_MESSAGE_ID,
          targetProfileId: "agent-1",
        },
        matches: [
          {
            dispatchId: "dispatch-1",
            sourceSignalId: "sig-source-1",
            targetProfileId: "agent-1",
            status: "failed_retryable",
            attemptCount: 1,
            latestAttemptId: "attempt-1",
            latestAttemptStatus: "failed_retryable",
            latestAttemptErrorCode: "route.temporarily_unavailable",
            latestAttemptErrorMessage: null,
          },
        ],
      },
      lookupError: null,
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map([
        [
          "dispatch-1",
          {
            correlation: null,
            query: { spaceId: "space-1", dispatchId: "dispatch-1" },
            trace,
          } as unknown as SpaceDispatchTraceResponse,
        ],
      ]),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "pending",
      terminalStep: null,
      reasonCode: null,
    });
    expect(response.items[0]?.steps[2]).toMatchObject({
      name: "dispatch",
      status: "pending",
      reasonCode: "dispatch.failed_retryable",
    });
    expect(response.items[0]?.steps[4]).toMatchObject({
      name: "attempt",
      status: "pending",
      reasonCode: "route.temporarily_unavailable",
    });
  });

  it("returns only the requested target profile when targetProfileId is specified", () => {
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: emptyLookup(),
      lookupError: null,
      outboxRecords: [],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1", "agent-2"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([
        ["agent-1", "Ada"],
        ["agent-2", "Grace"],
      ]),
      targetProfileId: "agent-1",
      tracesByDispatchId: new Map(),
    });

    expect(response.items.map((item) => item.targetProfileId)).toEqual([
      "agent-1",
    ]);
  });

  it("surfaces lookup failure even when outbox evidence exists", () => {
    const response = projectWakeTraceWaterfall({
      agentLocalOriginFactsViewer: OWNER_VIEWER,
      clientMessageId: CLIENT_MESSAGE_ID,
      lookup: null,
      lookupError: new Error("D1 unavailable"),
      outboxRecords: [outboxRecord()],
      sourceSignal: {
        factSource: "space_signal_by_client_message_id",
        signalId: "sig-source-1",
        observedAtMs: Date.parse(ISO),
        targetProfileIds: ["agent-1"],
      },
      spaceId: "space-1",
      targetLabelByProfileId: new Map([["agent-1", "Ada"]]),
      targetProfileId: null,
      tracesByDispatchId: new Map(),
    });

    expect(response.items[0]?.summary).toEqual({
      status: "failed",
      terminalStep: "dispatch",
      reasonCode: "dispatch.storage_unavailable",
    });
    expect(response.items[0]?.steps[1]).toMatchObject({
      name: "planner",
      status: "found",
      factSource: "dispatch_outbox",
    });
    expect(response.items[0]?.steps[2]).toMatchObject({
      name: "dispatch",
      status: "degraded",
      factSource: "lookup_error",
      reasonCode: "dispatch.storage_unavailable",
    });
  });
});

function emptyLookup(input?: {
  clientMessageId?: string | null;
  sourceSignalId?: string | null;
}): GetSpaceDispatchLookupResponse {
  return {
    query: {
      spaceId: "space-1",
      sourceSignalId: input?.sourceSignalId ?? null,
      clientMessageId:
        input && "clientMessageId" in input
          ? (input.clientMessageId ?? null)
          : CLIENT_MESSAGE_ID,
      targetProfileId: null,
    },
    matches: [],
  };
}

function outboxRecord(): OpenMeldDaemonDispatchOutboxRecoveryCandidate {
  return {
    dispatchId: "dispatch-1",
    sourceEventId: "sig-source-1",
    sourceClientMessageId: CLIENT_MESSAGE_ID,
    targetProfileId: "agent-1",
    targetProfileMentionLabel: "Ada",
    outboxStatus: "handed_off",
    createdAtMs: Date.parse(ISO),
    handedOffAtMs: Date.parse(ISO),
  } as unknown as OpenMeldDaemonDispatchOutboxRecoveryCandidate;
}

function buildHeadLifecycleTrace(input?: {
  noExecutionReason?: "agent_profile_binding.missing";
  runtimeCoordinatorExecutionId?: string | null;
  status?: "accepted" | "execution_linked" | "publication_intent_ready";
}): NonNullable<SpaceDispatchTraceSnapshot["runtimeCoordinatorHeadLifecycle"]> {
  const targetWakeLifecycleId = "twl_v1|7:space-1|12:sig-source-1|7:agent-1";
  const noExecutionReason = input?.noExecutionReason ?? null;
  return {
    createdAt: ISO,
    duplicateDispatchCount: 0,
    executionLinkedAt: input?.status === "execution_linked" ? ISO : null,
    factSource: "runtime_coordinator_head_lifecycle",
    modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
    noExecutionDecision: noExecutionReason
      ? {
          decidedAt: ISO,
          publicationCategory: "binding_required",
          reasonCode: noExecutionReason,
          source: "dispatch_preflight",
          userRecoveryAction: "set_up_agent_binding",
        }
      : null,
    ownerUserId: "owner-1",
    primaryDispatchId: "dispatch-1",
    publicationIntent: noExecutionReason
      ? {
          intentId: `rcpi:no_execution:${targetWakeLifecycleId}`,
          kind: "no_execution_failure",
          publicationCategory: "binding_required",
          readyAt: ISO,
          reasonCode: noExecutionReason,
          status: "ready_for_phase_6",
          userRecoveryAction: "set_up_agent_binding",
        }
      : null,
    readStatus: "found",
    runtimeCoordinatorExecutionId: input?.runtimeCoordinatorExecutionId ?? null,
    status: input?.status ?? "accepted",
    targetWakeLifecycleIdentity: {
      modelVersion: "openmeld.target_wake.lifecycle_identity.v1",
      targetWakeLifecycleId,
      spaceId: "space-1",
      sourceSignalId: "sig-source-1",
      clientMessageId: CLIENT_MESSAGE_ID,
      targetProfileId: "agent-1",
      dispatchId: "dispatch-1",
    },
    targetWakeLifecycleId,
    updatedAt: ISO,
    waitingBoundary: null,
  };
}

function buildRepliedTrace(): SpaceDispatchTraceSnapshot {
  return {
    dispatch: {
      factSource: "dispatch_ledger",
      dispatchId: "dispatch-1",
      idempotencyKey: "idempotency-1",
      sourceEventId: "sig-source-1",
      sourceClientMessageId: CLIENT_MESSAGE_ID,
      owner: { kind: "owner_account", id: "owner-1" },
      targetProfileId: "agent-1",
      status: "succeeded",
      firstSeenAt: ISO,
      lastAttemptAt: ISO,
      attemptCount: 1,
      latestAttemptId: "attempt-1",
    },
    runtimeCoordinatorExecution: null,
    runtimeCoordinatorCreationDiagnostics: [],
    runtimeCoordinatorEvents: [],
    runtimeCoordinatorHeadLifecycle: null,
    latestAttempt: {
      factSource: "dispatch_attempt",
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      idempotencyKey: "idempotency-1",
      attemptNo: 1,
      status: "succeeded",
      daemonSessionId: "daemon-session-1",
      connectionGeneration: 1,
      leaseEpoch: 1,
      createdAt: ISO,
      startedAt: ISO,
      finishedAt: ISO,
      errorCode: null,
      errorMessage: null,
    },
    executionIdentity: {
      factSource: "dispatch_attempt_execution_identity",
      authority: "authoritative",
      core: {
        modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
        spaceId: "space-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agent-1",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
      },
    },
    claimLease: null,
    result: {
      factSource: "dispatch_result",
      resultRef: "result-1",
      dispatchId: "dispatch-1",
      resultKind: "space_action",
      publicOutcome: "reply_published",
      publishedSignalId: "sig-reply-1",
      statusType: null,
      createdAt: ISO,
    },
    resultInbox: {
      factSource: "dispatch_result_inbox",
      resultKey: "result-key-1",
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      taskId: "task-1",
      targetProfileId: "agent-1",
      daemonSessionId: "daemon-session-1",
      leaseEpoch: 1,
      submittedConnectionGeneration: 1,
      publishState: "reply_published",
      publishedSignalId: "sig-reply-1",
      publicationErrorCode: null,
      acceptedAt: ISO,
      updatedAt: ISO,
    },
    recentOpsDecisions: [],
    replySignal: {
      factSource: "space_signal_by_published_signal_id",
      signalId: "sig-reply-1",
      profileId: "agent-1",
      profileKind: "agent",
      profileName: "Ada",
      text: "Done.",
      createdAt: ISO,
    },
    finalVisibleMessage: {
      factSource: "space_signal_by_published_signal_id",
      signalId: "sig-reply-1",
      signalType: "signal.text",
      dispatchId: "dispatch-1",
      targetProfileId: "agent-1",
      profileId: "agent-1",
      profileKind: "agent",
      profileName: "Ada",
      text: "Done.",
      reasonCode: null,
      noticeType: null,
      statusType: null,
      createdAt: ISO,
    },
    streaming: null,
    runtime: null,
    execution: null,
    origin: {
      agentControllerConversationId: "conv-1",
      agentControllerRef: "builtin:codex",
      agentControllerConversationKind: "thread",
      resolvedAgentControllerConversationId: "conv-1",
      effectiveRuntimeWorkingDirectory: "/tmp/openmeld-workspace",
      runtimeWorkspaceFingerprint: "sha256:workspace-1",
    },
    prompt: null,
    dispatchExecution: null,
    openClawGatewayVisibility: null,
    openClawBinding: null,
    structuredActionFailure: null,
  };
}

function buildRetryableTrace(): SpaceDispatchTraceSnapshot {
  const base = buildRepliedTrace();
  const latestAttempt = base.latestAttempt;
  if (!latestAttempt) {
    throw new Error("replied trace test fixture must include latestAttempt");
  }
  return {
    ...base,
    dispatch: {
      ...base.dispatch,
      status: "failed_retryable",
    },
    latestAttempt: {
      ...latestAttempt,
      status: "failed_retryable",
      errorCode: "route.temporarily_unavailable",
    },
    claimLease: null,
    result: null,
    resultInbox: null,
    replySignal: null,
    finalVisibleMessage: null,
  };
}
