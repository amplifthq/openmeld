import { setTimeout as delay } from "node:timers/promises";
import type {
  WorkspaceClient,
  WorkspaceRuntimeExecHandle,
  WorkspaceRuntimeValue,
} from "@cloudflare/computer";
import {
  type CloudComputerOperation,
  cloudComputerCleanupResultSchema,
  cloudComputerCommandSchema,
} from "@openmeld/schemas";
import {
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
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  type AgentComputerNamespace,
  type AgentComputerWorkspaceAccess,
  createAgentComputerWorkspaceAccess,
} from "./agent-computer-workspace-access";
import { buildComputerCommandProcess } from "./computer-command-process";
import { resolveRemoteAgentComputerName } from "./computer-identity";
import { AGENT_COMPUTER_CONTAINER_BACKEND_ID } from "./computer-workspace";

const PREFIX = "openmeld:remote-agent:computer-command:";
const COMPUTER_TARGET_PREFIX = "openmeld:computer-target:";

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

async function readComputerTarget(input: {
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
const READER_CANCEL_BUDGET_MS = 100;
const COLLECTION_CONCURRENCY = 4;
// Flue requires an object at the tool boundary. The action-specific schema
// in packages/schemas is the shared execution validator, including forbidden fields.
const commandToolSchema = strictObject({
  action: picklist(["start", "poll", "stop", "list"]),
  key: optional(pipe(string(), minLength(1))),
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
  observedAt?: number;
  exitedAt?: number;
  stopRequested?: boolean;
  lossReported?: boolean;
  lostDuringCleanup?: boolean;
  completed?: boolean;
  terminalResult?: CommandResult;
  observation?: CommandResult;
  output?: { after: number; stdout: string; stderr: string }[];
  syncCursor?: number;
  loss?: "ENOENT" | "EEXEC_LOST";
  lossConfirmed?: boolean;
  collectable?: boolean;
  backend?: "container" | "worker-shell" | "worker-javascript";
};
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
  syncError?: "ENOENT" | "EEXEC_LOST";
  nextAction?: "inspect" | "done" | "poll";
  result?: WorkspaceRuntimeValue;
};

/** Bound external observation, including Workspace acquisition and disposal.
 * A timeout never establishes process loss or authorizes another launch. */
async function withCommandWorkspace<T>(input: {
  access: AgentComputerWorkspaceAccess;
  budgetMs: number;
  phase: "launch" | "poll" | "stop" | "cleanup";
  signal?: AbortSignal;
  operation: (workspace: WorkspaceClient, signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  let phase = "workspace-acquisition";
  const timeout = new AbortController();
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeout.signal])
    : timeout.signal;
  const timer = setTimeout(
    () =>
      timeout.abort(
        Object.assign(
          new Error(
            "Computer command observation timed out. The command may still be running. Poll the same key; do not start it again."
          ),
          { code: "computer.observation_timeout", phase }
        )
      ),
    input.budgetMs
  );
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

function isCommandLoss(
  error: unknown
): error is Error & { code: "ENOENT" | "EEXEC_LOST" } {
  return (
    error instanceof MissingComputerExecRecordError ||
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
  constructor(errors: unknown[]) {
    super(
      errors,
      "Computer command cleanup failed: a retained execution was confirmed lost."
    );
    this.name = "ConfirmedLostComputerCommandsError";
  }
}

function commandPrefix(submissionId: string): string {
  return `${PREFIX}${encodeURIComponent(submissionId)}:`;
}

type StartCommand = Extract<
  Extract<CloudComputerOperation, { action: "command" }>["command"],
  { action: "start" }
>;

function commandBackend(command: Pick<Command, "backend">) {
  return command.backend ?? AGENT_COMPUTER_CONTAINER_BACKEND_ID;
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
    loss: command?.loss,
  };
}

function isReportedCommandLoss(command: Command) {
  return (
    command.lossReported &&
    (command.loss === "EEXEC_LOST" || command.lossConfirmed || !command.loss)
  );
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
    !(previous.syncError && result.status !== "completed") &&
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
    ...retainedCommand
  } = command;
  const observedAt = Date.now();
  return {
    ...retainedCommand,
    collectable: true,
    observedAt,
    ...(result.exitCode !== null && !command.exitedAt
      ? { exitedAt: observedAt }
      : {}),
    observation,
    output: retained.output,
    ...(exitSequence !== undefined ? { syncCursor: result.after } : {}),
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

export async function hasCollectableComputerCommands(
  storage: RemoteAgentStorage
) {
  const commands = await storage.list<Command>({ prefix: PREFIX });
  return [...commands.values()].some(isCollectableCommand);
}

function isCollectableCommand(command: Command) {
  return (
    command.collectable !== undefined &&
    !(
      isCommandComplete(command) ||
      command.loss ||
      command.lostDuringCleanup ||
      command.backend === "worker-shell"
    )
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
    if (
      next === current ||
      (await storage.compareAndSetExpiring(
        key,
        current,
        next,
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ))
    ) {
      return next;
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

export function createComputerCommandTool(input: {
  context: Pick<RemoteAgentCallbackContext, "submissionId">;
  storage: RemoteAgentStorage;
  workspaceAccess: AgentComputerWorkspaceAccess;
  workingDirectory: string;
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
      throw new Error(
        "Unknown Computer command for this execution. Use action list to recover its keys."
      );
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
  const reportUnconfirmedSync = async (command: Command, after = 0) =>
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
  const confirmSync = async (
    workspace: WorkspaceClient,
    command: Command,
    waitMs: number,
    signal?: AbortSignal
  ) => {
    const receipt = command.observation;
    if (!receipt?.syncPending) {
      return command;
    }
    // result() is the SDK's public synchronization receipt. Stream closure alone
    // also occurs after a failed pull and therefore cannot establish completion.
    let handle: WorkspaceRuntimeExecHandle<"utf8"> | undefined;
    const timer = new AbortController();
    try {
      handle = await workspace.runtime.getExec(command.id, {
        backend: commandBackend(command),
        encoding: "utf8",
        resume: command.syncCursor ?? 0,
      });
      const result = await Promise.race([
        handle.result(),
        delay(waitMs, null, {
          signal: signal
            ? AbortSignal.any([signal, timer.signal])
            : timer.signal,
        }),
      ]);
      signal?.throwIfAborted();
      if (result?.sync.status === "complete") {
        const { syncPending: _, ...completed } = receipt;
        return await saveObservation(command.key, {
          ...completed,
          status: "completed",
        });
      }
      return command;
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
    } finally {
      timer.abort();
      handle?.[Symbol.dispose]();
    }
  };
  const observe = async (
    workspace: WorkspaceClient,
    command: Command,
    waitMs: number,
    signal?: AbortSignal,
    started?: WorkspaceRuntimeExecHandle<"utf8">
  ) => {
    const deadline = Date.now() + waitMs;
    if (command.observation?.syncError) {
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
      return await confirmSync(workspace, command, waitMs, signal);
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
      return await confirmSync(
        workspace,
        current,
        Math.max(0, deadline - Date.now()),
        signal
      );
    }
    return await saveObservation(command.key, result);
  };
  const launchWasStopped = async (key: string, signal?: AbortSignal) =>
    Boolean((await read(key)).stopRequested || signal?.aborted);
  const launchCommand = async (
    workspace: WorkspaceClient,
    request: StartCommand,
    command: Command,
    observationSignal: AbortSignal,
    userSignal?: AbortSignal
  ): Promise<CommandResult> => {
    // Persist identity before dispatch. An uncertain spawn must be inspected,
    // never replayed: even a missing retained handle cannot prove no effect.
    await input.assertCanStart?.();
    const handle = await workspace.runtime.exec(
      command.backend === AGENT_COMPUTER_CONTAINER_BACKEND_ID
        ? buildComputerCommandProcess(request.command)
        : request.command,
      {
        id: command.id,
        backend: command.backend,
        cwd: input.workingDirectory,
        encoding: "utf8",
        timeoutMs: (request.timeoutSeconds ?? 300) * 1000,
        env: request.env,
        stdin: request.stdin,
        input: request.input,
      }
    );
    await updateCommand(
      input.storage,
      `${prefix}${encodeURIComponent(command.key)}`,
      (current) => ({ ...current, collectable: true })
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
      const current = await read(request.key);
      if (
        (current.stopRequested || userSignal?.aborted) &&
        !hasCommandExited(current)
      ) {
        // The launch acknowledgement can arrive after the original Workspace
        // was disposed. Acquire a fresh client to stop that exact identity.
        await withCommandWorkspace({
          access: input.workspaceAccess,
          budgetMs: OBSERVATION_SETUP_BUDGET_MS,
          phase: "stop",
          operation: (currentWorkspace) =>
            currentWorkspace.runtime.killExec(command.id, {
              backend: commandBackend(command),
              signal: "SIGTERM",
            }),
        });
      }
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
      backend: request.backend ?? AGENT_COMPUTER_CONTAINER_BACKEND_ID,
      collectable: false,
    };
    const created = await input.storage.putIfAbsentExpiring(
      key,
      candidate,
      Date.now() + 7 * 24 * 60 * 60 * 1000
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
      return await reportUnconfirmedSync(command);
    }
    return await withCommandWorkspace({
      access: input.workspaceAccess,
      budgetMs: launchBudgetMs(request, created),
      phase: created ? "launch" : "poll",
      signal,
      operation: (workspace, observationSignal) =>
        created
          ? launchCommand(
              workspace,
              request,
              command,
              observationSignal,
              signal
            )
          : observe(workspace, command, 1000, observationSignal).then(
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
      (current) => ({ ...current, stopRequested: true })
    );
    if (isCommandComplete(current)) {
      return project(current);
    }
    if (!hasCommandExited(current)) {
      await withCommandWorkspace({
        access: input.workspaceAccess,
        budgetMs: OBSERVATION_SETUP_BUDGET_MS,
        phase: "stop",
        signal,
        operation: (workspace) =>
          workspace.runtime.killExec(command.id, {
            backend: commandBackend(command),
            signal: request.signal ?? "SIGTERM",
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
      "Run commands on your personal Computer. start accepts key, command, backend (container by default, worker-shell or worker-javascript), env, stdin, structured input, and timeoutSeconds. JavaScript source exports a default function; its returned JSON is in result. worker-shell completes before returning and cannot be interrupted or reattached. Use container or worker-javascript for long or cancellable execution. Replies keep bounded recent output and flag outputTruncated. Redirect large output to a persistent file. Start once with a stable key, then poll using the returned after cursor until completed. syncPending means the process exited but file synchronization is not confirmed. Continue polling unless syncError or nextAction inspect is present. syncError preserves the known exit and output, but synchronization cannot be confirmed. Stop polling and inspect persistent files. Process exit does not prove file synchronization succeeded. The Computer saves results independently of model polling. list recovers this invocation's keys. stop sends signal (SIGTERM by default); stop_requested is not confirmed exit. A repeated start never launches twice. After a transport error or missing execution record, inspect existing results before deciding what can safely be repeated. Report any unresolved work in your final answer. Cancellation cleans up only this task's commands. Do not add shell backgrounding to evade command lifecycle. Use computer for files, capability details or a different cwd.",
    input: commandToolSchema,
    async execute(rawInput, options) {
      options?.signal?.throwIfAborted();
      const request = cloudComputerCommandSchema.parse(rawInput);
      if (request.action === "list") {
        return [
          ...(await input.storage.list<Command>({ prefix })).values(),
        ].map(({ key, id, createdAt }) => ({ key, id, createdAt }));
      }
      if (request.action === "start") {
        return await startCommand(request, options?.signal);
      }
      const command = await read(request.key);
      if (command.observation?.syncError) {
        return await reportUnconfirmedSync(
          command,
          request.action === "poll" ? request.after : undefined
        );
      }
      if (
        isCommandComplete(command) &&
        (command.observation || command.terminalResult)
      ) {
        return project(
          command,
          request.action === "poll" ? request.after : undefined
        );
      }
      await input.scheduleCollection?.();
      if (request.action === "stop") {
        return await stopCommand(request, command, options?.signal);
      }
      return await withCommandWorkspace({
        access: input.workspaceAccess,
        budgetMs:
          OBSERVATION_SETUP_BUDGET_MS + (request.waitSeconds ?? 20) * 1000,
        phase: "poll",
        signal: options?.signal,
        operation: async (workspace, observationSignal) => {
          return project(
            await observe(
              workspace,
              command,
              (request.waitSeconds ?? 20) * 1000,
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
        (current) =>
          current.collectable === false || isCommandComplete(current)
            ? current
            : {
                ...current,
                loss: error.code,
                ...(input.reportErrors === false ? {} : { lossReported: true }),
              }
      );
    }
    if (source === "tool" || (isCommandLoss(error) && !command?.loss)) {
      console.warn("[remote_agent.computer_command_failed]", {
        source,
        submissionId: input.context.submissionId,
        action: rawInput.action,
        ...commandDiagnostics(command),
        phase:
          error instanceof Error && "phase" in error
            ? error.phase
            : rawInput.action,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorCode:
          error instanceof Error && "code" in error ? error.code : undefined,
      });
    }
  };
  return {
    ...definition,
    async execute(rawInput, options) {
      try {
        const result = await definition.execute(rawInput, options);
        await logResult(rawInput, result);
        return result;
      } catch (error) {
        await recordFailure(rawInput, error);
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

/** Collect retained results even when the model is busy with other work. This
 * observes existing IDs only; it never dispatches or repeats a command. */
export async function collectComputerCommands(input: {
  storage: RemoteAgentStorage;
  workspaceAccess: AgentComputerWorkspaceAccess;
}): Promise<boolean> {
  const commands = await input.storage.list<Command>({ prefix: PREFIX });
  let pending = false;
  const remaining = [...commands].filter(([, command]) =>
    isCollectableCommand(command)
  );
  const collect = async () => {
    for (;;) {
      const next = remaining.shift();
      if (!next) {
        return;
      }
      const [key, command] = next;
      if (!isCollectableCommand(command)) {
        continue;
      }
      const submissionId = decodeURIComponent(
        key.slice(PREFIX.length, key.lastIndexOf(":"))
      );
      try {
        const result = (await createComputerCommandTool({
          ...input,
          context: { submissionId },
          workingDirectory: "/computer",
          reportErrors: false,
        }).execute({
          action: "poll",
          key: command.key,
          waitSeconds: 1,
        })) as CommandResult;
        pending ||= result.status !== "completed" && !result.syncError;
      } catch (error) {
        // Record confirmed loss but do not mark it delivered to the model.
        // Transport failures remain retryable by this same owner.
        pending ||= !(
          hasErrorCode(error, "ENOENT") || hasErrorCode(error, "EEXEC_LOST")
        );
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(COLLECTION_CONCURRENCY, remaining.length) },
      collect
    )
  );
  return pending;
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

export async function stopRemoteAgentComputerCommands(input: {
  context: RemoteAgentCallbackContext;
  env: { AGENT_COMPUTER?: unknown };
  storage: RemoteAgentStorage;
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
  let lostDuringCleanup = 0;
  const previouslyLost = [...commands.values()].some(
    (command) => command.lostDuringCleanup
  );
  const failures: unknown[] = [];
  for (const command of commands.values()) {
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
      if (error instanceof ConfirmedLostComputerCommandsError) {
        lostDuringCleanup++;
      }
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    if (lostDuringCleanup === failures.length) {
      if (input.reportConfirmedLoss) {
        return { unfinished, lostDuringCleanup: true };
      }
      throw new ConfirmedLostComputerCommandsError(failures);
    }
    throw new AggregateError(failures, "Computer command cleanup failed.");
  }
  return { unfinished, lostDuringCleanup: previouslyLost };
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
      : { ...command, stopRequested: true }
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
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode:
        error instanceof Error && "code" in error ? error.code : undefined,
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
          await workspace.runtime.killExec(command.id, {
            backend: commandBackend(command),
            signal: "SIGTERM",
          });
        } catch (error) {
          if (
            hasErrorCode(error, "EEXEC_LOST") ||
            (recordMissing && hasErrorCode(error, "ENOENT"))
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
    if (result.syncError && result.exitCode !== null) {
      throw new ConfirmedLostComputerCommandsError([
        Object.assign(
          new Error(
            "The command exited, but its file synchronization could not be confirmed."
          ),
          { code: result.syncError }
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
