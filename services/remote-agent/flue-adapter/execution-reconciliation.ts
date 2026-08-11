import type {
  RemoteAgentWorkerExecutionQuery,
  RemoteAgentWorkerExecutionQueryResponse,
} from "@openmeld/schemas/types";
import {
  handleRemoteAgentChatResponse,
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

const RESULT_UNAVAILABLE_ERROR =
  "The agent runtime settled without preserving a callback result.";

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

  const nowMs = input.nowMs?.() ?? Date.now();
  const cancelled =
    current.execution.status === "cancellation_requested" ||
    current.execution.status === "aborted";
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
        : new Error(submission.error ?? RESULT_UNAVAILABLE_ERROR),
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
