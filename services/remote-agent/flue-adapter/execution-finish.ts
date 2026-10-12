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
import { inspectRemoteAgentComputerInvocation } from "./computer-command";
import {
  computerFinishFingerprint,
  reportComputerFinishFacts,
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
  input.finish.signal?.throwIfAborted();
  const previous =
    input.finishState?.submissionId === input.context.submissionId
      ? input.finishState
      : null;
  if (previous?.informed) {
    // The persisted hook batch proves the model received these facts. A new
    // observation must not block its explanation or authorize stopping work.
    await reportComputerFinishFacts({
      ...input,
      state: null,
      reviewedFingerprint: previous.informed,
    });
    return;
  }
  let state = await observeComputerFinish(input);
  if (!state) {
    return;
  }
  if (previous?.pending) {
    // Keep this original, unsettled Flue turn alive while its Computer owner
    // still observes real work. Reads stay single-flight and the wait is
    // cancellable; the owner advances the receipt on its alarm. Model finish
    // count is not evidence of a failure.
    // Abort/Stop remains authoritative. Ordinary queued input waits for this
    // turn, just as it does while a model tool call is outstanding.
    state = await waitForComputerResults(input, state);
    if (!state) {
      return;
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
  if (hasCompleteComputerResults(state)) {
    return;
  }
  const fingerprint = computerFinishFingerprint(state);
  if (
    state.unavailable === 0 &&
    state.commands.some(
      (command) => !(command.filesSynced || command.stopRequested)
    ) &&
    !previous?.pending
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
  input.setFinishState?.({
    submissionId: input.context.submissionId,
    informed: fingerprint,
  });
  input.finish.append({
    kind: "signal",
    type: "computer_result_incomplete",
    body: `Computer recovery facts: ${JSON.stringify(state)}. Do not claim unknown actions completed, unsynchronized files were saved, or an unconfirmed process stopped. Explain the confirmed results and their existing references, what is incomplete or unknown, and the next safe step. Paused observation does not stop the original command. Its receipt retains recovery responsibility; a later authorized poll can resume observation through the same reference. Do not restart an uncertain command or repeat an external write. You may finish with a truthful blocked answer, or continue independent authorized work. Do not poll indefinitely.`,
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

async function waitForComputerResults(
  input: ComputerExecutionFinishInput,
  initial: CloudComputerInvocationState
): Promise<CloudComputerInvocationState | undefined> {
  let state: CloudComputerInvocationState | undefined = initial;
  while (state && hasObservedComputerWork(state)) {
    await delay(1000, undefined, { signal: input.finish.signal });
    state = await observeComputerFinish(input);
  }
  return state;
}

async function observeComputerFinish(
  input: ComputerExecutionFinishInput
): Promise<CloudComputerInvocationState | undefined> {
  let failures = 0;
  while (await canContinueComputerFinish(input)) {
    input.finish.signal?.throwIfAborted();
    let state: CloudComputerInvocationState;
    try {
      // One in-flight read owns this observation. A local wait budget must
      // neither abandon it and start overlapping reads nor authorize Stop.
      state = await waitForObservation(
        inspectRemoteAgentComputerInvocation(input),
        input.finish.signal
      );
    } catch (error) {
      input.finish.signal?.throwIfAborted();
      failures += 1;
      const retryAfterMs = Math.min(
        1000 * 2 ** Math.min(failures - 1, 5),
        30_000
      );
      console.warn("[remote_agent.computer_finish.observation_failed]", {
        submissionId: input.context.submissionId,
        failures,
        retryAfterMs,
        errorName: error instanceof Error ? error.name : "Error",
      });
      await delay(retryAfterMs, undefined, { signal: input.finish.signal });
      continue;
    }
    input.finish.signal?.throwIfAborted();
    return (await canContinueComputerFinish(input)) ? state : undefined;
  }
}

async function waitForObservation<T>(
  read: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) {
    return await read;
  }
  // Abort ends this observer, not the underlying read-only RPC. Both late
  // resolution and rejection remain handled; no replacement read is started.
  let abort: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
      }
      read.then(resolve, reject);
    });
  } finally {
    if (abort) {
      signal.removeEventListener("abort", abort);
    }
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
