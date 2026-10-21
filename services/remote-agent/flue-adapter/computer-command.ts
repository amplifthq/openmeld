import { setTimeout as delay } from "node:timers/promises";
import type {
  WorkspaceClient,
  WorkspaceRuntimeExecHandle,
  WorkspaceRuntimeValue,
} from "@cloudflare/computer";
import { WorkspaceSyncPendingError } from "@cloudflare/computer";
import {
  type CloudComputerCommandCollection,
  type CloudComputerCommandObservation,
  type CloudComputerCommandPhase,
  type CloudComputerCommandPreparation,
  type CloudComputerCommandReference,
  type CloudComputerInvocationState,
  type CloudComputerOperation,
  cloudComputerCleanupResultSchema,
  cloudComputerCommandErrorSchema,
  cloudComputerCommandPreparationSchema,
  cloudComputerCommandSchema,
  cloudComputerInvocationStateSchema,
} from "@openmeld/schemas";
import {
  boolean,
  integer,
  maxValue,
  minLength,
  minValue,
  number,
  optional,
  picklist,
  pipe,
  record,
  strictObject,
  string,
  unknown,
} from "valibot";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import { remoteAgentDiagnosticErrorFields } from "../agent-core/diagnostics-content-policy";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  type AgentComputerNamespace,
  type AgentComputerWorkspaceAccess,
  createAgentComputerWorkspaceAccess,
} from "./agent-computer-workspace-access";
import { buildComputerCommandProcess } from "./computer-command-process";
import {
  COMPUTER_COMMAND_PREFIX,
  type ComputerCommandSqlStorage,
} from "./computer-command-storage";
import { resolveRemoteAgentComputerName } from "./computer-identity";
import { AGENT_COMPUTER_CONTAINER_BACKEND_ID } from "./computer-workspace-config";

const COMPUTER_TARGET_PREFIX = "openmeld:computer-target:";
export async function readBoundComputerName(
  storage: RemoteAgentStorage,
  submissionId: string
) {
  return await storage.get<string>(COMPUTER_TARGET_PREFIX + submissionId);
}

export async function bindComputerCommandTarget(input: {
  storage: RemoteAgentStorage;
  submissionId: string;
  computerName: string;
}) {
  const key = `${COMPUTER_TARGET_PREFIX}${input.submissionId}`;
  await input.storage.putIfAbsent(key, input.computerName);
  if ((await input.storage.get(key)) !== input.computerName) {
    throw new Error("computer.task_target_changed");
  }
}

export async function readComputerTarget(input: {
  context: Pick<RemoteAgentCallbackContext, "submissionId">;
  storage: RemoteAgentStorage;
  env?: { AGENT_COMPUTER?: unknown };
}) {
  const name = await input.storage.get<string>(
    `${COMPUTER_TARGET_PREFIX}${input.context.submissionId}`
  );
  if (!name) {
    return null;
  }
  if (!input.env?.AGENT_COMPUTER) {
    throw new Error("computer.binding_unavailable");
  }
  const namespace = input.env.AGENT_COMPUTER as AgentComputerNamespace;
  return namespace.get(namespace.idFromName(name)) as DurableObjectStub<
    import("./computer-workspace").AgentComputer
  >;
}
const MAX_OUTPUT_CHARS = 50_000;
const OBSERVATION_SETUP_BUDGET_MS = 5000;
const STOP_INSPECTION_BUDGET_MS = 1000;
const READER_CANCEL_BUDGET_MS = 100;
const COLLECTION_CONCURRENCY = 4;
const COLLECTION_BATCH_SIZE = 16;
const COLLECTION_INTERVAL_MS = 15_000;
const SYNC_CONTINUATION_INTERVAL_MS = 250;
const COLLECTION_ATTEMPT_BUDGET = 8;
const COLLECTION_POLL_WAIT_SECONDS = 1;
const COMMAND_RECORD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const COMMAND_ACTIONS = ["start", "poll", "stop", "list"] as const;
const COMMAND_DIAGNOSTIC_PHASES = [
  "workspace-acquisition",
  "launch",
  "poll",
  "stop",
  "cleanup",
] as const;
// Flue requires an object at the tool boundary. The action-specific schema
// in packages/schemas is the shared execution validator, including forbidden fields.
const commandToolSchema = strictObject({
  action: picklist(COMMAND_ACTIONS),
  includeReceiptDetails: optional(boolean()),
  key: optional(pipe(string(), minLength(1))),
  reference: optional(
    strictObject({
      invocationId: pipe(string(), minLength(1)),
      key: pipe(string(), minLength(1)),
      id: pipe(string(), minLength(1)),
      backend: picklist(["container", "worker-shell", "worker-javascript"]),
    })
  ),
  command: optional(pipe(string(), minLength(1))),
  backend: optional(
    picklist(["container", "worker-shell", "worker-javascript"])
  ),
  env: optional(record(string(), string())),
  stdin: optional(string()),
  input: optional(unknown()),
  signal: optional(picklist(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"])),
  timeoutSeconds: optional(
    pipe(number(), integer(), minValue(1), maxValue(3600))
  ),
  after: optional(pipe(number(), minValue(0))),
  waitSeconds: optional(pipe(number(), integer(), minValue(0), maxValue(20))),
});

type Command = {
  id: string;
  key: string;
  fingerprint: string;
  createdAt: number;
  preparation?: {
    request: StartCommand;
    workingDirectory: string;
    requiresDirectory?: boolean;
    progress?: CloudComputerCommandPreparation;
  };
  recordExpiresAtMs?: number;
  launchRequestedAt?: number;
  launchAcknowledgedAt?: number;
  observedAt?: number;
  exitedAt?: number;
  stopRequested?: boolean;
  stopSignal?: "SIGTERM" | "SIGKILL" | "SIGINT" | "SIGHUP";
  stopSentAt?: number;
  lossReported?: boolean;
  lostDuringCleanup?: boolean;
  completed?: boolean;
  terminalResult?: CommandResult;
  observation?: CommandResult;
  output?: { after: number; stdout: string; stderr: string }[];
  syncProgress?: { generation: string; checkpoint?: string };
  loss?: "ENOENT" | "EEXEC_LOST";
  lossConfirmed?: boolean;
  collectable?: boolean;
  backend?: "container" | "worker-shell" | "worker-javascript";
  collection?: CloudComputerCommandCollection;
};
export type ComputerCommandRecord = Command;
type CommandResult = {
  id: string;
  key: string;
  status: "running" | "completed";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  after: number;
  outputPending?: true;
  outputTruncated?: true;
  syncPending?: true;
  syncError?: "ENOENT" | "EEXEC_LOST" | "ESYNC_READ_ONLY";
  syncSkipped?: { paths: string[]; truncated: boolean };
  nextAction?: "inspect" | "done" | "poll";
  result?: WorkspaceRuntimeValue;
};

type CommandSync = Awaited<
  ReturnType<WorkspaceRuntimeExecHandle<"utf8">["result"]>
>["sync"];

function publicCommandResult(result: unknown) {
  // Keep the durable refusal terminal. Installed clients understand pending
  // sync with an inspect action; newer readers also receive refused paths.
  if (
    result &&
    typeof result === "object" &&
    "syncError" in result &&
    result.syncError === "ESYNC_READ_ONLY"
  ) {
    const { syncError: _, ...retained } = result;
    return { ...retained, syncPending: true, nextAction: "inspect" };
  }
  return result;
}

function synchronizedObservation(
  receipt: CommandResult,
  sync: Extract<CommandSync, { status: "complete" }>
): CommandResult {
  const {
    syncPending: _pending,
    syncError: _error,
    nextAction: _action,
    ...completed
  } = receipt;
  if (sync.skipped.length === 0) {
    return { ...completed, status: "completed" };
  }
  return {
    ...completed,
    status: "running",
    syncError: "ESYNC_READ_ONLY",
    nextAction: "inspect",
    syncSkipped: {
      paths: sync.skipped.slice(0, 16).map((entry) => entry.path),
      truncated: sync.skippedTruncated === true || sync.skipped.length > 16,
    },
  };
}

/** Bound external observation, including Workspace acquisition and disposal.
 * A timeout never establishes process loss or authorizes another launch. */
class ComputerObservationTimeoutError extends Error {
  readonly code = "computer.observation_timeout";
  readonly phase: CloudComputerCommandObservation["phase"];
  constructor(phase: ComputerObservationTimeoutError["phase"]) {
    super(
      "Computer command observation timed out. The command may still be running. Poll the same key; do not start it again."
    );
    this.phase = phase;
  }
}

async function withCommandWorkspace<T>(input: {
  access: AgentComputerWorkspaceAccess;
  budgetMs: number;
  observationDeadlineMs?: number;
  phase: "launch" | "poll" | "stop" | "cleanup";
  signal?: AbortSignal;
  operation: (workspace: WorkspaceClient, signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  let phase: ComputerObservationTimeoutError["phase"] = "workspace-acquisition";
  const timeout = new AbortController();
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeout.signal])
    : timeout.signal;
  const abortObservation = () =>
    timeout.abort(new ComputerObservationTimeoutError(phase));
  const budgetMs = Math.min(
    input.budgetMs,
    input.observationDeadlineMs === undefined
      ? input.budgetMs
      : Math.max(0, input.observationDeadlineMs - Date.now())
  );
  const timer = setTimeout(abortObservation, budgetMs);
  if (budgetMs === 0) {
    abortObservation();
  }
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
  });
  try {
    if (signal.aborted) {
      return await cancelled;
    }
    return await Promise.race([
      input.access.withWorkspace(async (workspace) => {
        signal.throwIfAborted();
        phase = input.phase;
        // Dispose the acquired Workspace even if a native RPC never settles.
        return await Promise.race([
          input.operation(workspace, signal),
          cancelled,
        ]);
      }),
      cancelled,
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) {
      signal.removeEventListener("abort", abort);
    }
  }
}

class MissingComputerExecRecordError extends Error {
  readonly code = "ENOENT";

  constructor(id: string, cause: unknown) {
    super(`Computer execution record ${id} is missing.`, { cause });
    this.name = "MissingComputerExecRecordError";
  }
}

class ComputerAdmissionDeclinedError extends Error {}

function isCommandLoss(
  error: unknown
): error is Error & { code: "ENOENT" | "EEXEC_LOST" } {
  return (
    error instanceof MissingComputerExecRecordError ||
    error instanceof ConfirmedLostComputerCommandsError ||
    hasErrorCode(error, "EEXEC_LOST")
  );
}

function recordExit(
  result: CommandResult,
  event: { code: number; result?: WorkspaceRuntimeValue }
) {
  result.exitCode = event.code;
  if (event.result !== undefined) {
    result.result = event.result;
  }
}

export class ConfirmedLostComputerCommandsError extends AggregateError {
  readonly code: "ENOENT" | "EEXEC_LOST";

  constructor(errors: unknown[]) {
    super(
      errors,
      "Computer command cleanup failed: a retained execution was confirmed lost."
    );
    this.name = "ConfirmedLostComputerCommandsError";
    this.code = errors.some((error) => hasErrorCode(error, "EEXEC_LOST"))
      ? "EEXEC_LOST"
      : "ENOENT";
  }
}

function commandPrefix(submissionId: string): string {
  return `${COMPUTER_COMMAND_PREFIX}${encodeURIComponent(submissionId)}:`;
}

type StartCommand = Extract<
  Extract<CloudComputerOperation, { action: "command" }>["command"],
  { action: "start" }
>;

function commandBackend(command: Pick<Command, "backend">) {
  return command.backend ?? AGENT_COMPUTER_CONTAINER_BACKEND_ID;
}

function commandReceiptAddress(command: Command, invocationId: string) {
  const result = command.observation ?? command.terminalResult;
  let phase: CloudComputerCommandPhase = "accepted";
  if (isCommandComplete(command)) {
    phase = "completed";
  } else if (
    command.loss ||
    isConfirmedCommandLoss(command) ||
    result?.syncError
  ) {
    phase = "result_unavailable";
  } else if (result?.syncPending) {
    phase = "sync_pending";
  } else if (result && result.exitCode !== null) {
    phase = "process_exited";
  } else if (result || command.launchAcknowledgedAt !== undefined) {
    phase = "running";
  } else if (command.launchRequestedAt !== undefined || command.collectable) {
    phase = "launch_unknown";
  }
  return {
    reference: {
      invocationId,
      key: command.key,
      id: command.id,
      backend: commandBackend(command),
    } satisfies CloudComputerCommandReference,
    phase,
    ...(command.preparation?.progress
      ? { preparation: command.preparation.progress }
      : {}),
    ...(command.collection
      ? {
          collection: {
            // Installed CLI readers strictly validate these two fields.
            // Active observation belongs to the internal invocation view.
            unconfirmedAttempts: command.collection.unconfirmedAttempts,
            nextAttemptAtMs: isCollectableCommand(command)
              ? command.collection.nextAttemptAtMs
              : null,
          },
        }
      : {}),
    ...(command.recordExpiresAtMs !== undefined
      ? { recordExpiresAtMs: command.recordExpiresAtMs }
      : {}),
  };
}

function commandRequestError(value: unknown) {
  const failure = cloudComputerCommandErrorSchema.parse(value);
  return Object.assign(
    new Error(
      `HTTP ${failure.status}: ${JSON.stringify({ ok: false, error: failure })}`,
      { cause: failure }
    ),
    { code: failure.code, status: failure.status }
  );
}

function assertCommandReference(
  reference: CloudComputerCommandReference | undefined,
  command: Command,
  invocationId: string
) {
  if (
    reference &&
    (reference.invocationId !== invocationId ||
      reference.key !== command.key ||
      reference.id !== command.id ||
      reference.backend !== commandBackend(command))
  ) {
    throw commandRequestError({
      status: 409,
      code: "computer.command_reference_mismatch",
      message:
        "The command reference does not match this invocation's receipt. Use the original reference.",
    });
  }
}

function isCommandComplete(command: Command) {
  return (
    command.observation?.status === "completed" || command.completed === true
  );
}

function hasCommandExited(command: Command) {
  const receipt = command.observation ?? command.terminalResult;
  return Boolean(receipt && receipt.exitCode !== null);
}

function canResumeRetainedSync(command: Command) {
  return (
    hasCommandExited(command) &&
    command.observation?.syncPending === true &&
    command.observation.syncError === "ENOENT" &&
    command.loss !== "EEXEC_LOST"
  );
}

function commandDiagnostics(command?: Command) {
  return {
    commandId: command?.id,
    backend: command ? commandBackend(command) : undefined,
    createdAt: command?.createdAt,
    observedAt: command?.observedAt,
    exitedAt: command?.exitedAt,
    exitCode: command?.observation?.exitCode,
    syncPending: command?.observation?.syncPending,
    syncError: command?.observation?.syncError,
    stopRequested: command?.stopRequested,
    stopSignal: command?.stopSignal,
    stopSentAt: command?.stopSentAt,
    loss: command?.loss,
  };
}

function isConfirmedCommandLoss(command: Command) {
  return command.loss === "EEXEC_LOST" || command.lossConfirmed === true;
}

function isReportedCommandLoss(command: Command) {
  return command.lossReported && isConfirmedCommandLoss(command);
}

function acceptsObservation(
  command: Command,
  result: CommandResult,
  after: number
) {
  const previous = command.observation;
  if (!previous) {
    return true;
  }
  return (
    previous.status !== "completed" &&
    !(
      previous.syncError &&
      result.status !== "completed" &&
      !(
        previous.syncError === "ENOENT" &&
        result.syncError === "ESYNC_READ_ONLY"
      )
    ) &&
    after >= previous.after &&
    !(previous.syncPending && result.exitCode === null)
  );
}

function retainOutput(output: NonNullable<Command["output"]>) {
  let stdout = 0;
  let stderr = 0;
  let clipped = output.length > 1000;
  const retained: NonNullable<Command["output"]> = [];
  for (const chunk of output.slice(-1000).reverse()) {
    const out =
      stdout >= MAX_OUTPUT_CHARS
        ? ""
        : chunk.stdout.slice(-(MAX_OUTPUT_CHARS - stdout));
    const err =
      stderr >= MAX_OUTPUT_CHARS
        ? ""
        : chunk.stderr.slice(-(MAX_OUTPUT_CHARS - stderr));
    clipped ||=
      out.length !== chunk.stdout.length || err.length !== chunk.stderr.length;
    if (out || err) {
      retained.push({ after: chunk.after, stdout: out, stderr: err });
    }
    stdout += out.length;
    stderr += err.length;
  }
  return { output: retained.reverse(), clipped };
}

function mergeCommandObservation(
  command: Command,
  result: CommandResult,
  exitSequence?: number
): Command {
  if (!acceptsObservation(command, result, exitSequence ?? result.after)) {
    return command;
  }
  const previous = command.observation;
  const output = [...(command.output ?? [])];
  if (result.after > (previous?.after ?? 0)) {
    output.push({
      after: result.after,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  const retained = retainOutput(output);
  const clipped =
    retained.clipped || previous?.outputTruncated || result.outputTruncated;
  const observation: CommandResult = {
    ...result,
    after: Math.max(previous?.after ?? 0, exitSequence ?? result.after),
    stdout: "",
    stderr: "",
    ...(clipped ? { outputTruncated: true } : {}),
  };
  const {
    loss: _loss,
    lossReported: _reported,
    lossConfirmed: _confirmed,
    lostDuringCleanup: _cleanupLoss,
    ...retainedCommand
  } = command;
  const observedAt = Date.now();
  return {
    ...retainedCommand,
    ...(result.status !== "completed" && command.lossConfirmed
      ? { lossConfirmed: true }
      : {}),
    ...(result.status !== "completed" && command.lostDuringCleanup
      ? { lostDuringCleanup: true }
      : {}),
    collectable: true,
    observedAt,
    collection: {
      unconfirmedAttempts: 0,
      nextAttemptAtMs:
        result.status === "completed"
          ? null
          : observedAt + COLLECTION_INTERVAL_MS,
    },
    ...(result.exitCode !== null && !command.exitedAt
      ? { exitedAt: observedAt }
      : {}),
    observation,
    output: retained.output,
  };
}

function launchBudgetMs(request: StartCommand, created: boolean) {
  if (!created) {
    return OBSERVATION_SETUP_BUDGET_MS + 1000;
  }
  return request.backend === "worker-shell"
    ? (request.timeoutSeconds ?? 300) * 1000 + OBSERVATION_SETUP_BUDGET_MS
    : 60_000;
}

function isCollectableCommand(command: Command) {
  return (
    command.collectable !== undefined &&
    !(
      isCommandComplete(command) ||
      command.lossConfirmed ||
      command.loss === "EEXEC_LOST" ||
      command.observation?.syncError ||
      command.lostDuringCleanup ||
      command.backend === "worker-shell"
    )
  );
}

function stopPreparedCommand(command: Command): Command {
  if (
    !(command.stopRequested && command.preparation) ||
    command.launchRequestedAt !== undefined
  ) {
    return command;
  }
  return {
    ...command,
    preparation: undefined,
    completed: true,
    terminalResult: {
      id: command.id,
      key: command.key,
      status: "completed",
      exitCode: null,
      stdout: "",
      stderr: "Stopped before execution.",
      after: 0,
      nextAction: "done",
    },
    collection: { unconfirmedAttempts: 0, nextAttemptAtMs: null },
  };
}

function resumeCommandPreparation(
  command: Command,
  claimed: boolean,
  stopped: boolean,
  progress: WorkspaceSyncPendingError["progress"],
  expectedProgress: CloudComputerCommandPreparation | undefined
): Command {
  // A concurrent preparation page cannot release another call's dispatch
  // claim. The owning call needs explicit SDK proof that it did not dispatch.
  if (
    isCommandComplete(command) ||
    !command.preparation ||
    (!claimed && command.launchRequestedAt !== undefined)
  ) {
    return command;
  }
  const previous = command.preparation.progress;
  // An older SDK result must not overwrite a newer persisted page after its
  // compare-and-set retries. Opaque checkpoints cannot order those results.
  const candidateProgress =
    JSON.stringify(previous) === JSON.stringify(expectedProgress)
      ? projectCommandPreparation(progress)
      : previous;
  // A synthetic pre-dispatch refusal has no sync checkpoint. Keep the last
  // confirmed observation so it cannot turn the next generation into a false
  // "first checkpoint" that repeatedly resets the observation budget.
  const nextProgress =
    previous?.checkpoint !== undefined &&
    candidateProgress?.generation === "" &&
    candidateProgress.checkpoint === undefined
      ? previous
      : candidateProgress;
  const confirmedProgress =
    nextProgress?.checkpoint !== undefined &&
    (previous?.checkpoint === undefined ||
      (previous.generation === nextProgress.generation &&
        previous.checkpoint !== nextProgress.checkpoint));
  return stopPreparedCommand({
    ...command,
    preparation: {
      ...command.preparation,
      progress: nextProgress,
    },
    launchRequestedAt: undefined,
    ...(stopped ? { stopRequested: true } : {}),
    collection: confirmedProgress
      ? {
          unconfirmedAttempts: 0,
          nextAttemptAtMs: Date.now() + SYNC_CONTINUATION_INTERVAL_MS,
        }
      : (command.collection ?? {
          unconfirmedAttempts: 0,
          nextAttemptAtMs: Date.now() + COLLECTION_INTERVAL_MS,
        }),
  });
}

function projectCommandPreparation(
  progress: WorkspaceSyncPendingError["progress"]
): CloudComputerCommandPreparation {
  return cloudComputerCommandPreparationSchema.parse({
    ...(progress.phase === undefined ? {} : { phase: progress.phase }),
    generation: progress.generation,
    ...("checkpoint" in progress && typeof progress.checkpoint === "string"
      ? { checkpoint: progress.checkpoint }
      : {}),
    cursorRevision: progress.cursor.rev,
    targetRevision: progress.targetCursor.rev,
    entries: progress.entries,
    bytes: progress.bytes,
    skipped: progress.skipped,
  });
}

function isPreDispatchPending(
  error: unknown
): error is WorkspaceSyncPendingError {
  return (
    error instanceof WorkspaceSyncPendingError &&
    error.progress.direction === "push"
  );
}

function assertCommandMatches(command: Command, fingerprint: string) {
  if (command.fingerprint !== fingerprint) {
    throw new Error(
      "Computer command key already belongs to a different command. Its process was not changed."
    );
  }
  if (command.stopRequested) {
    throw new Error(
      "Computer command was already stopped; its key cannot start a new process."
    );
  }
}

async function updateCommand(
  storage: RemoteAgentStorage,
  key: string,
  update: (current: Command) => Command
): Promise<Command> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await storage.get<Command>(key);
    if (!current) {
      throw new Error("Computer command receipt is missing.");
    }
    const next = update(current);
    const expiresAtMs = Date.now() + COMMAND_RECORD_RETENTION_MS;
    const retained = { ...next, recordExpiresAtMs: expiresAtMs };
    if (
      next === current ||
      (await storage.compareAndSetExpiring(key, current, retained, expiresAtMs))
    ) {
      return next === current ? current : retained;
    }
  }
  throw new Error(
    "Computer command receipt changed concurrently. Read it again before retrying."
  );
}

async function commandFingerprint(request: StartCommand, cwd: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify({
            command: request.command,
            cwd,
            timeoutSeconds: request.timeoutSeconds ?? 300,
            ...(request.backend &&
            request.backend !== AGENT_COMPUTER_CONTAINER_BACKEND_ID
              ? { backend: request.backend }
              : {}),
            env: request.env,
            stdin: request.stdin,
            input: request.input,
          })
        )
      )
    )
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hasLaunchEvidence(command: Command) {
  return (
    command.collectable === true ||
    command.launchAcknowledgedAt !== undefined ||
    command.observation !== undefined
  );
}

function hasUnconfirmedAdmission(command: Command) {
  return Boolean(command.preparation && !hasLaunchEvidence(command));
}

function commandPollBudgetMs(command: Command, waitSeconds: number): number {
  return (
    OBSERVATION_SETUP_BUDGET_MS +
    (command.preparation && command.launchRequestedAt === undefined
      ? 0
      : waitSeconds * 1000)
  );
}

function collectionAfterObservation(current: Command): Command {
  if (hasUnconfirmedAdmission(current) || current.observation?.syncPending) {
    // Acceptance and a repeated preparation checkpoint are not native
    // liveness. The preparation owner alone confirms SDK progress.
    return current;
  }
  if (!(isCollectableCommand(current) || current.collection)) {
    return current;
  }
  const collection = {
    unconfirmedAttempts: 0,
    nextAttemptAtMs: isCollectableCommand(current)
      ? Date.now() +
        (current.preparation || current.observation?.syncPending
          ? SYNC_CONTINUATION_INTERVAL_MS
          : COLLECTION_INTERVAL_MS)
      : null,
  };
  return JSON.stringify(collection) === JSON.stringify(current.collection)
    ? current
    : { ...current, collection };
}

/** A native acknowledgement confirms signal delivery, never process exit.
 * Recheck the desired signal when recording it: an older acknowledgement
 * cannot acknowledge a newer request for the same command identity. */
async function sendPendingComputerStop(input: {
  storage: RemoteAgentStorage;
  key: string;
  workspace: WorkspaceClient;
  signal?: AbortSignal;
  force?: boolean;
}): Promise<void> {
  const command = await input.storage.get<Command>(input.key);
  input.signal?.throwIfAborted();
  if (
    !command?.stopRequested ||
    isCommandComplete(command) ||
    hasCommandExited(command) ||
    (!input.force && command.stopSentAt !== undefined)
  ) {
    return;
  }
  const stopSignal = command.stopSignal ?? "SIGTERM";
  await input.workspace.runtime.killExec(command.id, {
    backend: commandBackend(command),
    signal: stopSignal,
  });
  await updateCommand(input.storage, input.key, (current) =>
    current.stopRequested && (current.stopSignal ?? "SIGTERM") === stopSignal
      ? { ...current, stopSentAt: Date.now() }
      : current
  );
}

export function createComputerCommandTool(input: {
  /** Internal collector deadline; never a user cancellation signal. */
  observationDeadlineMs?: number;
  context: Pick<RemoteAgentCallbackContext, "submissionId">;
  storage: RemoteAgentStorage;
  workspaceAccess: AgentComputerWorkspaceAccess;
  workingDirectory: string;
  prepareLaunch?: (workspace: WorkspaceClient) => Promise<void>;
  assertCanStart?: () => Promise<void>;
  scheduleCollection?: () => Promise<void>;
  reportErrors?: boolean;
}): RemoteAgentToolDefinition {
  const prefix = commandPrefix(input.context.submissionId);
  const source = input.reportErrors === false ? "system" : "tool";
  const read = async (key: string) => {
    const command = await input.storage.get<Command>(
      `${prefix}${encodeURIComponent(key)}`
    );
    if (!command) {
      throw commandRequestError({
        status: 404,
        code: "computer.command_not_found",
        message:
          "No Computer command receipt was found for this invocation. Acceptance is unknown. Use list or the original command reference; do not restart automatically.",
      });
    }
    return command;
  };
  const readDiagnosticCommand = async (key: unknown) =>
    typeof key === "string"
      ? await input.storage
          .get<Command>(`${prefix}${encodeURIComponent(key)}`)
          .catch(() => undefined)
      : undefined;
  const saveObservation = async (
    key: string,
    result: CommandResult,
    exitSequence?: number
  ) => {
    return await updateCommand(
      input.storage,
      `${prefix}${encodeURIComponent(key)}`,
      (command) => mergeCommandObservation(command, result, exitSequence)
    );
  };
  const project = (command: Command, after = 0): CommandResult => {
    const result = command.observation ?? command.terminalResult;
    if (!result) {
      if (command.preparation || hasLaunchEvidence(command)) {
        return {
          id: command.id,
          key: command.key,
          status: "running",
          exitCode: null,
          stdout: "",
          stderr: "",
          after,
          outputPending: true,
          nextAction: "poll",
        };
      }
      throw new Error("Computer command has no observation.");
    }
    if (!command.output) {
      return completedResult(result, after);
    }
    const chunks = command.output.filter((chunk) => chunk.after > after);
    return {
      ...result,
      after: Math.max(after, result.after),
      stdout: chunks.map((chunk) => chunk.stdout).join(""),
      stderr: chunks.map((chunk) => chunk.stderr).join(""),
    };
  };
  const reportUnavailableResult = async (command: Command, after = 0) =>
    project(
      input.reportErrors === false
        ? command
        : await updateCommand(
            input.storage,
            `${prefix}${encodeURIComponent(command.key)}`,
            (current) => ({ ...current, lossReported: true })
          ),
      after
    );
  const readLostExecution = async (command: Command, after = 0) => {
    const { outputPending: _pending, ...retained } =
      await reportUnavailableResult(command, after);
    // These bytes are saved observations, not a successful final result or
    // evidence that the replacement runtime can resume the original process.
    return { ...retained, nextAction: "inspect" as const };
  };
  const readSavedResult = async (
    command: Command,
    action: "poll" | "stop",
    after?: number
  ) => {
    const resumesSync = action === "poll" && canResumeRetainedSync(command);
    if (command.observation?.syncError && !resumesSync) {
      return await reportUnavailableResult(command, after);
    }
    if (
      isCommandComplete(command) &&
      (command.observation || command.terminalResult)
    ) {
      return project(command, after);
    }
    if (action === "poll" && !resumesSync && isConfirmedCommandLoss(command)) {
      return await readLostExecution(command, after);
    }
    return undefined;
  };
  const readSyncProof = async (
    workspace: WorkspaceClient,
    command: Command
  ) => {
    const proof = await workspace.executionSync(
      command.id,
      commandBackend(command)
    );
    if (proof?.error) {
      throw Object.assign(
        new Error(
          `${proof.error}: execution file source is no longer available`
        ),
        { code: proof.error }
      );
    }
    return proof;
  };
  const confirmSync = async (
    workspace: WorkspaceClient,
    command: Command,
    signal?: AbortSignal
  ) => {
    const receipt = command.observation;
    if (!receipt?.syncPending) {
      return command;
    }
    try {
      // The retained exit and the SDK's durable sync window are sufficient.
      // Native execution logs may expire while a large file tree is syncing.
      const retained = await readSyncProof(workspace, command);
      const result = retained
        ? { status: "complete" as const, outcome: retained }
        : await workspace.resumeExecutionSync(
            command.id,
            commandBackend(command),
            { executionExited: true }
          );
      signal?.throwIfAborted();
      if (result.status === "pending") {
        const { generation, checkpoint } = result.progress;
        return await updateCommand(
          input.storage,
          `${prefix}${encodeURIComponent(command.key)}`,
          (current) => {
            if (
              isCommandComplete(current) ||
              JSON.stringify(current.syncProgress) !==
                JSON.stringify(command.syncProgress)
            ) {
              return current;
            }
            const previous = current.syncProgress;
            const progressed =
              checkpoint !== undefined &&
              (previous?.checkpoint === undefined ||
                (generation === previous.generation &&
                  checkpoint !== previous.checkpoint));
            return {
              ...current,
              syncProgress: { generation, checkpoint },
              ...(progressed && !current.observation?.syncError
                ? {
                    collection: {
                      unconfirmedAttempts: 0,
                      nextAttemptAtMs:
                        Date.now() + SYNC_CONTINUATION_INTERVAL_MS,
                    },
                  }
                : {}),
            };
          }
        );
      }
      return await saveObservation(
        command.key,
        synchronizedObservation(receipt, {
          status: "complete",
          applied: 0,
          skipped: result.outcome.skipped,
          skippedTruncated: result.outcome.skippedTruncated,
        })
      );
    } catch (error) {
      signal?.throwIfAborted();
      if (
        !(hasErrorCode(error, "ENOENT") || hasErrorCode(error, "EEXEC_LOST"))
      ) {
        throw error;
      }
      const syncError = hasErrorCode(error, "ENOENT") ? "ENOENT" : "EEXEC_LOST";
      // An observed exit is durable evidence. Native retention loss removes
      // sync confirmation, not the already recorded exit or output.
      return await updateCommand(
        input.storage,
        `${prefix}${encodeURIComponent(command.key)}`,
        (current) =>
          isCommandComplete(current) || !current.observation
            ? current
            : {
                ...current,
                loss: syncError,
                lossConfirmed: true,
                ...(input.reportErrors === false ? {} : { lossReported: true }),
                observation: {
                  ...current.observation,
                  syncError,
                  nextAction: "inspect",
                },
              }
      );
    }
  };
  const observe = async (
    workspace: WorkspaceClient,
    command: Command,
    waitMs: number,
    signal?: AbortSignal,
    started?: WorkspaceRuntimeExecHandle<"utf8">
  ) => {
    if (command.observation?.syncError && !canResumeRetainedSync(command)) {
      return input.reportErrors === false
        ? command
        : await updateCommand(
            input.storage,
            `${prefix}${encodeURIComponent(command.key)}`,
            (current) => ({ ...current, lossReported: true })
          );
    }
    if (command.loss === "EEXEC_LOST") {
      throw Object.assign(
        new Error(
          "Computer command result is unavailable. Inspect existing results before deciding whether to repeat any operation."
        ),
        { code: command.loss }
      );
    }
    if (command.observation?.syncPending) {
      return await confirmSync(workspace, command, signal);
    }
    const after = command.observation?.after ?? 0;
    const onExit = async (result: CommandResult, seq: number) => {
      await saveObservation(
        command.key,
        { ...result, status: "running", syncPending: true },
        seq
      );
    };
    const result = started
      ? await readCommandSlice(
          started,
          command.key,
          after,
          waitMs,
          signal,
          onExit
        )
      : await pollComputerCommand(
          workspace.runtime,
          command,
          after,
          waitMs,
          signal,
          onExit
        );
    if (result.exitCode !== null) {
      const current = await read(command.key);
      if (commandBackend(command) !== "container") {
        return await saveObservation(command.key, {
          ...result,
          after: current.observation?.after ?? result.after,
          status: "completed",
        });
      }
      return await confirmSync(workspace, current, signal);
    }
    return await saveObservation(command.key, result);
  };
  const observeAdmission = async (
    workspace: WorkspaceClient,
    command: Command,
    waitMs: number,
    signal: AbortSignal
  ) => {
    try {
      return await observe(workspace, command, waitMs, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof MissingComputerExecRecordError) {
        const current = await read(command.key);
        if (hasUnconfirmedAdmission(current)) {
          // Native admission may still be doing bounded pre-dispatch sync.
          // Absence is not lost output or permission to clear the launch claim.
          // Keep inspecting this identity, including after an uncertain launch.
          return current;
        }
      }
      throw error;
    }
  };
  const launchWasStopped = async (key: string, signal?: AbortSignal) =>
    Boolean((await read(key)).stopRequested || signal?.aborted);
  const observeWithPendingStop = async (
    workspace: WorkspaceClient,
    command: Command,
    waitMs: number,
    signal: AbortSignal
  ) => {
    const deadline = Date.now() + waitMs;
    const current = await read(command.key);
    if (!current.stopRequested || hasCommandExited(current)) {
      return await observeAdmission(workspace, current, waitMs, signal);
    }
    // Inspect queued exit evidence before signalling. A pending Stop should
    // not wait for a live process to produce output before its signal is sent.
    let inspectionError: unknown;
    try {
      const observed = await withCommandWorkspace({
        access: { withWorkspace: (operation) => operation(workspace) },
        budgetMs: STOP_INSPECTION_BUDGET_MS,
        phase: "poll",
        signal,
        operation: (client, inspectionSignal) =>
          observe(client, current, 0, inspectionSignal),
      });
      if (hasCommandExited(observed)) {
        return observed;
      }
    } catch (error) {
      signal.throwIfAborted();
      if (hasErrorCode(error, "EEXEC_LOST")) {
        throw error;
      }
      inspectionError = error;
    }
    try {
      await sendPendingComputerStop({
        storage: input.storage,
        key: `${prefix}${encodeURIComponent(command.key)}`,
        workspace,
        signal,
        force: inspectionError instanceof MissingComputerExecRecordError,
      });
    } catch (error) {
      if (
        inspectionError instanceof MissingComputerExecRecordError &&
        hasErrorCode(error, "ENOENT") &&
        hasLaunchEvidence(current)
      ) {
        throw new ConfirmedLostComputerCommandsError([error]);
      }
      throw error;
    }
    if (inspectionError) {
      throw inspectionError;
    }
    return await observe(
      workspace,
      await read(command.key),
      Math.max(0, deadline - Date.now()),
      signal
    );
  };
  const stopLateLaunch = async (key: string, userSignal?: AbortSignal) => {
    const current = await read(key);
    if (
      (current.stopRequested || userSignal?.aborted) &&
      !hasCommandExited(current)
    ) {
      if (!current.stopRequested) {
        await updateCommand(
          input.storage,
          `${prefix}${encodeURIComponent(key)}`,
          (receipt) => ({ ...receipt, stopRequested: true })
        );
      }
      // The launch acknowledgement can arrive after the original Workspace
      // was disposed. Acquire a fresh client to stop that exact identity.
      await withCommandWorkspace({
        access: input.workspaceAccess,
        budgetMs: OBSERVATION_SETUP_BUDGET_MS,
        phase: "stop",
        operation: (currentWorkspace, stopObservationSignal) =>
          sendPendingComputerStop({
            storage: input.storage,
            key: `${prefix}${encodeURIComponent(key)}`,
            workspace: currentWorkspace,
            signal: stopObservationSignal,
            force: true,
          }),
      });
    }
  };
  const prepareCommandLaunch = async (
    workspace: WorkspaceClient,
    request: StartCommand,
    command: Command,
    observationSignal: AbortSignal,
    userSignal?: AbortSignal
  ): Promise<CommandResult | undefined> => {
    observationSignal.throwIfAborted();
    if (input.prepareLaunch) {
      await input.prepareLaunch(workspace);
    } else if (command.preparation?.requiresDirectory) {
      await workspace.fs.mkdir(command.preparation.workingDirectory, {
        recursive: true,
      });
    }
    observationSignal.throwIfAborted();
    try {
      await input.assertCanStart?.();
    } catch (error) {
      const current = await read(command.key);
      if (current.stopRequested) {
        return project(
          await updateCommand(
            input.storage,
            `${prefix}${encodeURIComponent(command.key)}`,
            stopPreparedCommand
          )
        );
      }
      throw error;
    }
    if (await launchWasStopped(request.key, userSignal)) {
      return project(
        await updateCommand(
          input.storage,
          `${prefix}${encodeURIComponent(command.key)}`,
          (current) => stopPreparedCommand({ ...current, stopRequested: true })
        )
      );
    }
    observationSignal.throwIfAborted();
    return undefined;
  };
  const claimPreparedCommand = async (key: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    await input.assertCanStart?.();
    signal.throwIfAborted();
    let claimed = false;
    await updateCommand(
      input.storage,
      `${prefix}${encodeURIComponent(key)}`,
      (current) => {
        signal.throwIfAborted();
        claimed = false;
        if (
          current.launchRequestedAt !== undefined ||
          current.stopRequested ||
          isCommandComplete(current)
        ) {
          return current;
        }
        claimed = true;
        return { ...current, launchRequestedAt: Date.now() };
      }
    );
    return claimed;
  };
  const launchCommand = async (
    workspace: WorkspaceClient,
    request: StartCommand,
    command: Command,
    observationSignal: AbortSignal,
    userSignal?: AbortSignal
  ): Promise<CommandResult> => {
    // Identity is already durable. Preparation remains replay-safe until the
    // SDK reaches its local native-dispatch boundary and calls admission.
    const stopped = await prepareCommandLaunch(
      workspace,
      request,
      command,
      observationSignal,
      userSignal
    );
    if (stopped) {
      return stopped;
    }
    let claimed = false;
    let handle: WorkspaceRuntimeExecHandle<"utf8">;
    try {
      handle = await workspace.runtime.execWithAdmission(
        request.command,
        {
          ...(command.backend === AGENT_COMPUTER_CONTAINER_BACKEND_ID
            ? { legacySource: buildComputerCommandProcess(request.command) }
            : {}),
          id: command.id,
          backend: command.backend,
          cwd: command.preparation?.workingDirectory ?? input.workingDirectory,
          encoding: "utf8",
          timeoutMs: (request.timeoutSeconds ?? 300) * 1000,
          env: request.env,
          stdin: request.stdin,
          input: request.input,
        },
        async () => {
          claimed = await claimPreparedCommand(command.key, observationSignal);
          if (!claimed) {
            throw new ComputerAdmissionDeclinedError();
          }
        }
      );
    } catch (error) {
      if (error instanceof ComputerAdmissionDeclinedError) {
        return project(await read(command.key));
      }
      // Only the SDK's local pre-dispatch owner can prove execution never
      // started. A timeout, remote error, or missing handle cannot clear this.
      if (!isPreDispatchPending(error)) {
        throw error;
      }
      const preparing = await updateCommand(
        input.storage,
        `${prefix}${encodeURIComponent(command.key)}`,
        (current) =>
          resumeCommandPreparation(
            current,
            claimed,
            userSignal?.aborted === true,
            error.progress,
            command.preparation?.progress
          )
      );
      await input.scheduleCollection?.();
      return project(preparing);
    }
    await updateCommand(
      input.storage,
      `${prefix}${encodeURIComponent(command.key)}`,
      (current) => ({
        ...current,
        collectable: true,
        preparation: undefined,
        launchAcknowledgedAt: Date.now(),
      })
    );
    await input.scheduleCollection?.();
    let result: CommandResult;
    try {
      observationSignal.throwIfAborted();
      result = project(
        await observe(workspace, command, 1000, observationSignal, handle)
      );
    } finally {
      handle[Symbol.dispose]();
      await stopLateLaunch(request.key, userSignal);
    }
    if (await launchWasStopped(request.key, userSignal)) {
      throw new Error("Computer command was stopped during launch.");
    }
    return {
      ...result,
      nextAction:
        result.nextAction ?? (result.status === "completed" ? "done" : "poll"),
    };
  };
  const startCommand = async (request: StartCommand, signal?: AbortSignal) => {
    await input.assertCanStart?.();
    const key = `${prefix}${encodeURIComponent(request.key)}`;
    const fingerprint = await commandFingerprint(
      request,
      input.workingDirectory
    );
    const candidate: Command = {
      id: crypto.randomUUID(),
      key: request.key,
      fingerprint,
      createdAt: Date.now(),
      preparation: {
        request,
        workingDirectory: input.workingDirectory,
        requiresDirectory: input.prepareLaunch !== undefined,
      },
      backend: request.backend ?? AGENT_COMPUTER_CONTAINER_BACKEND_ID,
      collectable: false,
    };
    candidate.recordExpiresAtMs =
      candidate.createdAt + COMMAND_RECORD_RETENTION_MS;
    const created = await input.storage.putIfAbsentExpiring(
      key,
      candidate,
      candidate.createdAt + COMMAND_RECORD_RETENTION_MS
    );
    // Arm recovery before spawn or any other external I/O. Pending launches
    // can be inspected, but an absent record does not prove dispatch failed.
    await input.scheduleCollection?.();
    const command = created ? candidate : await read(request.key);
    assertCommandMatches(command, fingerprint);
    if (
      isCommandComplete(command) &&
      (command.observation || command.terminalResult)
    ) {
      return project(command);
    }
    if (command.observation?.syncError) {
      return await reportUnavailableResult(command);
    }
    return await withCommandWorkspace({
      access: input.workspaceAccess,
      budgetMs: launchBudgetMs(request, created),
      phase: created ? "launch" : "poll",
      signal,
      operation: (workspace, observationSignal) =>
        command.preparation && command.launchRequestedAt === undefined
          ? launchCommand(
              workspace,
              request,
              command,
              observationSignal,
              signal
            )
          : observeAdmission(workspace, command, 1000, observationSignal).then(
              (current) => project(current)
            ),
    });
  };
  const stopCommand = async (
    request: Extract<
      CloudComputerOperation,
      { action: "command" }
    >["command"] & { action: "stop" },
    command: Command,
    signal?: AbortSignal
  ) => {
    if (command.backend === "worker-shell") {
      throw new Error(
        "computer.cancellation_unsupported: worker-shell runs in the foreground and cannot be interrupted. Wait for its result or timeout. Use container or worker-javascript for cancellable work."
      );
    }
    // Retain Stop before acquisition. A pending launch must see it even when
    // this call cannot acquire a native client within its observation budget.
    const current = await updateCommand(
      input.storage,
      `${prefix}${encodeURIComponent(command.key)}`,
      (current) => {
        const stopSignal = request.signal ?? "SIGTERM";
        return {
          ...current,
          stopRequested: true,
          stopSignal,
          ...((current.stopSignal ?? "SIGTERM") === stopSignal
            ? {}
            : { stopSentAt: undefined }),
        };
      }
    );
    if (isCommandComplete(current)) {
      return project(current);
    }
    if (current.preparation && current.launchRequestedAt === undefined) {
      const stopped = await updateCommand(
        input.storage,
        `${prefix}${encodeURIComponent(command.key)}`,
        stopPreparedCommand
      );
      if (isCommandComplete(stopped)) {
        return project(stopped);
      }
    }
    if (!hasCommandExited(current)) {
      await withCommandWorkspace({
        access: input.workspaceAccess,
        budgetMs: OBSERVATION_SETUP_BUDGET_MS,
        phase: "stop",
        signal,
        operation: (workspace, observationSignal) =>
          sendPendingComputerStop({
            storage: input.storage,
            key: `${prefix}${encodeURIComponent(command.key)}`,
            workspace,
            signal: observationSignal,
          }),
      });
    }
    return {
      id: command.id,
      key: command.key,
      status: "stop_requested",
      nextAction: "poll",
    };
  };
  const definition: RemoteAgentToolDefinition = {
    name: "computer_command",
    description:
      "Run commands on your personal Computer. start accepts key, command, backend (container by default, worker-shell or worker-javascript), env, stdin, structured input, and timeoutSeconds. JavaScript source exports a default function; its returned JSON is in result. worker-shell completes before returning and cannot be interrupted or reattached. Use container or worker-javascript for long or cancellable execution. Replies keep bounded recent output and flag outputTruncated. Redirect large output to a persistent file. Start once with a stable key, then poll using the returned after cursor until completed. syncPending means the process exited but file synchronization is not confirmed. Continue polling unless syncError or nextAction inspect is present. syncError preserves the known exit and output. syncSkipped lists paths refused by read-only storage; other files may be saved. syncPending with nextAction inspect is a terminal synchronization refusal, not a reason to keep polling. Sync errors mean file synchronization could not be confirmed. Stop polling and inspect persistent files. Process exit does not prove file synchronization succeeded. The Computer saves results independently of model polling. list recovers this invocation's keys. stop sends signal (SIGTERM by default); stop_requested is not confirmed exit. A repeated start never launches twice. After a transport error or missing execution record, inspect existing results before deciding what can safely be repeated. Report any unresolved work in your final answer. Cancellation cleans up only this task's commands. Do not add shell backgrounding to evade command lifecycle. Use computer for files, capability details or a different cwd.",
    input: commandToolSchema,
    async execute(rawInput, options) {
      options?.signal?.throwIfAborted();
      const request = cloudComputerCommandSchema.parse(rawInput);
      if (request.action === "list") {
        return [
          ...(await input.storage.list<Command>({ prefix })).values(),
        ].map((command) => {
          // Older list readers use a strict object, unlike poll/start results.
          const { preparation: _preparation, ...receipt } =
            commandReceiptAddress(command, input.context.submissionId);
          return {
            key: command.key,
            id: command.id,
            createdAt: command.createdAt,
            ...(request.includeReceiptDetails ? receipt : {}),
          };
        });
      }
      if (request.action === "start") {
        return await startCommand(request, options?.signal);
      }
      const command = await read(request.key);
      const after = request.action === "poll" ? request.after : undefined;
      assertCommandReference(
        request.reference,
        command,
        input.context.submissionId
      );
      const saved = await readSavedResult(command, request.action, after);
      if (saved) {
        return saved;
      }
      await input.scheduleCollection?.();
      if (request.action === "stop") {
        return await stopCommand(request, command, options?.signal);
      }
      const waitSeconds = request.waitSeconds ?? 20;
      const preparation = command.preparation;
      if (preparation && command.launchRequestedAt === undefined) {
        return await withCommandWorkspace({
          access: input.workspaceAccess,
          budgetMs: commandPollBudgetMs(command, waitSeconds),
          observationDeadlineMs: input.observationDeadlineMs,
          phase: "launch",
          signal: options?.signal,
          operation: (workspace, observationSignal) =>
            launchCommand(
              workspace,
              preparation.request,
              command,
              observationSignal,
              options?.signal
            ),
        });
      }
      return await withCommandWorkspace({
        access: input.workspaceAccess,
        budgetMs: commandPollBudgetMs(command, waitSeconds),
        observationDeadlineMs: input.observationDeadlineMs,
        phase: "poll",
        signal: options?.signal,
        operation: async (workspace, observationSignal) => {
          return project(
            await observeWithPendingStop(
              workspace,
              command,
              waitSeconds * 1000,
              observationSignal
            ),
            request.after ?? 0
          );
        },
      });
    },
  };
  const logResult = async (
    rawInput: Record<string, unknown>,
    result: unknown
  ) => {
    const receipt =
      result && typeof result === "object"
        ? (result as Record<string, unknown>)
        : {};
    // Background polling logs terminal evidence, not every running tick.
    if (
      source === "tool" ||
      receipt.status === "completed" ||
      receipt.syncError
    ) {
      console.info("[remote_agent.computer_command_result]", {
        source,
        submissionId: input.context.submissionId,
        action: rawInput.action,
        ...commandDiagnostics(await readDiagnosticCommand(rawInput.key)),
        status: receipt.status,
        after: receipt.after,
      });
    }
  };
  const recordFailure = async (
    rawInput: Record<string, unknown>,
    error: unknown
  ) => {
    const command = await readDiagnosticCommand(rawInput.key);
    if (isCommandLoss(error) && command) {
      await updateCommand(
        input.storage,
        `${prefix}${encodeURIComponent(command.key)}`,
        (current) => {
          if (isCommandComplete(current)) {
            return current;
          }
          const lossConfirmed =
            (error instanceof ConfirmedLostComputerCommandsError &&
              hasLaunchEvidence(current)) ||
            error.code === "EEXEC_LOST";
          return {
            ...current,
            ...(current.collectable === false ? {} : { loss: error.code }),
            ...(lossConfirmed ? { lossConfirmed: true } : {}),
            ...(input.reportErrors === false ? {} : { lossReported: true }),
          };
        }
      );
    }
    if (source === "tool" || (isCommandLoss(error) && !command?.loss)) {
      const action =
        COMMAND_ACTIONS.find((candidate) => candidate === rawInput.action) ??
        "invalid_request";
      const reportedPhase =
        error instanceof Error && "phase" in error ? error.phase : undefined;
      console.warn("[remote_agent.computer_command_failed]", {
        source,
        submissionId: input.context.submissionId,
        action,
        ...commandDiagnostics(command),
        phase:
          COMMAND_DIAGNOSTIC_PHASES.find(
            (candidate) => candidate === reportedPhase
          ) ?? action,
        ...remoteAgentDiagnosticErrorFields(error, {}),
      });
    }
  };
  const timedOutObservation = async (
    rawInput: Record<string, unknown>,
    error: unknown
  ) => {
    if (
      source !== "tool" ||
      !(error instanceof ComputerObservationTimeoutError) ||
      (rawInput.action !== "start" && rawInput.action !== "poll")
    ) {
      return undefined;
    }
    const command = await readDiagnosticCommand(rawInput.key);
    if (!command) {
      return undefined;
    }
    // The saved receipt is evidence, not a new successful observation.
    const retained = publicCommandResult(
      project(command, typeof rawInput.after === "number" ? rawInput.after : 0)
    ) as CommandResult;
    return {
      ...retained,
      ...commandReceiptAddress(command, input.context.submissionId),
      observation: {
        status: "timed_out",
        phase: error.phase,
        message:
          "The latest observation timed out. The receipt and preparation checkpoint are the last confirmed state, not proof of current progress. Keep completed output and poll this exact reference; do not restart the command.",
      } satisfies CloudComputerCommandObservation,
    };
  };
  const attachReceipt = (command: Command | undefined, result: unknown) => {
    const publicResult = publicCommandResult(result);
    return command &&
      publicResult &&
      typeof publicResult === "object" &&
      !Array.isArray(publicResult)
      ? {
          ...publicResult,
          ...commandReceiptAddress(command, input.context.submissionId),
        }
      : publicResult;
  };
  const readLostResultAfterFailure = async (
    rawInput: Record<string, unknown>,
    error: unknown
  ) => {
    if (!(source === "tool" && isCommandLoss(error))) {
      return undefined;
    }
    const command = await readDiagnosticCommand(rawInput.key);
    if (!command) {
      return undefined;
    }
    if (rawInput.action === "poll" && isConfirmedCommandLoss(command)) {
      return attachReceipt(
        command,
        await readLostExecution(
          command,
          typeof rawInput.after === "number" ? rawInput.after : 0
        )
      );
    }
    throw commandRequestError({
      status: 404,
      code: "computer.execution_result_unavailable",
      message: `No retained execution result is available for command ${command.id}. Keep its original reference and inspect existing output and files. Do not restart automatically.`,
    });
  };
  return {
    ...definition,
    description: `${definition.description} Replies include reference and phase. Keep the exact reference for later owner inspection; poll and stop validate it against this invocation's saved receipt. list with includeReceiptDetails:true returns references, phases and collection. collection.unconfirmedAttempts counts checks without confirmed native evidence, including interrupted checks. Automatic checks pause when that count reaches ${COLLECTION_ATTEMPT_BUDGET}; nextAttemptAtMs is then null. The process may still be running. Poll the same reference manually; a successful check resumes automatic collection. An accepted receipt is not proof of launch; launch_unknown does not permit replay. Missing receipt means acceptance is unknown, not an unreachable service. recordExpiresAtMs is a retention marker; command reads currently do not enforce it. It does not extend native result retention.`,
    async execute(rawInput, options) {
      try {
        const result = await definition.execute(rawInput, options);
        const observed = await readDiagnosticCommand(rawInput.key);
        if (observed) {
          await updateCommand(
            input.storage,
            `${prefix}${encodeURIComponent(observed.key)}`,
            collectionAfterObservation
          );
          if (source === "tool" && isCollectableCommand(observed)) {
            await input.scheduleCollection?.();
          }
        }
        await logResult(rawInput, result);
        const command = await readDiagnosticCommand(rawInput.key);
        return attachReceipt(command, result);
      } catch (error) {
        await recordFailure(rawInput, error);
        // A bounded read expiring is not an execution failure. Return only the
        // saved owner receipt; do not advance progress, clear admission, or replay.
        const observation = await timedOutObservation(rawInput, error);
        if (observation) {
          return observation;
        }
        const retained = await readLostResultAfterFailure(rawInput, error);
        if (retained) {
          return retained;
        }
        throw error;
      }
    },
  };
}

function completedResult(result: CommandResult, after?: number): CommandResult {
  return after !== undefined && after >= result.after
    ? { ...result, stdout: "", stderr: "" }
    : result;
}

async function clearCollectionObservation(
  storage: RemoteAgentStorage,
  key: string,
  attempt: Command
): Promise<void> {
  await updateCommand(storage, key, (current) => {
    // A newer successful observation owns its own schedule. An older finally
    // can only release the exact reservation that it made before I/O.
    if (
      !current.collection ||
      JSON.stringify(current.collection) !== JSON.stringify(attempt.collection)
    ) {
      return current;
    }
    const { observationExpiresAtMs: _expires, ...collection } =
      current.collection;
    return { ...current, collection };
  });
}

/** Resume preparation or collect retained results under the original command ID.
 * An uncertain execution is inspected, never dispatched again. */
export async function collectComputerCommands(input: {
  storage: ComputerCommandSqlStorage;
  workspaceAccess: AgentComputerWorkspaceAccess;
  assertCanStart?: (submissionId: string) => Promise<void>;
}): Promise<boolean> {
  const remaining = [
    ...(await input.storage.listDueCommands(Date.now(), COLLECTION_BATCH_SIZE)),
  ];
  const collect = async () => {
    for (let next = remaining.shift(); next; next = remaining.shift()) {
      const [key, command] = next;
      if (!isCollectableCommand(command)) {
        continue;
      }
      const submissionId = decodeURIComponent(
        key.slice(COMPUTER_COMMAND_PREFIX.length, key.lastIndexOf(":"))
      );
      // Persist this observation attempt before external I/O. A terminated
      // Worker cannot run catch/finally, so failures counted only there would
      // permit unlimited attempts after each replacement.
      let reserved = false;
      const attempt = await updateCommand(input.storage, key, (current) => {
        reserved = false;
        if (
          !isCollectableCommand(current) ||
          (current.collection?.unconfirmedAttempts ?? 0) >=
            COLLECTION_ATTEMPT_BUDGET ||
          current.collection?.nextAttemptAtMs === null ||
          (current.collection?.nextAttemptAtMs ?? 0) > Date.now() ||
          current.observedAt !== command.observedAt ||
          current.launchAcknowledgedAt !== command.launchAcknowledgedAt ||
          JSON.stringify(current.collection) !==
            JSON.stringify(command.collection)
        ) {
          return current;
        }
        reserved = true;
        const unconfirmedAttempts =
          (current.collection?.unconfirmedAttempts ?? 0) + 1;
        return {
          ...current,
          collection: {
            unconfirmedAttempts,
            observationExpiresAtMs:
              Date.now() +
              commandPollBudgetMs(current, COLLECTION_POLL_WAIT_SECONDS),
            nextAttemptAtMs:
              unconfirmedAttempts >= COLLECTION_ATTEMPT_BUDGET
                ? null
                : Date.now() +
                  Math.min(30_000 * 2 ** (unconfirmedAttempts - 1), 300_000),
          },
        };
      });
      if (!reserved) {
        continue;
      }
      try {
        await createComputerCommandTool({
          ...input,
          context: { submissionId },
          assertCanStart: () =>
            input.assertCanStart?.(submissionId) ?? Promise.resolve(),
          workingDirectory: "/computer",
          reportErrors: false,
          observationDeadlineMs: attempt.collection?.observationExpiresAtMs,
        }).execute({
          action: "poll",
          key: command.key,
          waitSeconds: COLLECTION_POLL_WAIT_SECONDS,
        });
      } catch {
        // The attempt was already counted. A late failure makes no scheduling
        // write and cannot consume a successful manual recovery's budget.
        const current = await input.storage.get<Command>(key);
        if (
          current &&
          isCollectableCommand(current) &&
          current.collection?.nextAttemptAtMs === null &&
          JSON.stringify(current.collection) ===
            JSON.stringify(attempt.collection)
        ) {
          console.warn("[remote_agent.computer_command_collection_paused]", {
            submissionId,
            commandId: current.id,
            backend: commandBackend(current),
            unconfirmedAttempts: current.collection.unconfirmedAttempts,
          });
        }
      } finally {
        await clearCollectionObservation(input.storage, key, attempt);
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(COLLECTION_CONCURRENCY, remaining.length) },
      collect
    )
  );
  return (await input.storage.nextCollectionAt()) !== null;
}

async function pollComputerCommand(
  runtime: WorkspaceClient["runtime"],
  command: Pick<Command, "id" | "key" | "backend">,
  after: number,
  waitMs: number,
  signal?: AbortSignal,
  onExit?: (result: CommandResult, sequence: number) => Promise<void>
): Promise<CommandResult> {
  if (command.backend === "worker-shell") {
    throw new Error(
      "This foreground shell has no saved result. The upstream shell cannot reattach to an execution. Inspect files before deciding any next action; do not repeat the command blindly."
    );
  }
  const deadline = Date.now() + waitMs;
  for (;;) {
    signal?.throwIfAborted();
    let handle: WorkspaceRuntimeExecHandle<"utf8">;
    try {
      handle = await runtime.getExec(command.id, {
        backend: commandBackend(command),
        encoding: "utf8",
        resume: after,
      });
    } catch (error) {
      // computerd emits EEXEC_BUSY only for a live retained process whose
      // output already has a subscriber. Cap'n Web cancellation need not reach
      // a silent producer until its next write. This proves running, not lost
      // execution. Its retained output is replayable when the process exits.
      if (hasErrorCode(error, "ENOENT")) {
        throw new MissingComputerExecRecordError(command.id, error);
      }
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXEC_BUSY"
        )
      ) {
        throw error;
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        await delay(remaining, undefined, { signal });
        continue;
      }
      return {
        id: command.id,
        key: command.key,
        status: "running",
        exitCode: null,
        stdout: "",
        stderr: "",
        after,
        outputPending: true,
      };
    }
    return await readCommandSlice(
      handle,
      command.key,
      after,
      Math.max(0, deadline - Date.now()),
      signal,
      onExit
    );
  }
}

function appendOutput(
  result: CommandResult,
  name: "stdout" | "stderr",
  value: string
) {
  const text = result[name] + value;
  if (text.length > MAX_OUTPUT_CHARS) {
    result.outputTruncated = true;
  }
  result[name] = text.slice(-MAX_OUTPUT_CHARS);
}

async function detachCommandReader(
  handle: WorkspaceRuntimeExecHandle<"utf8">,
  reader: ReadableStreamDefaultReader<unknown>
) {
  const timer = new AbortController();
  try {
    // Cap'n Web can wait for a silent producer's next write. Cancellation is
    // reader detachment, not process termination or new command evidence.
    await Promise.race([
      reader.cancel().catch(() => undefined),
      delay(READER_CANCEL_BUDGET_MS, undefined, { signal: timer.signal }),
    ]);
  } finally {
    timer.abort();
    reader.releaseLock();
    handle[Symbol.dispose]();
  }
}

export async function readCommandSlice(
  handle: WorkspaceRuntimeExecHandle<"utf8">,
  key: string,
  after: number,
  waitMs: number,
  signal?: AbortSignal,
  onExit?: (result: CommandResult, sequence: number) => Promise<void>
): Promise<CommandResult> {
  const reader = handle.getReader();
  const result: CommandResult = {
    id: handle.id,
    key,
    status: "running",
    exitCode: null,
    stdout: "",
    stderr: "",
    after,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let exitSequence: number | undefined;
  const deadline = new Promise<null>((resolve, reject) => {
    timer = setTimeout(() => resolve(null), waitMs);
    if (signal) {
      onAbort = () => reject(signal.reason);
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline]);
      signal?.throwIfAborted();
      if (next === null) {
        break;
      }
      if (next.done) {
        if (result.exitCode === null) {
          throw new Error(
            "Computer command stream ended without an exit receipt."
          );
        }
        result.status = "completed";
        result.after = exitSequence ?? result.after;
        break;
      }
      if (next.value.name === "stdout" || next.value.name === "stderr") {
        result.after = next.value.seq;
        appendOutput(result, next.value.name, next.value.value);
      } else if (next.value.name === "exit") {
        recordExit(result, next.value);
        exitSequence = next.value.seq;
        await onExit?.({ ...result }, exitSequence);
        if (onExit) {
          break;
        }
        // Preserve the exit before waiting for stream closure. The caller must
        // separately inspect the SDK synchronization result before completion.
      }
    }
    return result;
  } finally {
    clearTimeout(timer);
    if (onAbort) {
      signal?.removeEventListener("abort", onAbort);
    }
    await detachCommandReader(handle, reader);
  }
}

export async function listPendingRemoteAgentComputerCommands(input: {
  context: Pick<RemoteAgentCallbackContext, "submissionId">;
  storage: RemoteAgentStorage;
  env?: { AGENT_COMPUTER?: unknown };
}): Promise<string[]> {
  const target = await readComputerTarget(input);
  if (target) {
    return await target.pendingComputerCommands(input.context.submissionId);
  }
  const commands = await input.storage.list<Command>({
    prefix: commandPrefix(input.context.submissionId),
  });
  return [...commands.values()]
    .filter(
      (command) =>
        !(
          isCommandComplete(command) ||
          command.lossReported ||
          command.stopRequested
        )
    )
    .map((command) => command.key);
}

export async function readStoredComputerInvocation(input: {
  context: Pick<RemoteAgentCallbackContext, "submissionId">;
  storage: RemoteAgentStorage;
}): Promise<CloudComputerInvocationState> {
  const receipts = [
    ...(
      await input.storage.list<Command>({
        prefix: commandPrefix(input.context.submissionId),
      })
    ).values(),
  ];
  const commands = receipts.map((command) => {
    const observation = command.observation ?? command.terminalResult;
    const receipt = commandReceiptAddress(command, input.context.submissionId);
    const observationExpiresAtMs = command.collection?.observationExpiresAtMs;
    return {
      ...receipt,
      after: observation?.after ?? 0,
      exitCode: observation?.exitCode ?? null,
      outputRetained:
        !!command.output?.length ||
        !!observation?.stdout ||
        !!observation?.stderr,
      filesSynced: isCommandComplete(command),
      stopRequested: command.stopRequested === true,
      terminationConfirmed:
        isCommandComplete(command) ||
        hasCommandExited(command) ||
        command.lossConfirmed === true ||
        command.loss === "EEXEC_LOST",
      resultUnavailable:
        !!command.loss ||
        !!command.lossReported ||
        !!command.lostDuringCleanup ||
        !!observation?.syncError,
      collection: receipt.collection
        ? {
            ...receipt.collection,
            ...(isCollectableCommand(command) &&
            observationExpiresAtMs !== undefined &&
            observationExpiresAtMs > Date.now()
              ? { observationExpiresAtMs }
              : {}),
          }
        : null,
    };
  });
  return cloudComputerInvocationStateSchema.parse({
    invocationId: input.context.submissionId,
    total: commands.length,
    unfinished: commands.filter((command) => !command.terminationConfirmed)
      .length,
    pendingResults: commands.filter(
      (command) => !(command.filesSynced || command.resultUnavailable)
    ).length,
    unavailable: commands.filter((command) => command.resultUnavailable).length,
    // Unresolved receipts precede completed ones. Counts cover omitted receipts.
    commands: commands
      .sort(
        (a, b) =>
          Number(a.terminationConfirmed) - Number(b.terminationConfirmed)
      )
      .slice(0, 32)
      .map(({ recordExpiresAtMs: _expiry, ...command }) => command),
  });
}

/** Durable Stop handoff only. The existing collector owns all native I/O. */
export async function requestStoredComputerCleanup(input: {
  context: Pick<RemoteAgentCallbackContext, "submissionId">;
  storage: RemoteAgentStorage;
  resume?: boolean;
}): Promise<CloudComputerInvocationState> {
  const commands = await input.storage.list<Command>({
    prefix: commandPrefix(input.context.submissionId),
  });
  for (const key of commands.keys()) {
    await updateCommand(input.storage, key, (command) => {
      if (
        isCommandComplete(command) ||
        (command.stopRequested && !input.resume)
      ) {
        return stopPreparedCommand(command);
      }
      return stopPreparedCommand({
        ...command,
        stopRequested: true,
        collection: {
          unconfirmedAttempts: 0,
          nextAttemptAtMs: isCollectableCommand(command) ? Date.now() : null,
        },
      });
    });
  }
  return await readStoredComputerInvocation(input);
}

export async function inspectRemoteAgentComputerInvocation(input: {
  context: RemoteAgentCallbackContext;
  env?: { AGENT_COMPUTER?: unknown };
  storage: RemoteAgentStorage;
  requestStop?: boolean;
  resume?: boolean;
}): Promise<CloudComputerInvocationState> {
  const target = await readComputerTarget(input);
  if (target) {
    // Upgrade existing v3 receipts while their original admitted context is
    // available. Recovery after Flue rollover reads this immutable scope.
    await target.registerComputerInvocation({
      invocationId: input.context.submissionId,
      organizationId: input.context.organizationId,
      spaceId: input.context.spaceId,
      agentProfileId: input.context.agentProfileId,
    });
    return cloudComputerInvocationStateSchema.parse(
      input.requestStop
        ? await target.requestComputerCleanup(
            input.context.submissionId,
            input.resume
          )
        : await target.readComputerInvocation(input.context.submissionId)
    );
  }
  if (input.requestStop && input.context.computerIsolationVersion !== 3) {
    // Historical invocations retain their original storage and address.
    await stopRemoteAgentComputerCommands({
      ...input,
      env: input.env ?? {},
      reportConfirmedLoss: true,
    });
  }
  return await readStoredComputerInvocation(input);
}

export async function stopRemoteAgentComputerCommands(input: {
  context: RemoteAgentCallbackContext;
  env: { AGENT_COMPUTER?: unknown };
  storage: RemoteAgentStorage;
  reportConfirmedLoss?: boolean;
}): Promise<{ unfinished: number; lostDuringCleanup: boolean }> {
  const target = await readComputerTarget(input);
  if (target) {
    return cloudComputerCleanupResultSchema.parse(
      await target.stopComputerCommands(input.context.submissionId)
    );
  }
  if (input.context.computerIsolationVersion === 3) {
    // Current invocations bind their target before any Computer operation.
    // Ownerless/no-Computer turns therefore have nothing to clean up.
    return { unfinished: 0, lostDuringCleanup: false };
  }
  const namespace = input.env.AGENT_COMPUTER as AgentComputerNamespace;
  return await stopStoredComputerCommands({
    ...input,
    access: () =>
      createAgentComputerWorkspaceAccess({
        namespace,
        computerId: namespace.idFromName(
          resolveRemoteAgentComputerName(input.context)
        ),
      }),
  });
}

export async function stopStoredComputerCommands(input: {
  context: Pick<RemoteAgentCallbackContext, "submissionId">;
  storage: RemoteAgentStorage;
  access: (command: Command) => AgentComputerWorkspaceAccess;
  reportConfirmedLoss?: boolean;
}): Promise<{ unfinished: number; lostDuringCleanup: boolean }> {
  const commands = await input.storage.list<Command>({
    prefix: commandPrefix(input.context.submissionId),
  });
  if (commands.size === 0) {
    return { unfinished: 0, lostDuringCleanup: false };
  }
  let unfinished = 0;
  const failures: { key: string; error: unknown }[] = [];
  for (const [key, command] of commands) {
    // A reported loss reached the model. A cleanup loss is reconciled through
    // the execution owner, including after a crash before its failure request.
    // Neither absent process should be retried.
    if (
      isReportedCommandLoss(command) ||
      command.lostDuringCleanup ||
      isCommandComplete(command)
    ) {
      continue;
    }
    try {
      unfinished += await stopAndRecordComputerCommand({
        access: input.access(command),
        command,
        context: input.context,
        storage: input.storage,
      });
    } catch (error) {
      failures.push({ key, error });
    }
  }
  // A concurrent authoritative sync receipt can resolve a cleanup loss while
  // another command is still being inspected. Decide from current receipts.
  const current = await input.storage.list<Command>({
    prefix: commandPrefix(input.context.submissionId),
  });
  const unresolved = failures
    .filter(({ key, error }) => {
      const receipt = current.get(key);
      return !(
        error instanceof ConfirmedLostComputerCommandsError &&
        receipt &&
        isCommandComplete(receipt)
      );
    })
    .map(({ error }) => error);
  if (unresolved.length > 0) {
    if (
      unresolved.every(
        (error) => error instanceof ConfirmedLostComputerCommandsError
      )
    ) {
      if (input.reportConfirmedLoss) {
        return { unfinished, lostDuringCleanup: true };
      }
      throw new ConfirmedLostComputerCommandsError(unresolved);
    }
    throw new AggregateError(unresolved, "Computer command cleanup failed.");
  }
  return {
    unfinished,
    lostDuringCleanup: [...current.values()].some(
      (command) => command.lostDuringCleanup && !isCommandComplete(command)
    ),
  };
}

async function stopAndRecordComputerCommand(input: {
  access: AgentComputerWorkspaceAccess;
  command: Command;
  context: Pick<RemoteAgentCallbackContext, "submissionId">;
  storage: RemoteAgentStorage;
}): Promise<number> {
  const key = `${commandPrefix(input.context.submissionId)}${encodeURIComponent(input.command.key)}`;
  const current = await updateCommand(input.storage, key, (command) =>
    isCommandComplete(command) || isReportedCommandLoss(command)
      ? command
      : stopPreparedCommand({ ...command, stopRequested: true })
  );
  if (isCommandComplete(current) || isReportedCommandLoss(current)) {
    return 0;
  }
  try {
    return await inspectAndStopComputerCommand({ ...input, command: current });
  } catch (error) {
    if (error instanceof ConfirmedLostComputerCommandsError) {
      const reconciled = await updateCommand(input.storage, key, (command) =>
        isCommandComplete(command)
          ? command
          : {
              ...command,
              stopRequested: true,
              lossConfirmed: true,
              ...(command.lossReported ? {} : { lostDuringCleanup: true }),
            }
      );
      if (isCommandComplete(reconciled) || reconciled.lossReported) {
        return 0;
      }
      console.warn("[remote_agent.computer_command_cleanup_lost]", {
        submissionId: input.context.submissionId,
        ...commandDiagnostics(reconciled),
        errorCode: hasErrorCode(error.errors[0], "EEXEC_LOST")
          ? "EEXEC_LOST"
          : "ENOENT",
      });
    }
    console.warn("[remote_agent.computer_command_cleanup_error]", {
      submissionId: input.context.submissionId,
      ...commandDiagnostics(current),
      phase: "cleanup",
      ...remoteAgentDiagnosticErrorFields(error, {}),
    });
    throw error;
  }
}

async function inspectAndStopComputerCommand(input: {
  access: AgentComputerWorkspaceAccess;
  command: Command;
  context: Pick<RemoteAgentCallbackContext, "submissionId">;
  storage: RemoteAgentStorage;
}): Promise<number> {
  const { access, command } = input;
  if (command.backend === "worker-shell") {
    // Upstream shell cancellation is a no-op. Only the original foreground
    // call can establish completion. Keep cleanup explicitly unfinished.
    return 1;
  }
  return await withCommandWorkspace({
    access,
    budgetMs: OBSERVATION_SETUP_BUDGET_MS + 1000,
    phase: "cleanup",
    operation: async (workspace, signal) => {
      const inspection = await inspectComputerCommandForCleanup({
        ...input,
        workspace,
        signal,
      });
      signal.throwIfAborted();
      const { result, error } = inspection;
      const completed = result?.status === "completed";
      const runtimeLost = hasErrorCode(error, "EEXEC_LOST");
      const recordMissing = error instanceof MissingComputerExecRecordError;
      // A transport failure can leave a live command behind. A replaced
      // runtime cannot: the old execution identity is already gone.
      if (!(completed || inspection.exited || runtimeLost)) {
        try {
          await sendPendingComputerStop({
            storage: input.storage,
            key: `${commandPrefix(input.context.submissionId)}${encodeURIComponent(command.key)}`,
            workspace,
            signal,
            // A prior signal acknowledgement is not an exit receipt. When
            // inspection finds no record, confirm this exact ID is gone.
            force: recordMissing,
          });
        } catch (error) {
          if (
            hasErrorCode(error, "EEXEC_LOST") ||
            (recordMissing &&
              hasErrorCode(error, "ENOENT") &&
              hasLaunchEvidence(command))
          ) {
            throw new ConfirmedLostComputerCommandsError([error]);
          }
          throw error;
        }
      }
      if (runtimeLost) {
        throw new ConfirmedLostComputerCommandsError([error]);
      }
      if (error) {
        throw error;
      }
      return completed ? 0 : 1;
    },
  });
}

async function inspectComputerCommandForCleanup(input: {
  command: Command;
  context: Pick<RemoteAgentCallbackContext, "submissionId">;
  storage: RemoteAgentStorage;
  workspace: WorkspaceClient;
  signal: AbortSignal;
}): Promise<{ result?: CommandResult; error?: unknown; exited: boolean }> {
  try {
    const result = (await createComputerCommandTool({
      context: input.context,
      storage: input.storage,
      workspaceAccess: {
        withWorkspace: (operation) => operation(input.workspace),
      },
      workingDirectory: "/computer",
      reportErrors: false,
    }).execute(
      { action: "poll", key: input.command.key, waitSeconds: 1 },
      { signal: input.signal }
    )) as CommandResult;
    if ((result.syncError || result.syncSkipped) && result.exitCode !== null) {
      throw new ConfirmedLostComputerCommandsError([
        Object.assign(
          new Error(
            "The command exited, but its file synchronization could not be confirmed."
          ),
          { code: result.syncError ?? "ESYNC_READ_ONLY" }
        ),
      ]);
    }
    return { result, exited: result.exitCode !== null };
  } catch (error) {
    if (error instanceof ConfirmedLostComputerCommandsError) {
      throw error;
    }
    const key = `${commandPrefix(input.context.submissionId)}${encodeURIComponent(input.command.key)}`;
    const current = await input.storage.get<Command>(key);
    if (current && isCommandComplete(current)) {
      return {
        result: current.observation ?? current.terminalResult,
        exited: true,
      };
    }
    return { error, exited: hasCommandExited(current ?? input.command) };
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
