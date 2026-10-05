import { setTimeout as delay } from "node:timers/promises";
import type {
  WorkspaceClient,
  WorkspaceRuntimeExecHandle,
} from "@cloudflare/computer";
import { cloudComputerCleanupResultSchema } from "@openmeld/schemas";
import {
  integer,
  literal,
  maxValue,
  minLength,
  minValue,
  number,
  optional,
  parse,
  picklist,
  pipe,
  strictObject,
  string,
  variant,
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
const commandSchema = variant("action", [
  strictObject({
    action: literal("start"),
    key: pipe(string(), minLength(1)),
    command: pipe(string(), minLength(1)),
    timeoutSeconds: optional(
      pipe(number(), integer(), minValue(1), maxValue(3600))
    ),
  }),
  strictObject({
    action: literal("poll"),
    key: pipe(string(), minLength(1)),
    // Computer may emit a fractional cursor when flushing partial UTF-8.
    after: optional(pipe(number(), minValue(0))),
    waitSeconds: optional(pipe(number(), integer(), minValue(0), maxValue(20))),
  }),
  strictObject({ action: literal("stop"), key: pipe(string(), minLength(1)) }),
  strictObject({ action: literal("list") }),
]);

// Flue requires an object at the tool boundary. The action-specific schema
// above remains the strict execution validator (including forbidden fields).
const commandToolSchema = strictObject({
  action: picklist(["start", "poll", "stop", "list"]),
  key: optional(pipe(string(), minLength(1))),
  command: optional(pipe(string(), minLength(1))),
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
  const definition: RemoteAgentToolDefinition = {
    name: "computer_command",
    description:
      "Run long Linux commands using the Computer's retained native process sessions. Each action accepts only its own fields: start {action,key,command,timeoutSeconds?}; poll {action,key,after?,waitSeconds?}; stop {action,key}; list {action}. Do not pass poll fields to start. start launches the command directly (never add shell &, nohup, or a background subprocess), returning an initial output slice; use a unique stable key per command. poll returns bounded output plus an after cursor; repeat until completed. running with outputPending means the native process is alive but its existing output subscription has not detached; continue polling, and retained output will be available after exit. Use separate polls with the default 20-second wait for long work, outside indefinite Code Mode loops. list recovers keys after interruption. stop requests SIGTERM for that exact command; stop_requested does not confirm termination. Commands belong to this execution only. Repeating start with the same key never launches a second process. A transport error can mean launch outcome is unknown: list/poll, never blindly rerun. Continue collecting results until completion or actual cancellation. Use only progress tools available in your current role. Do not end your turn merely to wait for a running command or a possible future Stop. Collect command results before your final answer; actual cancellation and terminal failure clean up unfinished commands. Use bash for short commands.",
    input: commandToolSchema,
    async execute(rawInput, options) {
      options?.signal?.throwIfAborted();
      const request = parse(commandSchema, rawInput);
      if (request.action === "list") {
        return [
          ...(await input.storage.list<Command>({ prefix })).values(),
        ].map(({ key, id, createdAt }) => ({ key, id, createdAt }));
      }
      if (request.action === "start") {
        await input.assertCanStart?.();
        const key = `${prefix}${encodeURIComponent(request.key)}`;
        const fingerprint = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(
                JSON.stringify({
                  command: request.command,
                  cwd: input.workingDirectory,
                  timeoutSeconds: request.timeoutSeconds ?? 300,
                })
              )
            )
          )
        )
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        const candidate: Command = {
          id: crypto.randomUUID(),
          key: request.key,
          fingerprint,
          createdAt: Date.now(),
        };
        const created = await input.storage.putIfAbsentExpiring(
          key,
          candidate,
          Date.now() + 7 * 24 * 60 * 60 * 1000
        );
        const command = created ? candidate : await read(request.key);
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
        return await input.workspaceAccess.withWorkspace(async (workspace) => {
          if (!created) {
            return await pollComputerCommand(
              workspace.runtime,
              command,
              0,
              1000,
              options?.signal
            );
          }
          // Persist identity before dispatch. An uncertain spawn must be inspected,
          // never replayed: even a missing retained handle cannot prove no effect.
          await input.assertCanStart?.();
          const handle = await workspace.runtime.exec(
            buildComputerCommandProcess(request.command),
            {
              id: command.id,
              backend: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
              cwd: input.workingDirectory,
              encoding: "utf8",
              timeoutMs: (request.timeoutSeconds ?? 300) * 1000,
            }
          );
          let result: CommandResult;
          try {
            result = await readCommandSlice(
              handle,
              command.key,
              0,
              1000,
              options?.signal
            );
          } finally {
            handle[Symbol.dispose]();
            if (
              (await read(request.key)).stopRequested ||
              options?.signal?.aborted
            ) {
              await workspace.runtime.killExec(command.id, {
                backend: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
                signal: "SIGTERM",
              });
            }
          }
          if (
            (await read(request.key)).stopRequested ||
            options?.signal?.aborted
          ) {
            throw new Error("Computer command was stopped during launch.");
          }
          return {
            ...result,
            nextAction: result.status === "completed" ? "done" : "poll",
          };
        });
      }
      const command = await read(request.key);
      return await input.workspaceAccess.withWorkspace(async (workspace) => {
        if (request.action === "stop") {
          await input.storage.putExpiring(
            `${prefix}${encodeURIComponent(command.key)}`,
            { ...command, stopRequested: true },
            Date.now() + 7 * 24 * 60 * 60 * 1000
          );
          await workspace.runtime.killExec(command.id, {
            backend: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
            signal: "SIGTERM",
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
          const command = await read(String(rawInput.key));
          await input.storage.putExpiring(
            `${prefix}${encodeURIComponent(command.key)}`,
            { ...command, completed: true },
            Date.now() + 7 * 24 * 60 * 60 * 1000
          );
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

async function pollComputerCommand(
  runtime: WorkspaceClient["runtime"],
  command: Pick<Command, "id" | "key">,
  after: number,
  waitMs: number,
  signal?: AbortSignal
): Promise<CommandResult> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    signal?.throwIfAborted();
    let handle: WorkspaceRuntimeExecHandle<"utf8">;
    try {
      handle = await runtime.getExec(command.id, {
        backend: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
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
        const name = next.value.name;
        result[name] = (result[name] + next.value.value).slice(
          -MAX_OUTPUT_CHARS
        );
      } else if (next.value.name === "exit") {
        result.exitCode = next.value.code;
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
  await input.storage.putExpiring(
    key,
    { ...input.command, stopRequested: true },
    Date.now() + 7 * 24 * 60 * 60 * 1000
  );
  try {
    return await inspectAndStopComputerCommand(input.access, input.command);
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
          backend: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
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
