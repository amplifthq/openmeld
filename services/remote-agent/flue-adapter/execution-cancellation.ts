import { remoteAgentWorkerCancellationResponseSchema } from "@openmeld/schemas";
import type {
  RemoteAgentWorkerCancellationResponse,
  RemoteAgentWorkerExecutionQuery,
} from "@openmeld/schemas/types";
import type { RemoteAgentStorage } from "../agent-core/callback-context";
import {
  completeRemoteAgentExecutionState,
  requestRemoteAgentExecutionCancellation,
} from "../agent-core/execution-state";

export async function cancelFlueRemoteAgentExecution(input: {
  abortSubmission: () => Promise<{ aborted: boolean }>;
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  reason?: string;
  storage: RemoteAgentStorage;
}): Promise<{
  abortedFlueSubmission: boolean | null;
  response: RemoteAgentWorkerCancellationResponse;
}> {
  const requested = await requestRemoteAgentExecutionCancellation({
    identity: input.identity,
    nowMs: input.nowMs,
    reason: input.reason,
    storage: input.storage,
  });
  if (
    !(
      (requested.status === "cancellation_requested" ||
        requested.status === "already_cancelled") &&
      requested.execution.status === "cancellation_requested"
    )
  ) {
    return {
      abortedFlueSubmission: null,
      response: requested,
    };
  }

  const abort = await input.abortSubmission();
  const execution = await completeRemoteAgentExecutionState({
    identity: input.identity,
    nowMs: input.nowMs,
    status: "aborted",
    storage: input.storage,
  });
  if (execution?.status !== "aborted") {
    throw new Error(
      "Remote Agent execution did not settle after Flue cancellation."
    );
  }
  return {
    abortedFlueSubmission: abort.aborted,
    response: remoteAgentWorkerCancellationResponseSchema.parse({
      execution,
      status: "already_cancelled",
    }),
  };
}
