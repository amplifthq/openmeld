import { describe, expect, it } from "vitest";
import {
  OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
  openMeldDaemonTaskResultEnvelopeSchema,
} from "../../src/index";

type FlattenedZodIssue = {
  code: string;
  path: readonly PropertyKey[];
};

type FlattenableZodIssue = {
  code: string;
  path: readonly PropertyKey[];
  errors?: readonly (readonly FlattenableZodIssue[])[];
};

function collectFlattenedIssueDetails(
  issues: readonly FlattenableZodIssue[],
  parentPath: readonly PropertyKey[] = []
): FlattenedZodIssue[] {
  const flattened: FlattenedZodIssue[] = [];

  for (const issue of issues) {
    const path = [...parentPath, ...issue.path];
    flattened.push({
      code: issue.code,
      path,
    });

    if (issue.code !== "invalid_union" || !issue.errors) {
      continue;
    }

    for (const unionBranch of issue.errors) {
      flattened.push(...collectFlattenedIssueDetails(unionBranch, path));
    }
  }

  return flattened;
}

describe("daemon task-result schema", () => {
  it("accepts success envelope with output", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-1",
        status: "success",
        taskId: "task-1",
        sourceEventId: "evt-1",
        agentId: "agent-1",
        deduped: false,
        output: "hello",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts success envelope with Codex App Server transport evidence", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-app-server-1",
        status: "success",
        taskId: "task-app-server-1",
        sourceEventId: "evt-app-server-1",
        agentId: "agent-app-server-1",
        deduped: false,
        output: "hello",
        transportMode: "codex-app-server",
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.v).toBe(OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION);
    if (result.data.v !== OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION) {
      return;
    }
    expect(result.data.payload.transportMode).toBe("codex-app-server");
  });

  it.each([
    "claude-code",
    "codex",
    "opencode",
    "openclaw",
  ] as const)("accepts failed envelope with %s provider account access evidence", (provider) => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        agentId: "agt_11111111-1111-4111-8111-111111111111",
        attemptId: "attempt-provider-access-1",
        deduped: false,
        errorCode: "quota.exceeded",
        errorMessage: "Provider access is unavailable for this account.",
        errorType: "adapter",
        providerAccessEvidence: {
          observedAtMs: 1_770_000_000_000,
          provider,
          reasonCode: "provider_account.subscription_access_unavailable",
          source: "wake_failure",
        },
        sourceEventId: "evt-provider-access-1",
        status: "failed",
        taskId: "task-provider-access-1",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts hard provider capacity evidence without treating a transient rate limit as account evidence", () => {
    const hardFailure = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        agentId: "agt_11111111-1111-4111-8111-111111111111",
        attemptId: "attempt-provider-capacity-1",
        deduped: false,
        errorCode: "quota.exceeded",
        errorMessage:
          "This provider account has exhausted its available quota.",
        errorType: "adapter",
        providerAccessEvidence: {
          observedAtMs: 1_770_000_000_000,
          provider: "opencode",
          reasonCode: "provider_account.capacity_exhausted",
          source: "wake_failure",
        },
        sourceEventId: "evt-provider-capacity-1",
        status: "failed",
        taskId: "task-provider-capacity-1",
      },
    });

    expect(hardFailure.success).toBe(true);
  });

  it("accepts path-free Default Project failure trace context", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        agentId: "agt_11111111-1111-4111-8111-111111111111",
        attemptId: "attempt-project-failure-1",
        deduped: false,
        errorCode: "project.local_connection.folder_missing",
        errorMessage: "project.local_connection.folder_missing",
        errorType: "config",
        projectFailureContext: {
          bindingGeneration: "binding-1",
          projectId: "project-1",
        },
        sourceEventId: "evt-project-failure-1",
        status: "failed",
        taskId: "task-project-failure-1",
      },
    });
    expect(result.success).toBe(true);
    if (
      !result.success ||
      result.data.v !== OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION
    ) {
      return;
    }
    expect(result.data.payload.projectFailureContext).toEqual({
      bindingGeneration: "binding-1",
      projectId: "project-1",
    });
  });

  it("rejects local paths in Default Project failure trace context", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        agentId: "agt_11111111-1111-4111-8111-111111111111",
        attemptId: "attempt-project-failure-path-1",
        deduped: false,
        errorCode: "project.local_connection.folder_missing",
        errorType: "config",
        projectFailureContext: {
          bindingGeneration: "binding-1",
          localPath: "/private/repository",
          projectId: "project-1",
        },
        sourceEventId: "evt-project-failure-path-1",
        status: "failed",
        taskId: "task-project-failure-path-1",
      },
    });
    expect(result.success).toBe(false);
  });

  it.each([
    {
      errorCode: "adapter.failed",
      status: "failed",
    },
    {
      errorCode: undefined,
      status: "success",
    },
  ] as const)("rejects Default Project failure context on unrelated $status results", ({
    errorCode,
    status,
  }) => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        agentId: "agt_11111111-1111-4111-8111-111111111111",
        attemptId: "attempt-unrelated-project-context-1",
        deduped: false,
        ...(errorCode
          ? {
              errorCode,
              errorType: "adapter",
            }
          : { output: "done" }),
        projectFailureContext: {
          projectId: "project-1",
        },
        sourceEventId: "evt-unrelated-project-context-1",
        status,
        taskId: "task-unrelated-project-context-1",
      },
    });

    expect(result.success).toBe(false);
  });

  it.each([
    "project.local_connection.missing",
    "project.local_connection.folder_missing",
  ] as const)("requires trace context for %s failures", (errorCode) => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        agentId: "agt_11111111-1111-4111-8111-111111111111",
        attemptId: "attempt-project-context-missing-1",
        deduped: false,
        errorCode,
        errorType: "config",
        sourceEventId: "evt-project-context-missing-1",
        status: "failed",
        taskId: "task-project-context-missing-1",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects failed provider account evidence for unsupported providers", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        agentId: "agt_11111111-1111-4111-8111-111111111111",
        attemptId: "attempt-provider-access-invalid-1",
        deduped: false,
        errorCode: "auth.required",
        errorType: "auth",
        providerAccessEvidence: {
          observedAtMs: 1_770_000_000_000,
          provider: "cursor",
          reasonCode: "provider_account.organization_access_disabled",
          source: "wake_failure",
        },
        sourceEventId: "evt-provider-access-invalid-1",
        status: "failed",
        taskId: "task-provider-access-invalid-1",
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts success envelope with agentControllerRef and agentControllerConversationId", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-ctx-1",
        status: "success",
        taskId: "task-ctx-1",
        sourceEventId: "evt-ctx-1",
        agentId: "agent-ctx-1",
        deduped: false,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-ctx-1",
        output: "hello",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts success envelope with agentControllerConversation", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-upstream-1",
        status: "success",
        taskId: "task-upstream-1",
        sourceEventId: "evt-upstream-1",
        agentId: "agent-upstream-1",
        deduped: false,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-upstream-1",
        agentControllerConversation: {
          agentControllerRef: "builtin:codex",
          agentControllerConversationKind: "thread",
          agentControllerConversationId: "thread-upstream-1",
        },
        output: "hello",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-string agentControllerConversation fields instead of coercing them", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-upstream-invalid-1",
        status: "success",
        taskId: "task-upstream-invalid-1",
        sourceEventId: "evt-upstream-invalid-1",
        agentId: "agent-upstream-invalid-1",
        deduped: false,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-upstream-invalid-1",
        agentControllerConversation: {
          agentControllerRef: 123,
          agentControllerConversationKind: "thread",
          agentControllerConversationId: true,
        },
        output: "hello",
      },
    });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("expected safeParse to fail");
    }

    expect(collectFlattenedIssueDetails(result.error.issues)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_type",
          path: [
            "payload",
            "agentControllerConversation",
            "agentControllerRef",
          ],
        }),
        expect.objectContaining({
          code: "invalid_type",
          path: [
            "payload",
            "agentControllerConversation",
            "agentControllerConversationId",
          ],
        }),
      ])
    );
  });

  it("accepts success envelope with verbatim effectiveRuntimeWorkingDirectory", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-workdir-1",
        status: "success",
        taskId: "task-workdir-1",
        sourceEventId: "evt-workdir-1",
        agentId: "agent-workdir-1",
        deduped: false,
        agentControllerRef: "builtin:claude-code",
        agentControllerConversationId: "session-workdir-1",
        effectiveRuntimeWorkingDirectory: " /tmp/My Project ",
        output: "hello",
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    if (!("effectiveRuntimeWorkingDirectory" in result.data.payload)) {
      throw new Error(
        "expected effectiveRuntimeWorkingDirectory on parsed payload"
      );
    }
    expect(result.data.payload.effectiveRuntimeWorkingDirectory).toBe(
      " /tmp/My Project "
    );
  });

  it("rejects overlong effectiveRuntimeWorkingDirectory", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-workdir-too-long-1",
        status: "success",
        taskId: "task-workdir-too-long-1",
        sourceEventId: "evt-workdir-too-long-1",
        agentId: "agent-workdir-too-long-1",
        deduped: false,
        agentControllerRef: "builtin:claude-code",
        agentControllerConversationId: "session-workdir-too-long-1",
        effectiveRuntimeWorkingDirectory: `/tmp/${"x".repeat(4097)}`,
        output: "hello",
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts success envelope with bootstrapTemplateFacts", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-bootstrap-1",
        status: "success",
        taskId: "task-bootstrap-1",
        sourceEventId: "evt-bootstrap-1",
        agentId: "agent-bootstrap-1",
        deduped: false,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-bootstrap-1",
        bootstrapTemplateFacts: {
          templateVersion: "compact-dispatch-bootstrap-v1",
          contentFingerprint: "sha256:abc",
        },
        output: "hello",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts success envelope with dispatchExecution", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-lifecycle-1",
        status: "success",
        taskId: "task-lifecycle-1",
        sourceEventId: "evt-lifecycle-1",
        agentId: "agent-lifecycle-1",
        deduped: false,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-lifecycle-1",
        dispatchExecution: {
          agentControllerConversationResume: {
            status: "continued",
          },
          localRuntimeContext: {
            status: "reused",
            reason: null,
          },
          bootstrap: {
            reason: null,
            status: "applied",
          },
        },
        output: "hello",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts legacy success envelope with claim lease diagnostic evidence", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-claim-1",
        status: "success",
        taskId: "task-claim-1",
        sourceEventId: "evt-claim-1",
        agentId: "agent-claim-1",
        deduped: false,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-claim-1",
        claimLease: {
          claimLeaseId: "claim-lease-1",
          outcome: "new_lease",
          status: "accepted",
        },
        output: "hello",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects legacy claim lease diagnostics with raw authority payload fields", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-claim-raw-1",
        status: "success",
        taskId: "task-claim-raw-1",
        sourceEventId: "evt-claim-raw-1",
        agentId: "agent-claim-raw-1",
        deduped: false,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-claim-raw-1",
        claimLease: {
          claimLeaseId: "claim-lease-raw-1",
          outcome: "new_lease",
          rawSession: "session-secret",
          status: "accepted",
          token: "token-secret",
        },
        output: "hello",
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts success envelope with runtimeWorkspaceFingerprint", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-runtime-workspace-1",
        status: "success",
        taskId: "task-runtime-workspace-1",
        sourceEventId: "evt-runtime-workspace-1",
        agentId: "agent-runtime-workspace-1",
        deduped: false,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-runtime-workspace-1",
        effectiveRuntimeWorkingDirectory: "/tmp/runtime-workspace",
        runtimeWorkspaceFingerprint: "sha256:runtime-workspace-1",
        output: "hello",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts success envelope with promptTrace", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-prompt-1",
        status: "success",
        taskId: "task-prompt-1",
        sourceEventId: "evt-prompt-1",
        agentId: "agent-prompt-1",
        deduped: false,
        output: "hello",
        promptTrace: {
          fingerprint: "sha256:prompt-1",
          length: 456,
          preview: "Space Dispatch Brief",
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts success envelope with streaming telemetry", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-stream-1",
        status: "success",
        taskId: "task-stream-1",
        sourceEventId: "evt-stream-1",
        agentId: "agent-stream-1",
        deduped: false,
        output: "hello",
        telemetry: {
          completedAtMs: 1_700_000_000_500,
          contextCompactionObserved: true,
          firstOutputAtMs: 1_700_000_000_300,
          firstStdoutAtMs: 1_700_000_000_200,
          invokedAtMs: 1_700_000_000_100,
          previewEmitted: true,
          resumedContext: false,
          streamingMode: "stream",
          tokenUsage: {
            last: {
              cacheWriteInputTokens: 0,
              cachedInputTokens: 800,
              inputTokens: 1000,
              outputTokens: 40,
              reasoningOutputTokens: 20,
              totalTokens: 1060,
            },
            modelContextWindow: 258_400,
            total: {
              cacheWriteInputTokens: 0,
              cachedInputTokens: 1400,
              inputTokens: 1800,
              outputTokens: 70,
              reasoningOutputTokens: 30,
              totalTokens: 1900,
            },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts v4 structured action failure diagnostics without publicFailureReason", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-structured-failure-legacy-1",
        status: "failed",
        taskId: "task-structured-failure-legacy-1",
        sourceEventId: "evt-structured-failure-legacy-1",
        agentId: "agent-structured-failure-legacy-1",
        deduped: false,
        errorType: "adapter",
        errorCode: "openmeld.space_action.repair_failed",
        errorMessage:
          "A valid OpenMeld Space action is required in collaboration mode.",
        spaceActionFailureDiagnostics: {
          carrierKind: "none",
          invalidOutputPreview: "hi",
          repairMode: "controller_roundtrip",
          spaceActionCandidatePresent: false,
          spaceActionParseError: null,
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    if (!("spaceActionFailureDiagnostics" in result.data.payload)) {
      throw new Error(
        "expected spaceActionFailureDiagnostics on parsed payload"
      );
    }
    expect(result.data.payload.spaceActionFailureDiagnostics).toMatchObject({
      publicFailureReason: null,
    });
  });

  it("accepts success envelope telemetry without legacy continuityStatus", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-rotation-1",
        status: "success",
        taskId: "task-rotation-1",
        sourceEventId: "evt-rotation-1",
        agentId: "agent-rotation-1",
        deduped: false,
        output: "hello",
        telemetry: {
          completedAtMs: 1_700_000_000_500,
          firstOutputAtMs: 1_700_000_000_300,
          firstStdoutAtMs: 1_700_000_000_200,
          invokedAtMs: 1_700_000_000_100,
          previewEmitted: true,
          resumedContext: true,
          streamingMode: "stream",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects conversationLifecycle after the dispatchExecution refactor", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-legacy-lifecycle-1",
        status: "success",
        taskId: "task-legacy-lifecycle-1",
        sourceEventId: "evt-legacy-lifecycle-1",
        agentId: "agent-legacy-lifecycle-1",
        deduped: false,
        conversationLifecycle: {
          compatibilityAction: "reuse",
          compatibilityReason: "compatible",
          continuityStatus: "stable_resume",
          bootstrapApplied: false,
          bootstrapReason: null,
          bootstrapTemplateVersion: "compact-dispatch-bootstrap-v1",
          bootstrapContentFingerprint: "sha256:abc",
        },
        output: "hello",
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts success envelope with provider runtime telemetry", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-runtime-1",
        status: "success",
        taskId: "task-runtime-1",
        sourceEventId: "evt-runtime-1",
        agentId: "agent-runtime-1",
        deduped: false,
        output: "hello",
        telemetry: {
          completedAtMs: 1_700_000_000_900,
          exitCode: 0,
          exitObservedAtMs: 1_700_000_000_850,
          firstStderrAtMs: 1_700_000_000_400,
          firstStdoutAtMs: 1_700_000_000_300,
          invokedAtMs: 1_700_000_000_100,
          processId: 4321,
          processSpawnedAtMs: 1_700_000_000_120,
          resumedContext: true,
          stdinClosedAtMs: 1_700_000_000_150,
          timeoutTriggeredAtMs: 1_700_000_000_800,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts partial_success envelope with required failure mapping fields", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-2",
        status: "partial_success",
        taskId: "task-2",
        sourceEventId: "evt-2",
        agentId: "agent-1",
        deduped: false,
        output: "partial output",
        errorType: "network",
        partialReason: "emit_failed_after_adapter_output",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts failed envelope with optional errorCode", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-error-code-1",
        status: "failed",
        taskId: "task-error-code-1",
        sourceEventId: "evt-error-code-1",
        agentId: "agent-error-code-1",
        deduped: false,
        errorType: "auth",
        errorCode: "auth.required",
        errorMessage: "auth.required: token missing",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts failed envelope with structured action failure diagnostics", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-action-failure-1",
        status: "failed",
        taskId: "task-action-failure-1",
        sourceEventId: "evt-action-failure-1",
        agentId: "agent-action-failure-1",
        deduped: false,
        errorType: "policy",
        errorCode: "openmeld.space_action.repair_failed",
        errorMessage:
          "A valid OpenMeld Space action is required in collaboration mode.",
        openClawGatewayVisibility: {
          agentId: "openmeld-demo-bot",
          gatewayRestartAttempted: true,
          gatewayVisibility: "visible_after_restart",
        },
        openClawBinding: {
          classification: "legacy",
        },
        spaceActionFailureDiagnostics: {
          carrierKind: "none",
          invalidOutputPreview: "hi",
          publicFailureReason:
            "A valid OpenMeld Space action is required in collaboration mode.",
          repairMode: "controller_roundtrip",
          spaceActionCandidatePresent: false,
          spaceActionParseError: null,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects failed envelope with an unknown openClawBinding classification", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-action-failure-invalid-binding-1",
        status: "failed",
        taskId: "task-action-failure-invalid-binding-1",
        sourceEventId: "evt-action-failure-invalid-binding-1",
        agentId: "agent-action-failure-invalid-binding-1",
        deduped: false,
        errorType: "policy",
        errorCode: "openmeld.space_action.repair_failed",
        errorMessage:
          "A valid OpenMeld Space action is required in collaboration mode.",
        openClawBinding: {
          classification: "unknown_classification",
        },
        spaceActionFailureDiagnostics: {
          carrierKind: "none",
          invalidOutputPreview: "hi",
          publicFailureReason:
            "A valid OpenMeld Space action is required in collaboration mode.",
          repairMode: "controller_roundtrip",
          spaceActionCandidatePresent: false,
          spaceActionParseError: null,
        },
      },
    });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("expected safeParse to fail");
    }

    expect(collectFlattenedIssueDetails(result.error.issues)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_value",
          path: ["payload", "openClawBinding", "classification"],
        }),
      ])
    );
  });

  it("accepts legacy v1 envelope without attemptId for read compatibility", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: 1,
      code: "service.task_result",
      payload: {
        status: "success",
        taskId: "task-legacy-1",
        sourceEventId: "evt-legacy-1",
        agentId: "agent-legacy-1",
        deduped: false,
        output: "legacy",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts previous v2 envelope for read compatibility", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: 2,
      code: "service.task_result",
      payload: {
        attemptId: "attempt-v2-1",
        status: "success",
        taskId: "task-v2-1",
        sourceEventId: "evt-v2-1",
        agentId: "agent-v2-1",
        deduped: false,
        output: "v2",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects failed envelope when errorType is missing", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        status: "failed",
        taskId: "task-3",
        sourceEventId: "evt-3",
        agentId: "agent-1",
        deduped: false,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects failed envelope with output field", () => {
    const result = openMeldDaemonTaskResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
      code: "service.task_result",
      payload: {
        status: "failed",
        taskId: "task-4",
        sourceEventId: "evt-4",
        agentId: "agent-1",
        deduped: false,
        errorType: "internal",
        output: "should-not-exist",
      },
    });
    expect(result.success).toBe(false);
  });
});
