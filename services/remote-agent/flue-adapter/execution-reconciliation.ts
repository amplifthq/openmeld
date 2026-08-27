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
  recordRemoteAgentRecoveredAnswer,
} from "../agent-core/callback-context";
import {
  completeRemoteAgentExecutionState,
  readRemoteAgentExecutionState,
} from "../agent-core/execution-state";
import { readPreservedRemoteAgentStreamText } from "./streaming";

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

  // Cancellation is a member decision and always wins: a preserved answer must
  // never revive a cancelled execution.
  if (!cancelled) {
    const recovered = await replayPreservedSettledAnswer({
      coreWorker: input.coreWorker,
      identity: input.identity,
      nowMs,
      storage: input.storage,
    });
    if (recovered) {
      return recovered;
    }
  }

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

/**
 * Replay a durably preserved answer after a settled runtime whose final
 * callback never reached Core. The answer is published through the same
 * durable delivery path as the first completion callback, so repeated
 * recovery cannot publish twice: the execution is completed first, the
 * context only ever gains one answer, and Core rejects duplicate completions
 * for a submission.
 */
async function replayPreservedSettledAnswer(input: {
  coreWorker?: RemoteAgentCoreWorkerBinding;
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentWorkerExecutionQueryResponse | null> {
  const context = await readRemoteAgentCallbackContext(
    input.storage,
    input.identity.submissionId
  );
  if (!context) {
    return null;
  }
  const preservedText =
    context.completedText?.trim() ||
    (await readPreservedRemoteAgentStreamText({
      storage: input.storage,
      submissionId: input.identity.submissionId,
    }));
  if (!preservedText) {
    return null;
  }

  await completeRemoteAgentExecutionState({
    identity: input.identity,
    nowMs: input.nowMs,
    status: "completed",
    storage: input.storage,
  });

  if (
    context.callbackStatus !== "completed" &&
    context.callbackStatus !== "rejected"
  ) {
    const readyContext = await recordRemoteAgentRecoveredAnswer({
      storage: input.storage,
      submissionId: input.identity.submissionId,
      text: preservedText,
    });
    console.info("[remote_agent.execution.answer_replayed]", {
      dispatchId: context.dispatchId,
      idempotencyKey: context.idempotencyKey,
      spaceId: context.spaceId,
      submissionId: context.submissionId,
      triggerMessageId: context.triggerMessageId,
    });
    if (
      readyContext &&
      readyContext.callbackStatus !== "completed" &&
      readyContext.callbackStatus !== "rejected"
    ) {
      await attemptRemoteAgentCallbackDelivery({
        context: readyContext,
        coreWorker: input.coreWorker,
        nowMs: input.nowMs,
        storage: input.storage,
      });
    }
  }

  return await readRemoteAgentExecutionState({
    identity: input.identity,
    storage: input.storage,
  });
}
