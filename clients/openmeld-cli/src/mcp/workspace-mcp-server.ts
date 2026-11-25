import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  openMeldRuntimeProfileIdSchema,
  spaceTaskIdSchema,
  spaceTaskPhaseSchema,
} from "@openmeld/schemas";
import { z } from "zod/v4";
import { isBinaryDistribution } from "../runtime/distribution";
import { OPENMELD_VERSION } from "../runtime/version";

/**
 * `openmeld mcp` lets any MCP client (Claude Code, Codex, Cursor, Claude
 * Desktop) work in OpenMeld Spaces as the signed-in CLI profile.
 *
 * Every tool runs one ordinary `openmeld` command in Agent View. The CLI stays
 * the single authority for sign-in, profile selection, Space access, addressing
 * and Task rules; this server only translates tool input into argv. It must
 * not call the Gateway directly or grow its own copy of those rules.
 */

export const WORKSPACE_MCP_SERVER_NAME = "openmeld";

export const WORKSPACE_MCP_INSTRUCTIONS =
  "These tools act in OpenMeld Spaces as the signed-in OpenMeld CLI profile. Start with list_spaces to find a Space ID, then read_space_board and read_space_history for context. list_space_members returns the profile IDs that send_space_message and create_space_task accept. A message reaches nobody unless it names recipients: wake asks an Agent to work, reference shares context with an Agent without asking it to work, and mention notifies a person. Use Tasks only for a clear deliverable that needs ownership, review, or later closure. Pass the Task revision you read when changing a Task. If a tool reports that sign-in or setup is needed, ask the person to run the command it names in a terminal; do not retry in a loop.";

const CLI_TIMEOUT_MS = 120_000;
const CLI_OUTPUT_MAX_BYTES = 1_000_000;

export type WorkspaceCliInvocation = {
  args: string[];
  stdin?: string;
};

export type WorkspaceCliResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type WorkspaceCliRunner = (
  invocation: WorkspaceCliInvocation
) => Promise<WorkspaceCliResult>;

type WorkspaceMcpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type WorkspaceMcpTool<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  annotations: WorkspaceMcpToolAnnotations;
  toInvocation: (args: z.output<z.ZodObject<Shape>>) => WorkspaceCliInvocation;
};

const READ_ANNOTATIONS: WorkspaceMcpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const WRITE_ANNOTATIONS: WorkspaceMcpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const spaceInput = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .describe("Space URL or 64-character Space ID");
const revisionInput = z.number().int().min(1);
const profileIdList = z.array(openMeldRuntimeProfileIdSchema).max(20);

function defineTool<Shape extends z.ZodRawShape>(
  tool: WorkspaceMcpTool<Shape>
): WorkspaceMcpTool {
  return tool as unknown as WorkspaceMcpTool;
}

function repeatOption(flag: string, values: readonly string[] | undefined) {
  return (values ?? []).flatMap((value) => [flag, value]);
}

/**
 * Tool input is untrusted model output. A value that starts with "-" could be
 * read as a CLI option, so positional values are always passed after "--".
 */
function positional(...values: string[]): string[] {
  return ["--", ...values];
}

export function buildWorkspaceMcpTools(options: {
  readOnly: boolean;
}): WorkspaceMcpTool[] {
  const readTools = [
    defineTool({
      name: "list_spaces",
      title: "List OpenMeld Spaces",
      description:
        "List the Spaces this profile knows, most recent first. Returns Space IDs for the other tools.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: READ_ANNOTATIONS,
      toInvocation: ({ limit }) => ({
        args: ["space", "list", "--json", "--limit", String(limit ?? 20)],
      }),
    }),
    defineTool({
      name: "read_space_board",
      title: "Read a Space Board",
      description:
        "Read a Space's purpose, guide, member counts, who is working now, and the ten most recent outcomes.",
      inputSchema: { space: spaceInput },
      annotations: READ_ANNOTATIONS,
      toInvocation: ({ space }) => ({
        args: ["space", "board", "--json", ...positional(space)],
      }),
    }),
    defineTool({
      name: "list_space_members",
      title: "List the people and Agents in a Space",
      description:
        "List Space members with their profile IDs and whether each Agent can be woken right now.",
      inputSchema: { space: spaceInput },
      annotations: READ_ANNOTATIONS,
      toInvocation: ({ space }) => ({
        args: ["space", "members", "--json", "--brief", ...positional(space)],
      }),
    }),
    defineTool({
      name: "read_space_history",
      title: "Read recent Space messages",
      description:
        "Read the most recent text messages in a Space, oldest first. Long messages are shortened.",
      inputSchema: {
        space: spaceInput,
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ_ANNOTATIONS,
      toInvocation: ({ limit, space }) => ({
        args: [
          "space",
          "history",
          "--kind",
          "text",
          "--brief",
          "--limit",
          String(limit ?? 20),
          ...positional(space),
        ],
      }),
    }),
    defineTool({
      name: "list_space_tasks",
      title: "List Tasks in a Space",
      description:
        "List the durable Tasks in a Space with their phase, owner, and revision.",
      inputSchema: {
        space: spaceInput,
        phase: spaceTaskPhaseSchema.optional(),
      },
      annotations: READ_ANNOTATIONS,
      toInvocation: ({ phase, space }) => ({
        args: [
          "space",
          "tasks",
          "--json",
          ...(phase ? ["--phase", phase] : []),
          ...positional(space),
        ],
      }),
    }),
    defineTool({
      name: "read_space_task",
      title: "Read one Space Task",
      description:
        "Read one Task with its result, review, history, and the actions this profile may take.",
      inputSchema: { space: spaceInput, taskId: spaceTaskIdSchema },
      annotations: READ_ANNOTATIONS,
      toInvocation: ({ space, taskId }) => ({
        args: [
          "space",
          "tasks",
          "show",
          "--json",
          ...positional(space, taskId),
        ],
      }),
    }),
  ];
  if (options.readOnly) {
    return readTools;
  }

  return [
    ...readTools,
    defineTool({
      name: "send_space_message",
      title: "Send a message to a Space",
      description:
        "Post one message as the signed-in profile. Name recipients by profile ID from list_space_members: wake asks an Agent to work, reference gives an Agent context only, mention notifies a person. With no recipients the message is posted for the room and wakes nobody.",
      inputSchema: {
        space: spaceInput,
        text: z.string().trim().min(1).max(20_000),
        wake: profileIdList.optional(),
        reference: profileIdList.optional(),
        mention: profileIdList.optional(),
      },
      annotations: WRITE_ANNOTATIONS,
      toInvocation: ({ mention, reference, space, text, wake }) => {
        const recipients = [
          ...repeatOption("--wake", wake),
          ...repeatOption("--reference", reference),
          ...repeatOption("--mention", mention),
        ];
        return {
          args: [
            "space",
            "send",
            "--stdin",
            ...(recipients.length > 0 ? recipients : ["--plain"]),
            ...positional(space),
          ],
          stdin: text,
        };
      },
    }),
    defineTool({
      name: "create_space_task",
      title: "Create a Task in a Space",
      description:
        "Create a durable Task for a clear deliverable. Do not create a Task for a question or a small same-turn action.",
      inputSchema: {
        space: spaceInput,
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(8000).optional(),
        completionConditions: z
          .array(z.string().trim().min(1).max(500))
          .max(12)
          .optional(),
        assigneeProfileId: openMeldRuntimeProfileIdSchema.optional(),
        reviewerProfileId: openMeldRuntimeProfileIdSchema.optional(),
      },
      annotations: WRITE_ANNOTATIONS,
      toInvocation: (input) => ({
        args: [
          "space",
          "tasks",
          "create",
          "--json",
          ...(input.description ? ["--description", input.description] : []),
          ...repeatOption("--done-when", input.completionConditions),
          ...(input.assigneeProfileId
            ? ["--assignee", input.assigneeProfileId]
            : []),
          ...(input.reviewerProfileId
            ? ["--reviewer", input.reviewerProfileId]
            : []),
          ...positional(input.space, input.title),
        ],
      }),
    }),
    defineTool({
      name: "start_space_task",
      title: "Mark a Space Task in progress",
      description:
        "Record that the assignee has started the Task. This changes collaboration state; it does not start an Agent.",
      inputSchema: {
        space: spaceInput,
        taskId: spaceTaskIdSchema,
        expectedRevision: revisionInput,
      },
      annotations: WRITE_ANNOTATIONS,
      toInvocation: ({ expectedRevision, space, taskId }) => ({
        args: [
          "space",
          "tasks",
          "start",
          "--json",
          "--revision",
          String(expectedRevision),
          ...positional(space, taskId),
        ],
      }),
    }),
    defineTool({
      name: "submit_space_task_result",
      title: "Submit the result of a Space Task",
      description:
        "Submit what was delivered and how it was verified. A Task with a reviewer moves to In review; otherwise it moves to Done.",
      inputSchema: {
        space: spaceInput,
        taskId: spaceTaskIdSchema,
        expectedRevision: revisionInput,
        summary: z.string().trim().min(1).max(8000),
      },
      annotations: WRITE_ANNOTATIONS,
      toInvocation: ({ expectedRevision, space, summary, taskId }) => ({
        args: [
          "space",
          "tasks",
          "submit",
          "--json",
          "--revision",
          String(expectedRevision),
          "--summary",
          summary,
          ...positional(space, taskId),
        ],
      }),
    }),
    defineTool({
      name: "review_space_task",
      title: "Review a Space Task result",
      description:
        "As the Task's reviewer, accept the exact result you read or request specific changes. Requesting changes needs feedback.",
      inputSchema: {
        space: spaceInput,
        taskId: spaceTaskIdSchema,
        expectedRevision: revisionInput,
        expectedResultRevision: revisionInput,
        decision: z.enum(["accepted", "changes_requested"]),
        feedback: z.string().trim().min(1).max(8000).optional(),
      },
      annotations: WRITE_ANNOTATIONS,
      toInvocation: (input) => ({
        args: [
          "space",
          "tasks",
          "review",
          "--json",
          "--revision",
          String(input.expectedRevision),
          "--result-revision",
          String(input.expectedResultRevision),
          input.decision === "accepted" ? "--accept" : "--request-changes",
          ...(input.feedback ? ["--feedback", input.feedback] : []),
          ...positional(input.space, input.taskId),
        ],
      }),
    }),
    defineTool({
      name: "cancel_space_task",
      title: "Cancel a Space Task",
      description: "Cancel a Task that should no longer be worked on.",
      inputSchema: {
        space: spaceInput,
        taskId: spaceTaskIdSchema,
        expectedRevision: revisionInput,
        reason: z.string().trim().min(1).max(1000),
      },
      annotations: { ...WRITE_ANNOTATIONS, destructiveHint: true },
      toInvocation: ({ expectedRevision, reason, space, taskId }) => ({
        args: [
          "space",
          "tasks",
          "cancel",
          "--json",
          "--revision",
          String(expectedRevision),
          "--reason",
          reason,
          ...positional(space, taskId),
        ],
      }),
    }),
  ];
}

/** Prefixes that make one tool invocation a non-interactive Agent View run. */
export function buildWorkspaceCliArgv(input: {
  invocation: WorkspaceCliInvocation;
  profile?: string;
}): string[] {
  const profile = input.profile?.trim();
  const separatorIndex = input.invocation.args.indexOf("--");
  const head =
    separatorIndex === -1
      ? input.invocation.args
      : input.invocation.args.slice(0, separatorIndex);
  const tail =
    separatorIndex === -1 ? [] : input.invocation.args.slice(separatorIndex);
  return [
    "--view",
    "agent",
    ...head,
    ...(profile ? ["--profile", profile] : []),
    ...tail,
  ];
}

export function formatWorkspaceCliResult(result: WorkspaceCliResult): {
  content: { type: "text"; text: string }[];
  isError?: true;
} {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (result.timedOut) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `OpenMeld did not answer within ${CLI_TIMEOUT_MS / 1000} seconds. The outcome is unknown; read the current state before trying again.`,
        },
      ],
    };
  }
  if (result.exitCode !== 0) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            [stderr, stdout].filter((part) => part.length > 0).join("\n") ||
            `OpenMeld command failed with exit code ${String(result.exitCode)}.`,
        },
      ],
    };
  }
  return { content: [{ type: "text", text: stdout || "Done." }] };
}

export function createWorkspaceMcpServer(input: {
  readOnly: boolean;
  profile?: string;
  runCli: WorkspaceCliRunner;
}): McpServer {
  const server = new McpServer(
    { name: WORKSPACE_MCP_SERVER_NAME, version: OPENMELD_VERSION },
    { instructions: WORKSPACE_MCP_INSTRUCTIONS }
  );
  for (const tool of buildWorkspaceMcpTools({ readOnly: input.readOnly })) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args) => {
        try {
          const invocation = tool.toInvocation(args);
          return formatWorkspaceCliResult(
            await input.runCli({
              args: buildWorkspaceCliArgv({
                invocation,
                profile: input.profile,
              }),
              stdin: invocation.stdin,
            })
          );
        } catch (error) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      }
    );
  }
  return server;
}

/** How this running CLI starts another copy of itself. */
export function resolveSelfCliCommand(input?: {
  argv?: readonly string[];
  binary?: boolean;
  execPath?: string;
}): { command: string; prefixArgs: string[] } {
  const execPath = input?.execPath ?? process.execPath;
  if (input?.binary ?? isBinaryDistribution()) {
    return { command: execPath, prefixArgs: [] };
  }
  const entry = String((input?.argv ?? process.argv)[1] ?? "").trim();
  if (entry.length === 0) {
    throw new Error("openmeld mcp could not resolve the current CLI entry.");
  }
  return { command: execPath, prefixArgs: [entry] };
}

export function createSelfCliRunner(): WorkspaceCliRunner {
  const self = resolveSelfCliCommand();
  return async (invocation) =>
    await new Promise<WorkspaceCliResult>((resolvePromise) => {
      // The child never inherits this process's stdio: stdout is the MCP
      // protocol channel and one stray line would break the client.
      const child = spawn(
        self.command,
        [...self.prefixArgs, ...invocation.args],
        { stdio: ["pipe", "pipe", "pipe"], env: process.env }
      );
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      const settle = (exitCode: number | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolvePromise({ exitCode, stdout, stderr, timedOut });
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, CLI_TIMEOUT_MS);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (stdout.length < CLI_OUTPUT_MAX_BYTES) {
          stdout += chunk;
        }
      });
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < CLI_OUTPUT_MAX_BYTES) {
          stderr += chunk;
        }
      });
      child.on("error", (error) => {
        stderr += error.message;
        settle(null);
      });
      child.on("close", (code) => settle(code));
      child.stdin.on("error", () => {
        // The command may exit before reading stdin; its exit code reports it.
      });
      child.stdin.end(invocation.stdin ?? "");
    });
}

export function parseWorkspaceMcpArgv(argv: readonly string[]): {
  readOnly: boolean;
  profile?: string;
} {
  const args = argv.slice(3);
  let readOnly = false;
  let profile: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--read-only") {
      readOnly = true;
      continue;
    }
    if (arg === "--profile") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("openmeld mcp --profile needs a profile ID.");
      }
      profile = value;
      index += 1;
      continue;
    }
    throw new Error(
      `Unknown openmeld mcp option "${String(arg)}". Supported: --read-only, --profile <id>.`
    );
  }
  return { readOnly, ...(profile ? { profile } : {}) };
}

export async function runWorkspaceMcpServer(
  argv: readonly string[] = process.argv
): Promise<void> {
  const options = parseWorkspaceMcpArgv(argv);
  const server = createWorkspaceMcpServer({
    ...options,
    runCli: createSelfCliRunner(),
  });
  await server.connect(new StdioServerTransport());
}
