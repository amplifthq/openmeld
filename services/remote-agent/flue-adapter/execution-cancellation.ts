import type {
  RemoteAgentWorkerCancellationResponse,
  RemoteAgentWorkerExecutionQuery,
} from "@openmeld/schemas/types";
import type { RemoteAgentStorage } from "../agent-core/callback-context";
import { requestRemoteAgentExecutionCancellation } from "../agent-core/execution-state";

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
      requested.status === "cancellation_requested" &&
      requested.execution.status === "cancellation_requested"
    )
  ) {
    return {
      abortedFlueSubmission: null,
      response: requested,
    };
  }

  const abort = await input.abortSubmission();
  // The Flue response acknowledges durable abort intent, not that an external
  // operation has finished unwinding. Its observer/reconciler owns settlement.
  // A false result can also mean the submission is absent; absence is not proof
  // of cancellation and must not fabricate a terminal execution outcome.
  return {
    abortedFlueSubmission: abort.aborted,
    response: requested,
  };
}
