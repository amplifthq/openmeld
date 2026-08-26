import type {
  RemoteAgentWorkerExecutionQuery,
  RemoteAgentWorkerExecutionQueryResponse,
} from "@openmeld/schemas/types";
import {
  handleRemoteAgentChatResponse,
  listRemoteAgentCallbackContexts,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
} from "../agent-core/callback-context";
import {
  completeRemoteAgentExecutionState,
  readRemoteAgentExecutionState,
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
      // A successful submission can briefly settle before its stream observer
      // finishes the Core callback. Only Flue's durable error fact proves that a
      // pending callback has a terminal failure to reconcile.
      if (submission?.status !== "settled" || !submission.error) {
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
  if (current.execution.status === "completed") {
    return current;
  }

  const submission = await input.readSubmission(input.identity.submissionId);
  if (submission?.status !== "settled") {
    return current;
  }

  const cancelled =
    current.execution.status === "cancellation_requested" ||
    current.execution.status === "aborted";
  // Successful settlement can precede the observer callback. A durable Flue
  // error or an already-requested cancellation is the only terminal fact this
  // reconciler is allowed to project.
  if (!(cancelled || submission.error)) {
    return current;
  }

  const nowMs = input.nowMs?.() ?? Date.now();
  await completeRemoteAgentExecutionState({
    identity: input.identity,
    nowMs,
    status: cancelled ? "aborted" : "failed",
    storage: input.storage,
  });
  await handleRemoteAgentChatResponse({
    coreWorker: input.coreWorker,
    nowMs: () => nowMs,
    result: {
      continuation: false,
      error: cancelled
        ? new Error("Remote Agent execution was cancelled.")
        : new Error(submission.error),
      message: { parts: [] },
      requestId: input.identity.submissionId,
      status: cancelled ? "aborted" : "error",
    },
    storage: input.storage,
  });

  return await readRemoteAgentExecutionState({
    identity: input.identity,
    storage: input.storage,
  });
}
