import { setTimeout as delay } from "node:timers/promises";
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

type ComputerFinishContext = Pick<AgentFinishContext, "append"> &
  Partial<Pick<AgentFinishContext, "signal">>;

export function useRemoteAgentExecutionFinish(
  check: (
    finish: ComputerFinishContext,
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

type ComputerExecutionFinishInput = {
  context: RemoteAgentCallbackContext;
  storage: RemoteAgentStorage;
  env?: { AGENT_COMPUTER?: unknown };
  finish: ComputerFinishContext;
  finishState?: ComputerFinishState;
  setFinishState?: (state: ComputerFinishState) => void;
};

// Append facts only before Flue settles. Never reopen a settled model turn.
export async function checkRemoteAgentExecutionFinish(
  input: ComputerExecutionFinishInput
): Promise<void> {
  if (!(await canContinueComputerFinish(input))) {
    return;
  }
  let state = await readComputerFinishStateOrNull(input);
  const previous =
    input.finishState?.submissionId === input.context.submissionId
      ? input.finishState
      : null;
  if (previous?.pending && !previous.informed) {
    // Keep this original, unsettled Flue turn alive while its Computer owner
    // still observes real work. Each read is bounded; the owner advances the
    // receipt on its alarm. Model finish count is not evidence of a failure.
    // Abort/Stop remains authoritative. Ordinary queued input waits for this
    // turn, just as it does while a model tool call is outstanding.
    while (hasObservedComputerWork(state)) {
      input.finish.signal?.throwIfAborted();
      await delay(1000, undefined, { signal: input.finish.signal });
      if (!(await canContinueComputerFinish(input))) {
        return;
      }
      state = await readComputerFinishStateOrNull(input);
    }
    if (hasCompleteComputerResults(state)) {
      // Persist this handoff with the appended facts, including when completion
      // happened before this finish check. A later finish must not repeat it.
      input.setFinishState?.(null);
      input.finish.append({
        kind: "signal",
        type: "computer_results_ready",
        body: `The original Computer commands have completed and their results are retained: ${JSON.stringify(state)}. Read the original command results and files, then answer from those results. Do not repeat the commands.`,
      });
      return;
    }
  }
  if (hasCompleteComputerResults(state) && !previous?.informed) {
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
      body: `Computer commands still need their results collected: ${JSON.stringify(state)}. Poll these original references with bounded waits. Preparation can continue before native execution starts; its checkpoint describes actual work, not a timeout. Do not restart commands or treat an unchanged accepted label as failure. Separate saved results from unsynchronized files. Continue independent authorized work if useful. Explain a confirmed blocker or paused observation; the original Computer retains recovery and Stop responsibility.`,
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

async function canContinueComputerFinish(
  input: Pick<ComputerExecutionFinishInput, "context" | "storage">
): Promise<boolean> {
  await assertRemoteAgentExecutionCanContinue({
    storage: input.storage,
    identity: buildRemoteAgentExecutionIdentity(input.context),
  });
  try {
    await assertRemoteAgentTurnAllowsToolExecution({
      storage: input.storage,
      submissionId: input.context.submissionId,
    });
    return true;
  } catch (error) {
    if (error instanceof RemoteAgentTurnEndedError) {
      return false;
    }
    throw error;
  }
}

async function readComputerFinishStateOrNull(
  input: Parameters<typeof readComputerFinishState>[0]
): Promise<CloudComputerInvocationState | null> {
  try {
    return await readComputerFinishState(input);
  } catch {
    return null;
  }
}

function hasCompleteComputerResults(
  state: CloudComputerInvocationState | null
): boolean {
  return Boolean(
    state &&
      state.unfinished === 0 &&
      state.pendingResults === 0 &&
      state.unavailable === 0
  );
}

function hasObservedComputerWork(
  state: CloudComputerInvocationState | null
): boolean {
  return Boolean(
    state &&
      state.unavailable === 0 &&
      state.commands.some(
        (command) =>
          !(command.filesSynced || command.stopRequested) &&
          (command.phase === "accepted" ||
            command.phase === "launch_unknown" ||
            command.phase === "running" ||
            command.phase === "process_exited" ||
            command.phase === "sync_pending") &&
          (command.collection?.nextAttemptAtMs != null ||
            (command.collection?.observationExpiresAtMs ?? 0) > Date.now())
      )
  );
}
