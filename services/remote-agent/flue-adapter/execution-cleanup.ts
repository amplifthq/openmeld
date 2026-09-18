import type {
  RemoteAgentCallbackContext,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionIdentity,
  requestRemoteAgentExecutionFailure,
} from "../agent-core/execution-state";
import { createRemoteAgentTerminalFailureFact } from "../agent-core/terminal-failure";
import { stopRemoteAgentComputerCommands } from "./computer-command";

/** Shared observer/recovery gate: a stop request is not a completed cleanup. */
export async function finishRemoteAgentComputerCommands(input: {
  context: RemoteAgentCallbackContext | null;
  env?: { AGENT_COMPUTER?: unknown };
  storage: RemoteAgentStorage;
}): Promise<void> {
  if (!input.context) {
    return;
  }
  try {
    const unfinished = await stopRemoteAgentComputerCommands({
      context: input.context,
      env: input.env ?? {},
      storage: input.storage,
    });
    if (unfinished > 0) {
      throw new Error(
        "Computer command cleanup is pending: Stop was requested but termination is not yet confirmed."
      );
    }
  } catch (error) {
    await requestRemoteAgentExecutionFailure({
      identity: buildRemoteAgentExecutionIdentity(input.context),
      failure: createRemoteAgentTerminalFailureFact({
        status: "failed",
        error,
      }),
      storage: input.storage,
    });
    // Leave the execution stoppable and the callback pending. The existing
    // reconciliation alarm retries cleanup from retained command identities.
    throw error;
  }
}
