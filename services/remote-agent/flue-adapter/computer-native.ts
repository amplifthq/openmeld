import {
  type CreatePiToolsOptions,
  createPiTools,
} from "@cloudflare/computer/tools/pi-ai";
import {
  type CloudComputerStorage,
  cloudComputerOperationSchema,
} from "@openmeld/schemas";
import {
  optional,
  parse,
  picklist,
  record,
  strictObject,
  string,
  unknown,
} from "valibot";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import type { AgentComputerWorkspaceAccess } from "./agent-computer-workspace-access";
import { executeAgentComputerCommand } from "./computer-command-wait";

export const COMPUTER_BACKENDS = {
  container: {
    description:
      "Full Linux: native binaries, Git, Node, Python, package installation and network. /computer is persistent; the rest of Linux is temporary.",
  },
  "worker-shell": {
    description:
      "Fast just-bash shell with built-in file, text, data and HTTP commands over the persistent workspace. It cannot run installed Linux binaries. It runs in the foreground and cannot be interrupted or reattached. Use container or worker-javascript for cancellable or long work.",
  },
  "worker-javascript": {
    description:
      "An ECMAScript module in a fresh Worker. Export default async function(input) and return JSON. Use node:fs/promises for persistent files, fetch for network, and ws:git for workspace Git. Relative imports are workspace files. This is not Node.js.",
  },
} as const;

/** Official file tools live at the Computer owner, so their mutation locks
 * share one workspace identity across hosted and local callers. */
export function createComputerFileTools(
  workspace: CreatePiToolsOptions["workspace"]
) {
  return createPiTools({ workspace: { fs: workspace.fs }, assets: false });
}

export function describeComputer(
  tools: ReturnType<typeof createComputerFileTools>,
  browserDescription?: string,
  storage?: CloudComputerStorage
) {
  return {
    kind: "capabilities" as const,
    capabilities: {
      ...(storage ? { storage } : {}),
      repositories:
        "Prefer a persistent repository under /computer/projects/<organization-id>/<project-id>/repo and separate task worktrees beside it. Use IDs only when already known; otherwise use a distinct repository-derived key under /computer/projects. Do not look up or create a Project merely to name a directory. Inspect existing repository identity, status and worktrees before cloning. Use the actual default branch and pin each task to a commit; do not switch or reset another task's checkout. This is a convention, not a required path or a shared Team permission. Independent clones remain appropriate when isolation requires them. Worktrees share Git objects, not dependencies or all working files. Before cleanup inspect uncommitted/unpushed work and active commands; never delete the primary repository while linked worktrees need it.",
      backends: COMPUTER_BACKENDS,
      files: tools.tools,
      command: {
        start:
          "{action:'command', invocationId, cwd?, command:{action:'start', key, command, backend?, env?, stdin?, input?, timeoutSeconds?}}",
        poll: "{action:'command', invocationId, command:{action:'poll', key, after?, waitSeconds?}}",
        stop: "{action:'command', invocationId, command:{action:'stop', key, signal?}}",
        list: "{action:'command', invocationId, command:{action:'list'}}",
      },
      persistence:
        "Use /computer for files shared across all engines and tasks. Processes, installed OS packages and browser sessions can be lost on runtime recreation.",
      concurrency:
        "Commands can run concurrently. Use distinct files or Git worktrees for simultaneous edits. File tools serialize their own mutations; shell and JavaScript writes do not participate in those locks.",
      network:
        "All three engines can access the network. Plugin account connections are separate from network availability.",
      output:
        "Command replies keep the last 50,000 characters per stream and report outputTruncated when clipped. Redirect large output to /computer and read the file with pagination.",
      interaction:
        "stdin is supplied at launch. The upstream runtime has no interactive PTY or write-to-running-stdin API. Use scripts or a running service when interaction is needed.",
      browser: {
        available: browserDescription !== undefined,
        description: browserDescription,
        usage:
          "action=browser with code runs a one-shot browser script. action=preview with port, path and expectedText inspects a running Linux web server. Neither creates a public URL or persistent human desktop session.",
      },
    },
  };
}

export function createNativeComputerTool(input: {
  workspaceAccess: AgentComputerWorkspaceAccess;
  invocationId: string;
  workingDirectory: string;
  hasPendingInput?: () => Promise<boolean>;
}): RemoteAgentToolDefinition {
  const schema = strictObject({
    action: picklist(["describe", "files", "command", "browser", "preview"]),
    tool: optional(
      picklist(["read", "ls", "find", "grep", "write", "edit", "delete"])
    ),
    input: optional(record(string(), unknown())),
    cwd: optional(string()),
  });
  return {
    name: "computer",
    description:
      "Operate your personal cloud Computer. action=describe returns the official file-tool schemas and the three execution engines. action=files invokes an official file tool: tool=read, ls, find, grep, write, edit or delete, with its parameters in input. Paths are absolute, normally under /computer. action=command runs or inspects a command using input={action:'start',key,command,backend?,env?,stdin?,input?,timeoutSeconds?}, or poll/stop/list. backend defaults to container; worker-javascript accepts an ECMAScript module. cwd selects the working directory. Reuse the same key for polling and recovery, never blindly restart after an uncertain response. For files use {action:'files',tool:'read',input:{path:'/computer/home/example.txt'}}. Use shell or JavaScript for filesystem operations beyond the file tools, binary data, installation and arbitrary programs. action=browser uses input={code}; describe supplies the browser script API. action=preview uses input={port,path,expectedText} to inspect a Linux web server. File access does not publish files to other people.",
    input: schema,
    async execute(value, options) {
      const request = parse(schema, value);
      options?.signal?.throwIfAborted();
      if (!input.workspaceAccess.computerOperation) {
        throw new Error("computer.operations_unavailable");
      }
      let operation: unknown;
      if (request.action === "command") {
        operation = {
          action: "command",
          invocationId: input.invocationId,
          cwd: request.cwd ?? input.workingDirectory,
          command: request.input,
        };
      } else if (request.action === "files") {
        operation = {
          action: "files",
          tool: request.tool,
          input: request.input,
        };
      } else {
        operation = { ...request.input, action: request.action };
      }
      const parsed = cloudComputerOperationSchema.parse(operation);
      const execute = input.workspaceAccess.computerOperation.bind(
        input.workspaceAccess
      );
      return parsed.action === "command"
        ? await executeAgentComputerCommand({
            operation: parsed,
            execute,
            signal: options?.signal,
            hasPendingInput: input.hasPendingInput,
          })
        : await execute(parsed);
    },
  };
}
