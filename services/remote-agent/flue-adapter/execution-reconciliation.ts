import type {
  RemoteAgentWorkerExecutionQuery,
  RemoteAgentWorkerExecutionQueryResponse,
} from "@openmeld/schemas/types";
import {
  listRemoteAgentCallbackContexts,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
} from "../agent-core/callback-context";
import {
  completeRemoteAgentExecutionState,
  RemoteAgentTerminalExecutionOwnerMissingError,
  readRemoteAgentExecutionState,
  resolveRemoteAgentTerminalExecutionOutcome,
} from "../agent-core/execution-state";
import {
  buildRemoteAgentTerminalCallbackResult,
  projectRemoteAgentTerminalOutcomeToCallback,
} from "../agent-core/terminal-callback-projection";
import { createRemoteAgentTerminalFailureFact } from "../agent-core/terminal-failure";

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
    terminalFailure: createRemoteAgentTerminalFailureFact({
      error: cancelled
        ? (current.execution.cancellationReason ??
          "Remote Agent execution was cancelled.")
        : submission.error,
      status: cancelled ? "aborted" : "failed",
    }),
  });
  await projectRemoteAgentTerminalExecution({
    coreWorker: input.coreWorker,
    execution: settledExecution,
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
    throw new RemoteAgentTerminalExecutionOwnerMissingError(
      input.identity.submissionId
    );
  }
  const result = buildRemoteAgentTerminalCallbackResult({
    outcome,
    requestId: input.identity.submissionId,
  });
  await projectRemoteAgentTerminalOutcomeToCallback({
    coreWorker: input.coreWorker,
    nowMs: input.nowMs,
    outcome,
    result,
    storage: input.storage,
    submissionId: input.identity.submissionId,
  });
}
