import type { AgentFinishContext } from "@flue/runtime";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import {
  assertRemoteAgentExecutionCanContinue,
  buildRemoteAgentExecutionIdentity,
} from "../agent-core/execution-state";
import {
  assertRemoteAgentTurnAllowsToolExecution,
  RemoteAgentTurnEndedError,
} from "../agent-core/turn-end";
import { listPendingRemoteAgentComputerCommands } from "./computer-command";

// This hook checks owned operation receipts, never guesses completeness from
// prose. It only gives feedback; no external effects are replayed here.
export async function checkRemoteAgentExecutionFinish(input: {
  context: RemoteAgentCallbackContext;
  storage: RemoteAgentStorage;
  finish: Pick<AgentFinishContext, "append">;
}): Promise<void> {
  await assertRemoteAgentExecutionCanContinue({
    storage: input.storage,
    identity: buildRemoteAgentExecutionIdentity(input.context),
  });
  try {
    await assertRemoteAgentTurnAllowsToolExecution({
      storage: input.storage,
      submissionId: input.context.submissionId,
    });
  } catch (error) {
    if (error instanceof RemoteAgentTurnEndedError) {
      return;
    }
    throw error;
  }
  const commands = await listPendingRemoteAgentComputerCommands(input);
  if (commands.length === 0) {
    return;
  }
  input.finish.append({
    kind: "signal",
    type: "owned_commands_pending",
    body: `Computer commands still need their results collected: ${JSON.stringify(commands)}. Continue using computer_command poll with these existing keys and bounded waits until completion. Do not restart them or wrap indefinite polling in Code Mode. If input or authorization is required, use the supported stopping path and explain the unresolved operation.`,
  });
}
