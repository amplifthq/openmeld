import {
  type AgentFinishContext,
  useAgentFinish,
  usePersistentState,
} from "@flue/runtime";
import type { CloudComputerInvocationState } from "@openmeld/schemas";
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
import {
  computerFinishFingerprint,
  readComputerFinishState,
  reportComputerFinishFacts,
  requestComputerCleanup,
} from "./execution-cleanup";

export type ComputerFinishState = {
  submissionId: string;
  pending?: string;
  informed?: string;
} | null;

export function useRemoteAgentExecutionFinish(
  check: (
    finish: Pick<AgentFinishContext, "append">,
    state: ComputerFinishState,
    setState: (value: ComputerFinishState) => void
  ) => Promise<void>
) {
  const [persisted, persist] = usePersistentState<ComputerFinishState>(
    "openmeld.computerFinish",
    null
  );
  // Flue may run another finish cycle without rendering this agent again.
  // Keep that callback's view current; Flue's atomic hook batch owns durability.
  let current = persisted;
  useAgentFinish((finish) =>
    check(finish, current, (next) => {
      current = next;
      persist(next);
    })
  );
}

// Append facts only before Flue settles. Never reopen a settled model turn.
export async function checkRemoteAgentExecutionFinish(input: {
  context: RemoteAgentCallbackContext;
  storage: RemoteAgentStorage;
  env?: { AGENT_COMPUTER?: unknown };
  finish: Pick<AgentFinishContext, "append">;
  finishState?: ComputerFinishState;
  setFinishState?: (state: ComputerFinishState) => void;
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
  let state: CloudComputerInvocationState | null;
  try {
    state = await readComputerFinishState(input);
  } catch {
    state = null;
  }
  const previous =
    input.finishState?.submissionId === input.context.submissionId
      ? input.finishState
      : null;
  if (
    state &&
    state.unfinished === 0 &&
    state.pendingResults === 0 &&
    state.unavailable === 0 &&
    !previous?.informed
  ) {
    return;
  }
  const fingerprint = computerFinishFingerprint(state);
  if (
    state &&
    state.unavailable === 0 &&
    state.commands.some(
      (command) => !(command.filesSynced || command.stopRequested)
    ) &&
    !previous?.pending &&
    !previous?.informed
  ) {
    input.setFinishState?.({
      submissionId: input.context.submissionId,
      pending: fingerprint,
    });
    input.finish.append({
      kind: "signal",
      type: "owned_commands_pending",
      body: `Computer commands still need their results collected: ${JSON.stringify(state)}. Poll these original references with bounded waits. Do not restart them. Separate saved results from unsynchronized files. Continue independent authorized work if useful. If these operations cannot make progress, explain the blocker and finish; the original Computer will retain Stop responsibility.`,
    });
    return;
  }
  const cleanup = await requestComputerCleanup(input);
  state = cleanup?.state ?? null;
  const informed = computerFinishFingerprint(state);
  if (previous?.informed) {
    // Flue persists hook state and the appended facts in one canonical batch.
    // Reaching the next finish cycle proves the model processed that batch.
    // Only the facts supplied to that model cycle were reviewed. Preserve
    // their explanation independently of later cleanup progress.
    await reportComputerFinishFacts({
      ...input,
      state,
      reviewedFingerprint: previous.informed,
    });
    return;
  }
  input.setFinishState?.({
    submissionId: input.context.submissionId,
    informed,
  });
  input.finish.append({
    kind: "signal",
    type: "computer_result_incomplete",
    body: `Computer recovery facts: ${JSON.stringify({ stopHandoffAccepted: cleanup?.accepted ?? false, state })}. Do not claim unknown actions completed, unsynchronized files were saved, or an unconfirmed process stopped. Explain the confirmed results and their existing references, what is incomplete or unknown, and the next safe step. The original receipts retain cleanup responsibility. Do not restart an uncertain command or repeat an external write. Computer launches for this invocation are fenced after Stop. You may finish with a truthful blocked answer, or use independent authorized non-Computer tools. Do not poll indefinitely.`,
  });
}
