import {
  type CloudComputerInvocationState,
  cloudComputerInvocationStateSchema,
  REMOTE_AGENT_COMPUTER_CLEANUP_FAILED_CODE,
} from "@openmeld/schemas";
import {
  type RemoteAgentCallbackContext,
  type RemoteAgentStorage,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  createRemoteAgentTerminalFailureFact,
  type RemoteAgentTerminalFailureFact,
} from "../agent-core/terminal-failure";
import type { AgentComputerNamespace } from "./agent-computer-workspace-access";
import {
  inspectRemoteAgentComputerInvocation,
  readBoundComputerName,
} from "./computer-command";
import type { AgentComputer } from "./computer-workspace";

const CLEANUP_PREFIX = "openmeld:remote-agent:computer-cleanup:";
const FINISH_FACTS_PREFIX = "openmeld:remote-agent:computer-finish-facts:";
const HANDOFF_ATTEMPTS = 8;

// This is a Stop delivery obligation, not a second process owner. Only the
// Computer's original receipts establish execution/exit/synchronization.
export type ComputerCleanupHandoff = {
  submissionId: string;
  computerName?: string;
  accepted: boolean;
  resumeRequested?: boolean;
  attempts: number;
  nextAttemptAtMs: number | null;
  state: CloudComputerInvocationState | null;
};

type CleanupInput = {
  context: RemoteAgentCallbackContext | null;
  env?: { AGENT_COMPUTER?: unknown };
  storage: RemoteAgentStorage;
  resume?: boolean;
  retained?: Pick<ComputerCleanupHandoff, "submissionId" | "computerName">;
};

export async function readComputerFinishState(input: CleanupInput) {
  if (!(input.context || input.retained)) {
    return null;
  }
  return await boundedComputerRead(() => inspectCleanupInvocation(input));
}

export function computerFinishFingerprint(
  state: CloudComputerInvocationState | null
): string {
  if (!state) {
    return "unavailable";
  }
  // Poll timestamps and retry counters are not new process progress.
  return JSON.stringify({
    total: state.total,
    unfinished: state.unfinished,
    pendingResults: state.pendingResults,
    unavailable: state.unavailable,
    commands: state.commands.map(
      ({ collection: _collection, ...command }) => command
    ),
  });
}

export async function reportComputerFinishFacts(
  input: CleanupInput & {
    state: CloudComputerInvocationState | null;
    reviewedFingerprint?: string;
  }
): Promise<boolean> {
  if (!input.context) {
    return false;
  }
  const key = FINISH_FACTS_PREFIX + input.context.submissionId;
  const fingerprint =
    input.reviewedFingerprint ?? computerFinishFingerprint(input.state);
  if ((await input.storage.get(key)) === fingerprint) {
    return false;
  }
  await input.storage.put(key, fingerprint);
  return true;
}

export async function requestComputerCleanup(
  input: CleanupInput
): Promise<ComputerCleanupHandoff | null> {
  const submissionId =
    input.context?.submissionId ?? input.retained?.submissionId;
  if (!submissionId) {
    return null;
  }
  const key = CLEANUP_PREFIX + submissionId;
  const previous = await input.storage.get<ComputerCleanupHandoff>(key);
  if (
    previous?.accepted &&
    !input.resume &&
    !previous.resumeRequested &&
    (previous.computerName || previous.nextAttemptAtMs === null)
  ) {
    return await refreshAcceptedComputerCleanup(input, previous);
  }
  if (
    previous &&
    !input.resume &&
    (previous.nextAttemptAtMs === null || previous.nextAttemptAtMs > Date.now())
  ) {
    return previous;
  }
  const pending = await buildPendingComputerCleanup(
    input,
    submissionId,
    previous
  );
  // Persist before RPC. A crash or lost acknowledgement must not lose Stop.
  const reserved = previous
    ? await input.storage.compareAndSet(key, previous, pending)
    : await input.storage.putIfAbsent(key, pending);
  if (!reserved) {
    return (await input.storage.get<ComputerCleanupHandoff>(key)) ?? pending;
  }
  return await deliverComputerCleanup(input, pending);
}

async function refreshAcceptedComputerCleanup(
  input: CleanupInput,
  previous: ComputerCleanupHandoff
): Promise<ComputerCleanupHandoff> {
  // Acceptance is durable. Refresh only its read projection; a failed read
  // does not revoke ownership or falsely confirm the process has stopped.
  const key = CLEANUP_PREFIX + previous.submissionId;
  try {
    const state = await readComputerFinishState(input);
    const next = { ...previous, state };
    return (await input.storage.compareAndSet(key, previous, next))
      ? next
      : ((await input.storage.get<ComputerCleanupHandoff>(key)) ?? previous);
  } catch {
    return previous;
  }
}

async function buildPendingComputerCleanup(
  input: CleanupInput,
  submissionId: string,
  previous: ComputerCleanupHandoff | undefined
): Promise<ComputerCleanupHandoff> {
  const attempts = input.resume ? 1 : (previous?.attempts ?? 0) + 1;
  return {
    submissionId,
    computerName:
      previous?.computerName ??
      input.retained?.computerName ??
      (await readBoundComputerName(input.storage, submissionId)),
    accepted: previous?.accepted ?? false,
    resumeRequested: input.resume || previous?.resumeRequested,
    attempts,
    nextAttemptAtMs:
      attempts >= HANDOFF_ATTEMPTS
        ? null
        : Date.now() + Math.min(5000 * 2 ** (attempts - 1), 300_000),
    state: previous?.state ?? null,
  };
}

async function deliverComputerCleanup(
  input: CleanupInput,
  pending: ComputerCleanupHandoff
): Promise<ComputerCleanupHandoff> {
  const key = CLEANUP_PREFIX + pending.submissionId;
  try {
    const state = await boundedComputerRead(() =>
      inspectCleanupInvocation(
        { ...input, resume: pending.resumeRequested },
        true
      )
    );
    // Historical commands remain in Remote storage. Until their retained
    // receipts settle, this same bounded obligation must keep observing them.
    const legacyPending =
      !pending.computerName &&
      input.context?.computerIsolationVersion !== 3 &&
      (state.unfinished > 0 || state.pendingResults > 0);
    const accepted = {
      ...pending,
      accepted: true,
      resumeRequested: false,
      nextAttemptAtMs: legacyPending ? pending.nextAttemptAtMs : null,
      state,
    };
    return (await input.storage.compareAndSet(key, pending, accepted))
      ? accepted
      : ((await input.storage.get<ComputerCleanupHandoff>(key)) ?? pending);
  } catch (error) {
    console.warn("[remote_agent.computer_cleanup.handoff_pending]", {
      submissionId: pending.submissionId,
      attempts: pending.attempts,
      nextAttemptAtMs: pending.nextAttemptAtMs,
      errorName: error instanceof Error ? error.name : "Error",
    });
    return pending;
  }
}

export async function listComputerCleanupHandoffs(storage: RemoteAgentStorage) {
  return [
    ...(
      await storage.list<ComputerCleanupHandoff>({ prefix: CLEANUP_PREFIX })
    ).values(),
  ];
}

/** Settle model delivery independently after durable Stop responsibility exists.
 * A newly discovered fact invalidates an unreviewed success, not stored results.
 */
export async function finishRemoteAgentComputerCommands(
  input: CleanupInput & { assistantText?: string }
): Promise<RemoteAgentTerminalFailureFact | null> {
  const cleanup = await requestComputerCleanup(input);
  if (!cleanup) {
    return null;
  }
  const reviewed = await input.storage.get(
    FINISH_FACTS_PREFIX + cleanup.submissionId
  );
  // Cleanup progress cannot upgrade an already explained blocked task to
  // success. The model's reviewed disposition belongs to the original turn.
  if (
    !reviewed &&
    cleanup.accepted &&
    cleanup.state?.unfinished === 0 &&
    cleanup.state.pendingResults === 0 &&
    cleanup.state.unavailable === 0
  ) {
    return null;
  }
  return {
    ...createRemoteAgentTerminalFailureFact({
      status: "failed",
      error: cleanup.accepted
        ? "Computer results or process termination could not be confirmed. Original command receipts and saved results are retained."
        : "Computer cleanup has not acknowledged Stop. Original command receipts and saved results are retained; process termination is unknown.",
    }),
    code: REMOTE_AGENT_COMPUTER_CLEANUP_FAILED_CODE,
    ...(reviewed === computerFinishFingerprint(cleanup.state) &&
    input.assistantText?.trim()
      ? { explanationText: input.assistantText.trim() }
      : {}),
    computerCleanup: {
      stopAccepted: cleanup.accepted,
      automaticRetryPaused:
        cleanup.nextAttemptAtMs === null &&
        (!cleanup.accepted ||
          (!cleanup.computerName &&
            !!cleanup.state &&
            (cleanup.state.unfinished > 0 ||
              cleanup.state.pendingResults > 0)) ||
          !!cleanup.state?.commands.some(
            (command) =>
              command.collection?.nextAttemptAtMs === null &&
              !command.resultUnavailable &&
              !(command.terminationConfirmed && command.filesSynced)
          )),
      state: cleanup.state,
    },
  };
}

export async function retryComputerCleanupHandoffs(
  input: Omit<CleanupInput, "context">
): Promise<number | null> {
  const handoffs = await input.storage.list<ComputerCleanupHandoff>({
    prefix: CLEANUP_PREFIX,
  });
  let nextDueAtMs: number | null = null;
  for (const handoff of handoffs.values()) {
    if (handoff.nextAttemptAtMs === null) {
      continue;
    }
    let current = handoff;
    if (handoff.nextAttemptAtMs <= Date.now()) {
      const context = await readRemoteAgentCallbackContext(
        input.storage,
        handoff.submissionId
      );
      if (context || handoff.computerName) {
        current =
          (await requestComputerCleanup({
            ...input,
            context,
            retained: handoff,
          })) ?? handoff;
      } else {
        // Missing routing authority cannot be repaired by a hot alarm loop.
        current = { ...handoff, nextAttemptAtMs: null };
        await input.storage.compareAndSet(
          CLEANUP_PREFIX + handoff.submissionId,
          handoff,
          current
        );
        console.warn("[remote_agent.computer_cleanup.identity_unavailable]", {
          submissionId: handoff.submissionId,
        });
      }
    }
    if (current.nextAttemptAtMs !== null) {
      nextDueAtMs = Math.min(
        nextDueAtMs ?? Number.POSITIVE_INFINITY,
        current.nextAttemptAtMs
      );
    }
  }
  return nextDueAtMs;
}

async function inspectCleanupInvocation(
  input: CleanupInput,
  requestStop = false
) {
  if (input.context) {
    return await inspectRemoteAgentComputerInvocation({
      ...input,
      context: input.context,
      requestStop,
    });
  }
  if (!(input.retained?.computerName && input.env?.AGENT_COMPUTER)) {
    throw new Error("computer.cleanup_identity_unavailable");
  }
  const namespace = input.env.AGENT_COMPUTER as AgentComputerNamespace;
  const target = namespace.get(
    namespace.idFromName(input.retained.computerName)
  ) as DurableObjectStub<AgentComputer>;
  return cloudComputerInvocationStateSchema.parse(
    requestStop
      ? await target.requestComputerCleanup(
          input.retained.submissionId,
          input.resume
        )
      : await target.readComputerInvocation(input.retained.submissionId)
  );
}

async function boundedComputerRead<T>(read: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("computer.cleanup_observation_timeout")),
          5000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
