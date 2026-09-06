import { setTimeout as delay } from "node:timers/promises";
import type {
  WorkspaceClient,
  WorkspaceRuntimeExecHandle,
} from "@cloudflare/computer";
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
import { buildAgentComputerName } from "./computer-identity";
import { AGENT_COMPUTER_CONTAINER_BACKEND_ID } from "./computer-workspace";

const PREFIX = "openmeld:remote-agent:computer-command:";
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
    after: optional(pipe(number(), integer(), minValue(0))),
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
  after: optional(pipe(number(), integer(), minValue(0))),
  waitSeconds: optional(pipe(number(), integer(), minValue(0), maxValue(20))),
});

type Command = {
  id: string;
  key: string;
  fingerprint: string;
  createdAt: number;
  stopRequested?: boolean;
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

function commandPrefix(submissionId: string): string {
  return `${PREFIX}${encodeURIComponent(submissionId)}:`;
}

export function createComputerCommandTool(input: {
  context: RemoteAgentCallbackContext;
  storage: RemoteAgentStorage;
  workspaceAccess: AgentComputerWorkspaceAccess;
  workingDirectory: string;
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
      "Run long Linux commands using the Computer's retained native process sessions. Each action accepts only its own fields: start {action,key,command,timeoutSeconds?}; poll {action,key,after?,waitSeconds?}; stop {action,key}; list {action}. Do not pass poll fields to start. start launches the command directly (never add shell &, nohup, or a background subprocess), returning an initial output slice; use a unique stable key per command. poll returns bounded output plus an after cursor; repeat until completed. running with outputPending means the native process is alive but its existing output subscription has not detached; continue polling, and retained output will be available after exit. Use separate polls with the default 20-second wait for long work. list recovers keys after interruption. stop requests SIGTERM for that exact command. Commands belong to this execution only. Repeating start with the same key never launches a second process. A transport error can mean launch outcome is unknown: list/poll, never blindly rerun. While a command is running, publish progress with openmeld_post_space_message and continue polling. A user saying they will press Stop does not stop the command: keep polling until actual cancellation or completion. Never end your turn to wait for Stop; ending the turn terminates unfinished commands. Finish all commands before your final answer. Use bash for short commands.",
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
      const next =
        result.exitCode === null
          ? await Promise.race([reader.read(), deadline])
          : await reader.read();
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
        break;
      }
      result.after = next.value.seq;
      if (next.value.name === "stdout" || next.value.name === "stderr") {
        const name = next.value.name;
        result[name] = (result[name] + next.value.value).slice(
          -MAX_OUTPUT_CHARS
        );
      } else if (next.value.name === "exit") {
        result.exitCode = next.value.value;
        // Drain through close so the SDK completes its post-command file sync.
      }
    }
    return result;
  } finally {
    clearTimeout(timer);
    if (onAbort) {
      signal?.removeEventListener("abort", onAbort);
    }
    await reader.cancel();
    reader.releaseLock();
    handle[Symbol.dispose]();
  }
}

export async function stopRemoteAgentComputerCommands(input: {
  context: RemoteAgentCallbackContext;
  env: { AGENT_COMPUTER?: unknown };
  storage: RemoteAgentStorage;
}): Promise<number> {
  const commands = await input.storage.list<Command>({
    prefix: commandPrefix(input.context.submissionId),
  });
  if (commands.size === 0) {
    return 0;
  }
  const namespace = input.env.AGENT_COMPUTER as AgentComputerNamespace;
  const access = createAgentComputerWorkspaceAccess({
    namespace,
    computerId: namespace.idFromName(
      buildAgentComputerName(input.context.agentProfileId)
    ),
  });
  let unfinished = 0;
  const failures: unknown[] = [];
  for (const command of commands.values()) {
    try {
      await input.storage.putExpiring(
        `${commandPrefix(input.context.submissionId)}${encodeURIComponent(command.key)}`,
        { ...command, stopRequested: true },
        Date.now() + 7 * 24 * 60 * 60 * 1000
      );
      await access.withWorkspace(async (workspace) => {
        let completed = false;
        try {
          const result = await pollComputerCommand(
            workspace.runtime,
            command,
            0,
            1000
          );
          completed = result.status === "completed";
        } finally {
          // Output transport failure must never strand an owned process after
          // its turn ends. Signal its exact retained identity even when its
          // output cannot be read; preserve the inspection error for diagnosis.
          if (!completed) {
            unfinished++;
            await workspace.runtime.killExec(command.id, {
              backend: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
              signal: "SIGTERM",
            });
          }
        }
      });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Computer command cleanup failed.");
  }
  return unfinished;
}
