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
  stopRequested?: boolean;
  lossReported?: boolean;
  lostDuringCleanup?: boolean;
  completed?: boolean;
  terminalResult?: CommandResult;
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
  result?: WorkspaceRuntimeValue;
};

class MissingComputerExecRecordError extends Error {
  readonly code = "ENOENT";

  constructor(id: string, cause: unknown) {
    super(`Computer execution record ${id} is missing.`, { cause });
    this.name = "MissingComputerExecRecordError";
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
}): RemoteAgentToolDefinition {
  const prefix = commandPrefix(input.context.submissionId);
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
  const saveCompleted = async (key: string, result: CommandResult) => {
    if (result.status !== "completed") {
      return;
    }
    await updateCommand(
      input.storage,
      `${prefix}${encodeURIComponent(key)}`,
      (command) =>
        command.completed
          ? command
          : {
              ...command,
              completed: true,
              ...(command.backend === "worker-shell"
                ? { terminalResult: result }
                : {}),
            }
    );
  };
  const launchWasStopped = async (key: string, signal?: AbortSignal) =>
    Boolean((await read(key)).stopRequested || signal?.aborted);
  const launchCommand = async (
    workspace: WorkspaceClient,
    request: StartCommand,
    command: Command,
    signal?: AbortSignal
  ) => {
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
    let result: CommandResult;
    try {
      result = await readCommandSlice(
        handle,
        command.key,
        0,
        1000,
        command.backend === "worker-shell" ? undefined : signal
      );
      // Foreground execution already ended. Preserve its only exit
      // receipt even when the caller requested cancellation meanwhile.
      await saveCompleted(command.key, result);
    } finally {
      handle[Symbol.dispose]();
      if (await launchWasStopped(request.key, signal)) {
        await workspace.runtime.killExec(command.id, {
          backend: commandBackend(command),
          signal: "SIGTERM",
        });
      }
    }
    if (await launchWasStopped(request.key, signal)) {
      throw new Error("Computer command was stopped during launch.");
    }
    return {
      ...result,
      nextAction: result.status === "completed" ? "done" : "poll",
    };
  };
  const definition: RemoteAgentToolDefinition = {
    name: "computer_command",
    description:
      "Run commands on your personal Computer. start accepts key, command, backend (container by default, worker-shell or worker-javascript), env, stdin, structured input, and timeoutSeconds. JavaScript source exports a default function; its returned JSON is in result. worker-shell completes before returning and cannot be interrupted or reattached. Use container or worker-javascript for long or cancellable execution. Replies keep the last 50,000 characters per stream and flag outputTruncated. Redirect large output to a persistent file. Start once with a stable key, then poll using the returned after cursor until completed. list recovers this invocation's keys. stop sends signal (SIGTERM by default); stop_requested is not confirmed exit. A repeated start never launches twice. After a transport error, inspect the existing key rather than rerun. Continue collecting results before the final answer. Cancellation cleans up only this task's commands. Do not add shell backgrounding to evade command lifecycle. Use computer for files, capability details or a different cwd.",
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
        };
        const created = await input.storage.putIfAbsentExpiring(
          key,
          candidate,
          Date.now() + 7 * 24 * 60 * 60 * 1000
        );
        const command = created ? candidate : await read(request.key);
        assertCommandMatches(command, fingerprint);
        if (command.terminalResult) {
          return command.terminalResult;
        }
        return await input.workspaceAccess.withWorkspace((workspace) =>
          created
            ? launchCommand(workspace, request, command, options?.signal)
            : pollComputerCommand(
                workspace.runtime,
                command,
                0,
                1000,
                options?.signal
              )
        );
      }
      const command = await read(request.key);
      if (command.terminalResult) {
        return completedResult(
          command.terminalResult,
          request.action === "poll" ? request.after : undefined
        );
      }
      return await input.workspaceAccess.withWorkspace(async (workspace) => {
        if (request.action === "stop") {
          if (command.backend === "worker-shell") {
            throw new Error(
              "computer.cancellation_unsupported: worker-shell runs in the foreground and cannot be interrupted. Wait for its result or timeout. Use container or worker-javascript for cancellable work."
            );
          }
          await updateCommand(
            input.storage,
            `${prefix}${encodeURIComponent(command.key)}`,
            (current) => ({ ...current, stopRequested: true })
          );
          await workspace.runtime.killExec(command.id, {
            backend: commandBackend(command),
            signal: request.signal ?? "SIGTERM",
          });
          return {
            id: command.id,
            key: command.key,
            status: "stop_requested",
            nextAction: "poll",
          };
        }
        return await pollComputerCommand(
          workspace.runtime,
          command,
          request.after ?? 0,
          (request.waitSeconds ?? 20) * 1000,
          options?.signal
        );
      });
    },
  };
  return {
    ...definition,
    async execute(rawInput, options) {
      try {
        const result = await definition.execute(rawInput, options);
        const receipt =
          result && typeof result === "object"
            ? (result as Record<string, unknown>)
            : {};
        if (isCompletedCommandReceipt(receipt, rawInput)) {
          await saveCompleted(String(rawInput.key), result as CommandResult);
        }
        console.info("[remote_agent.computer_command_result]", {
          submissionId: input.context.submissionId,
          action: rawInput.action,
          commandId: receipt.id,
          status: receipt.status,
          exitCode: receipt.exitCode,
          after: receipt.after,
          stdoutChars:
            typeof receipt.stdout === "string"
              ? receipt.stdout.length
              : undefined,
        });
        return result;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXEC_LOST" &&
          typeof rawInput.key === "string"
        ) {
          const command = await read(rawInput.key);
          await input.storage.putExpiring(
            `${prefix}${encodeURIComponent(command.key)}`,
            { ...command, lossReported: true },
            Date.now() + 7 * 24 * 60 * 60 * 1000
          );
        }
        console.warn("[remote_agent.computer_command_failed]", {
          submissionId: input.context.submissionId,
          action: rawInput.action,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorCode:
            typeof error === "object" && error !== null && "code" in error
              ? error.code
              : undefined,
        });
        throw error;
      }
    },
  };
}

function isCompletedCommandReceipt(
  receipt: Record<string, unknown>,
  input: Record<string, unknown>
): boolean {
  return receipt.status === "completed" && typeof input.key === "string";
}

function completedResult(result: CommandResult, after?: number): CommandResult {
  return after !== undefined && after >= result.after
    ? { ...result, stdout: "", stderr: "" }
    : result;
}

async function pollComputerCommand(
  runtime: WorkspaceClient["runtime"],
  command: Pick<Command, "id" | "key" | "backend">,
  after: number,
  waitMs: number,
  signal?: AbortSignal
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
        ...command,
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
      signal
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

export async function readCommandSlice(
  handle: WorkspaceRuntimeExecHandle<"utf8">,
  key: string,
  after: number,
  waitMs: number,
  signal?: AbortSignal
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
        result.exitCode = next.value.code;
        if (next.value.result !== undefined) {
          result.result = next.value.result;
        }
        exitSequence = next.value.seq;
        // Close confirms post-command file sync. Until then, keep the cursor
        // before exit so a bounded poll can replay that receipt and retry sync.
      }
    }
    return result;
  } finally {
    clearTimeout(timer);
    if (onAbort) {
      signal?.removeEventListener("abort", onAbort);
    }
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
      handle[Symbol.dispose]();
    }
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
        !(command.completed || command.lossReported || command.stopRequested)
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
      command.lossReported ||
      command.lostDuringCleanup ||
      command.completed
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
    command.completed ? command : { ...command, stopRequested: true }
  );
  if (current.completed) {
    return 0;
  }
  try {
    return await inspectAndStopComputerCommand(input.access, current);
  } catch (error) {
    if (error instanceof ConfirmedLostComputerCommandsError) {
      await input.storage.putExpiring(
        key,
        { ...input.command, stopRequested: true, lostDuringCleanup: true },
        Date.now() + 7 * 24 * 60 * 60 * 1000
      );
      console.warn("[remote_agent.computer_command_cleanup_lost]", {
        submissionId: input.context.submissionId,
        commandId: input.command.id,
        commandKey: input.command.key,
        errorCode: hasErrorCode(error.errors[0], "EEXEC_LOST")
          ? "EEXEC_LOST"
          : "ENOENT",
      });
    }
    console.warn("[remote_agent.computer_command_cleanup_error]", {
      submissionId: input.context.submissionId,
      commandId: input.command.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode:
        error instanceof Error && "code" in error ? error.code : undefined,
    });
    throw error;
  }
}

async function inspectAndStopComputerCommand(
  access: AgentComputerWorkspaceAccess,
  command: Command
): Promise<number> {
  if (command.backend === "worker-shell") {
    // Upstream shell cancellation is a no-op. Only the original foreground
    // call can establish completion. Keep cleanup explicitly unfinished.
    return 1;
  }
  return await access.withWorkspace(async (workspace) => {
    let completed = false;
    let recordMissing = false;
    let runtimeLost = false;
    let inspectionFailed = false;
    let inspectionError: unknown;
    try {
      const result = await pollComputerCommand(
        workspace.runtime,
        command,
        0,
        1000
      );
      completed = result.status === "completed";
    } catch (error) {
      recordMissing = error instanceof MissingComputerExecRecordError;
      runtimeLost = hasErrorCode(error, "EEXEC_LOST");
      inspectionFailed = true;
      inspectionError = error;
    }
    // A transport failure can leave a live command behind. A replaced
    // runtime cannot: the old execution identity is already gone.
    if (!(completed || runtimeLost)) {
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
      throw new ConfirmedLostComputerCommandsError([inspectionError]);
    }
    if (inspectionFailed) {
      throw inspectionError;
    }
    return completed ? 0 : 1;
  });
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
