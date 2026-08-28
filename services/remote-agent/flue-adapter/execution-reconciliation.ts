import type {
  RemoteAgentWorkerExecutionQuery,
  RemoteAgentWorkerExecutionQueryResponse,
} from "@openmeld/schemas/types";
import {
  attemptRemoteAgentCallbackDelivery,
  handleRemoteAgentChatResponse,
  listRemoteAgentCallbackContexts,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
  readRemoteAgentCallbackContext,
  recordRemoteAgentCompletedAnswer,
} from "../agent-core/callback-context";
import {
  completeRemoteAgentExecutionState,
  readRemoteAgentExecutionState,
  resolveRemoteAgentTerminalExecutionOutcome,
} from "../agent-core/execution-state";

export type FlueSubmissionLifecycle = {
  error?: string;
  status: "queued" | "running" | "terminalizing" | "settled";
};

export async function reconcileSettledRemoteAgentExecutionFailures(input: {
  coreWorker?: RemoteAgentCoreWorkerBinding;
  nowMs?: () => number;
  readSubmission: (
    submissionId: string
  ) => Promise<FlueSubmissionLifecycle | null>;
  storage: RemoteAgentStorage;
}): Promise<{ reconciled: number }> {
  const pendingContexts = await listRemoteAgentCallbackContexts(input.storage, [
    "pending",
  ]);
  let reconciled = 0;
  for (const context of pendingContexts) {
    try {
      const submission = await input.readSubmission(context.submissionId);
      if (submission?.status !== "settled") {
        continue;
      }
      const result = await reconcileRemoteAgentExecution({
        coreWorker: input.coreWorker,
        identity: {
          idempotencyKey: context.idempotencyKey,
          organizationId: context.organizationId,
          spaceId: context.spaceId,
          submissionId: context.submissionId,
          v: 1,
        },
        nowMs: input.nowMs,
        readSubmission: async () => submission,
        storage: input.storage,
      });
      if (
        result.status === "found" &&
        (result.execution.status === "failed" ||
          result.execution.status === "aborted")
      ) {
        reconciled += 1;
      }
    } catch (error) {
      console.error("[remote_agent.execution.reconciliation_failed]", {
        error: error instanceof Error ? error.message : String(error),
        submissionId: context.submissionId,
      });
    }
  }
  return { reconciled };
}

export async function reconcileRemoteAgentExecution(input: {
  coreWorker?: RemoteAgentCoreWorkerBinding;
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs?: () => number;
  readSubmission: (
    submissionId: string
  ) => Promise<FlueSubmissionLifecycle | null>;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentWorkerExecutionQueryResponse> {
  const current = await readRemoteAgentExecutionState({
    identity: input.identity,
    storage: input.storage,
  });
  if (current.status !== "found") {
    return current;
  }
  if (
    current.execution.status === "completed" ||
    current.execution.status === "failed" ||
    current.execution.status === "aborted"
  ) {
    await projectRemoteAgentTerminalExecution({
      coreWorker: input.coreWorker,
      execution: current.execution,
      identity: input.identity,
      nowMs: input.nowMs?.() ?? Date.now(),
      storage: input.storage,
    });
    return await readRemoteAgentExecutionState({
      identity: input.identity,
      storage: input.storage,
    });
  }

  const submission = await input.readSubmission(input.identity.submissionId);
  if (submission?.status !== "settled") {
    return current;
  }

  const cancelled = current.execution.status === "cancellation_requested";
  // Successful settlement can precede the observer callback. A durable Flue
  // error or an already-requested cancellation is the only terminal fact this
  // reconciler is allowed to project.
  if (!(cancelled || submission.error)) {
    return current;
  }

  const nowMs = input.nowMs?.() ?? Date.now();

  const settledExecution = await completeRemoteAgentExecutionState({
    identity: input.identity,
    nowMs,
    status: cancelled ? "aborted" : "failed",
    storage: input.storage,
  });
  await projectRemoteAgentTerminalExecution({
    coreWorker: input.coreWorker,
    execution: settledExecution,
    failureError: cancelled
      ? new Error("Remote Agent execution was cancelled.")
      : new Error(submission.error),
    identity: input.identity,
    nowMs,
    storage: input.storage,
  });

  return await readRemoteAgentExecutionState({
    identity: input.identity,
    storage: input.storage,
  });
}

async function projectRemoteAgentTerminalExecution(input: {
  coreWorker?: RemoteAgentCoreWorkerBinding;
  execution: Awaited<ReturnType<typeof completeRemoteAgentExecutionState>>;
  failureError?: Error;
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  storage: RemoteAgentStorage;
}): Promise<void> {
  const outcome = await resolveRemoteAgentTerminalExecutionOutcome({
    execution: input.execution,
    identity: input.identity,
    nowMs: input.nowMs,
    storage: input.storage,
  });
  if (!outcome) {
    return;
  }
  if (outcome.status === "completed") {
    await replayDurableCompletedAnswer({
      completedText: outcome.completedText,
      coreWorker: input.coreWorker,
      identity: input.identity,
      nowMs: input.nowMs,
      storage: input.storage,
    });
    return;
  }
  await handleRemoteAgentChatResponse({
    coreWorker: input.coreWorker,
    nowMs: () => input.nowMs,
    result: {
      continuation: false,
      error:
        outcome.status === "aborted"
          ? new Error("Remote Agent execution was cancelled.")
          : (input.failureError ??
            new Error("Remote Agent execution failed before its callback.")),
      message: { parts: [] },
      requestId: input.identity.submissionId,
      status: outcome.status === "aborted" ? "aborted" : "error",
    },
    storage: input.storage,
  });
}

/**
 * Replay an authoritative answer only after the durable execution owner has
 * already recorded a successful completion. Partial stream text and failed
 * executions can never enter this path.
 */
async function replayDurableCompletedAnswer(input: {
  completedText: string;
  coreWorker?: RemoteAgentCoreWorkerBinding;
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  storage: RemoteAgentStorage;
}): Promise<void> {
  let context = await readRemoteAgentCallbackContext(
    input.storage,
    input.identity.submissionId
  );
  if (!context) {
    return;
  }
  context = await recordRemoteAgentCompletedAnswer({
    storage: input.storage,
    submissionId: input.identity.submissionId,
    text: input.completedText,
  });
  if (
    context.callbackStatus !== "completed" &&
    context.callbackStatus !== "rejected"
  ) {
    console.info("[remote_agent.execution.answer_replayed]", {
      dispatchId: context.dispatchId,
      idempotencyKey: context.idempotencyKey,
      spaceId: context.spaceId,
      submissionId: context.submissionId,
      triggerMessageId: context.triggerMessageId,
    });
    await attemptRemoteAgentCallbackDelivery({
      context,
      coreWorker: input.coreWorker,
      nowMs: input.nowMs,
      storage: input.storage,
    });
  }
}
