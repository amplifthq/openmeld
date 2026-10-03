import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type AdapterDispatchSpaceTool,
  type AdapterDispatchSpaceToolResult,
  type AdapterDispatchSpaceTools,
  isDispatchSpaceActionDeliveryOnly,
} from "@openmeld/adapter-core";
import {
  dispatchProjectShellInputSchema,
  dispatchProjectShellResultSchema,
  dispatchSpaceActionToolResultSchema,
  dispatchSpaceHistoryRequestSchema,
  dispatchSpaceReadResultRequestSchema,
  dispatchSpaceReadResultSchema,
  openDirectMessageSpaceBodySchema,
  openMeldRuntimeProfileIdSchema,
  spaceFileEntryIdSchema,
  spaceFileRevisionNumberSchema,
  spaceMessageFileReferenceSchema,
  spaceTaskIdSchema,
  spaceTaskMutationReceiptSchema,
} from "@openmeld/schemas";
import { z } from "zod/v4";
import { runExecutionContextWorkspaceProjectShell } from "../local-service/dispatch/execution-context-workspace";
import type { DispatchSpaceActionRecord } from "../runtime/dispatch-space-action-context";
import {
  DispatchSpaceActionClosedError,
  DispatchSpaceActionRejectedError,
  readDispatchSpaceActionContextForReceiptFromEnv,
  readDispatchSpaceActionContextFromEnv,
  readDispatchSpaceActionRecord,
} from "../runtime/dispatch-space-action-context";
import { recordDispatchSpaceProgress } from "../runtime/dispatch-space-progress-relay";
import {
  recordDispatchSpaceReply,
  recordDispatchSpaceSilent,
} from "./action-command";
import { openDirectMessage } from "./direct-message";
import { readDispatchSpaceFile } from "./dispatch-file-read";
import { readDispatchSpaceHistory } from "./dispatch-history-read";
import { DispatchReadResults } from "./dispatch-read-result";
import {
  createDispatchSpaceTask,
  listDispatchSpaceTasks,
  mutateDispatchSpaceTask,
} from "./dispatch-task";
import { runDispatchWorkingCopy } from "./dispatch-working-copy";

export const DISPATCH_SPACE_TOOL_INSTRUCTIONS =
  "Use read_history for the bounded text history around the current Wake, and read_file for shared text files in the current Space. When report_progress is available, use it only for a brief deliberate public update during meaningful multi-step work; it is non-final and does not replace the final action. Use Space Task tools only when a clear deliverable needs durable ownership, progress, review, or later closure; questions and tiny same-turn actions stay in Messages. Task operations are non-final. Then choose exactly one permitted final OpenMeld Space Action: reply for an answer, limitation, error explanation, or request for help; stay_silent only when no public communication is appropriate. Do not create a Task just to acknowledge a message. Parameter validation errors record no action and may be corrected. Use read_receipt to reconcile an unknown outcome before resending. Private assistant output is not posted to the Space.";

export type DispatchPublicProgressResult = {
  status: "accepted" | "duplicate" | "unavailable";
};

/** Every carrier uses the same schemas, validation, authority and recorder. */
class DispatchSpaceTools implements AdapterDispatchSpaceTools {
  readonly tools: AdapterDispatchSpaceTool[] = [];
  readonly deliveryOnly: boolean;
  readonly #env: NodeJS.ProcessEnv;
  readonly #context: ReturnType<
    typeof readDispatchSpaceActionContextForReceiptFromEnv
  >;
  readonly #handlers = new Map<
    string,
    (args: unknown) => Promise<AdapterDispatchSpaceToolResult>
  >();
  #closed = false;
  readonly #readResults = new DispatchReadResults();

  constructor(env: NodeJS.ProcessEnv) {
    this.#env = Object.freeze({ ...env });
    this.#context = readDispatchSpaceActionContextForReceiptFromEnv(this.#env);
    this.deliveryOnly = isDispatchSpaceActionDeliveryOnly(this.#env);
  }

  registerTool<Shape extends z.ZodRawShape>(
    name: string,
    config: Omit<AdapterDispatchSpaceTool, "name" | "inputSchema"> & {
      inputSchema: Shape | z.ZodObject<Shape>;
    },
    handler: (
      args: z.output<z.ZodObject<Shape>>
    ) => Promise<AdapterDispatchSpaceToolResult>
  ): void {
    if (
      this.deliveryOnly &&
      !["reply", "stay_silent", "read_receipt"].includes(name)
    ) {
      return;
    }
    const inputSchema =
      config.inputSchema instanceof z.ZodObject
        ? config.inputSchema
        : z.strictObject(config.inputSchema);
    const pagedRead = ["read_history", "read_file", "list_tasks"].includes(
      name
    );
    this.tools.push({
      ...config,
      name,
      inputSchema,
      ...(pagedRead
        ? {
            outputSchema: dispatchSpaceReadResultSchema,
            description: `${config.description} Small reads return result; large reads return page. Continue with read_result using page.resultId and page.nextOffset; no local file is needed.`,
          }
        : {}),
    });
    this.#handlers.set(name, (args) => {
      const parsed = inputSchema.safeParse(args);
      if (!parsed.success) {
        return executeSpaceAction(() => {
          throw new DispatchSpaceActionRejectedError(
            "space_action.invalid_input",
            parsed.error.message
          );
        }, this.#env);
      }
      return handler(parsed.data);
    });
  }

  async call(
    name: string,
    args: unknown
  ): Promise<AdapterDispatchSpaceToolResult> {
    const context = readDispatchSpaceActionContextForReceiptFromEnv(this.#env);
    if (
      this.#closed ||
      context.contextId !== this.#context.contextId ||
      context.nonce !== this.#context.nonce
    ) {
      return executeSpaceAction(() => {
        throw new DispatchSpaceActionClosedError(
          "space_action.context_mismatch",
          "This tool invocation no longer owns the active Wake. Do not retry through another transport."
        );
      }, this.#env);
    }
    const handler = this.#handlers.get(name);
    if (!handler) {
      return executeSpaceAction(() => {
        throw new DispatchSpaceActionRejectedError(
          "space_action.not_allowed",
          "This tool is not available in the current invocation. Final communication uses reply or stay_silent, subject to the existing Space policy."
        );
      }, this.#env);
    }
    const pagedRead = ["read_history", "read_file", "list_tasks"].includes(
      name
    );
    if (pagedRead || name === "read_result") {
      try {
        readDispatchSpaceActionContextFromEnv(this.#env);
        const result = await handler(args);
        const active = readDispatchSpaceActionContextFromEnv(this.#env);
        if (
          this.#closed ||
          active.contextId !== this.#context.contextId ||
          active.nonce !== this.#context.nonce
        ) {
          throw new Error(
            "The Wake changed or closed during this read. No result is available."
          );
        }
        return pagedRead ? this.#readResults.wrap(result) : result;
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                error instanceof Error
                  ? error.message
                  : "The Space read failed.",
            },
          ],
        };
      }
    }
    return await handler(args);
  }

  registerResultReader(): void {
    this.registerTool(
      "read_result",
      {
        title: "Continue reading a large Space tool result",
        description:
          "Read the next page of a large read_history, read_file, or list_tasks result. Pass the returned resultId and nextOffset exactly; append page.text in order to reconstruct the complete JSON. No local path or shell is needed. The snapshot belongs only to this active Wake and tool connection; after expiry or eviction, read the source again. Does not publish or repeat an operation.",
        inputSchema: dispatchSpaceReadResultRequestSchema,
        outputSchema: dispatchSpaceReadResultSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ resultId, offset }) => this.#readResults.read(resultId, offset)
    );
  }

  close(): void {
    this.#closed = true;
    this.#readResults.clear();
  }
}

export function createDispatchSpaceTools(
  input: {
    env?: NodeJS.ProcessEnv;
    reportProgress?: (
      update: string
    ) => DispatchPublicProgressResult | Promise<DispatchPublicProgressResult>;
  } = {}
): AdapterDispatchSpaceTools {
  const env = Object.freeze({ ...(input.env ?? process.env) });
  const server = new DispatchSpaceTools(env);

  const projectShell =
    readDispatchSpaceActionContextForReceiptFromEnv(env).projectShell;
  if (projectShell) {
    server.registerTool(
      "project_shell",
      {
        title: "Run a command in this task's project worktree",
        description:
          "Run one Bash command inside this task's isolated project container. Only its private worktree is mounted. The container has no network, host credentials, or Docker socket. This tool does not submit the final Space action.",
        inputSchema: dispatchProjectShellInputSchema,
        outputSchema: dispatchProjectShellResultSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async ({ command }) => {
        try {
          const context = readDispatchSpaceActionContextForReceiptFromEnv(env);
          if (
            !context.projectShell ||
            context.projectShell.executionContextId !==
              projectShell.executionContextId ||
            context.projectShell.boundaryRoot !== projectShell.boundaryRoot ||
            context.projectShell.ledgerRootPath !==
              projectShell.ledgerRootPath ||
            context.projectShell.workspacePath !== projectShell.workspacePath ||
            context.projectShell.runtime.binary !==
              projectShell.runtime.binary ||
            context.projectShell.runtime.engineIdentity !==
              projectShell.runtime.engineIdentity ||
            context.projectShell.runtime.kind !== projectShell.runtime.kind
          ) {
            throw new Error("claude_project.context_mismatch");
          }
          const result = dispatchProjectShellResultSchema.parse(
            await runExecutionContextWorkspaceProjectShell({
              ledgerRootPath: projectShell.ledgerRootPath,
              contextId: projectShell.executionContextId,
              dispatchId: context.dispatchId,
              attemptId: context.attemptId,
              command,
              runtime: projectShell.runtime,
              boundaryRoot: projectShell.boundaryRoot,
              workspacePath: projectShell.workspacePath,
            })
          );
          return {
            structuredContent: result,
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        } catch (error) {
          const code =
            error instanceof Error &&
            error.message.startsWith("claude_project.")
              ? (error.message.split(":")[0] ??
                "claude_project.execution_failed")
              : "claude_project.execution_failed";
          return {
            isError: true,
            content: [{ type: "text" as const, text: code }],
          };
        }
      }
    );
  }

  server.registerTool(
    "working_copy",
    {
      title: "Save or inspect this handoff's files",
      description:
        "Inspect or commit this handoff's files; reconcile retries an unknown save. On conflict, refresh downloads the shared version, then status shows its path and revision. Merge it into the original working file, then resolve with fileId and incoming revision before committing again. No automatic merge or overwrite. Does not deliver or close the Wake. No Space, profile or path overrides.",
      inputSchema: {
        action: z.enum(["status", "commit", "reconcile", "refresh", "resolve"]),
        fileId: z.string().optional(),
        revision: z.number().int().positive().optional(),
      },
    },
    async ({ action, fileId, revision }) => {
      try {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                await runDispatchWorkingCopy(action, { fileId, revision }, env)
              ),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
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

  server.registerTool(
    "read_history",
    {
      title: "Read the current Wake's Space history",
      description:
        "Read up to 20 text messages before the current Wake, plus its source message. Space, Agent identity and source are fixed by the active dispatch. Use this instead of terminal CLI history. This read does not submit a reply or close the Wake.",
      inputSchema: dispatchSpaceHistoryRequestSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const result = await readDispatchSpaceHistory(env);
        return {
          structuredContent: result,
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        return {
          isError: true,
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

  server.registerTool(
    "read_file",
    {
      title: "Read a file in the current OpenMeld Space",
      description:
        "Read a shared text file as the Agent in the current Wake. Use this for attached CSV, text, Markdown, or JSON files instead of running the CLI in a terminal. Pass the attachment's file ID and revision. This is a context read; it does not submit a reply or close the Wake.",
      inputSchema: {
        fileId: spaceFileEntryIdSchema,
        revision: spaceFileRevisionNumberSchema.optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const result = await readDispatchSpaceFile({ ...input, env });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        };
      }
    }
  );

  if (input.reportProgress) {
    server.registerTool(
      "report_progress",
      {
        title: "Share public progress in the current OpenMeld Space",
        description:
          "Share one brief, concrete update while this Wake is still running. Use this only when you start meaningful work, confirm a useful fact, change direction, or begin verification. Do not include private reasoning, protected information, credentials, raw commands, or unverified claims. Exact retries are idempotent. This does not post a final reply, close the Wake, or resume a parent task.",
        inputSchema: {
          update: z.string().trim().min(1).max(600),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ update }) => {
        const result = await input.reportProgress?.(update);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                result ?? ({ status: "unavailable" } as const)
              ),
            },
          ],
        };
      }
    );
  }

  server.registerTool(
    "open_direct_message",
    {
      title: "Open or send a Direct Message",
      description:
        "Open or reuse your private conversation with a Human or Agent in this organization. Open without message first to obtain spaceId. Then include that spaceId and a message with a stable UUID clientMessageId and wake=true to assign work; wake=false sends context only. Those IDs let you stop the request immediately with space wake-stop. Keep both IDs on retries. Agent owners can read and join. This is non-final: still return your final action to the current Space. A sent message does not prove work completed. Do not send acknowledgements that wake another Agent or forward unrelated private context.",
      inputSchema: openDirectMessageSpaceBodySchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) =>
      executeTaskAction(() => {
        if (request.message?.wake && !request.spaceId) {
          throw new Error(
            "Open the Direct Message first, then include its spaceId when assigning work."
          );
        }
        return openDirectMessage({ request, env });
      })
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks in the current OpenMeld Space",
      description:
        "Read durable collaboration Tasks for this Space. Use the returned revision before changing a Task. Task phase is collaboration state, not Agent execution truth.",
      inputSchema: {
        phase: z
          .enum(["to_do", "in_progress", "in_review", "done", "canceled"])
          .optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ phase }) =>
      executeTaskAction(() => listDispatchSpaceTasks(phase, env))
  );

  server.registerTool(
    "create_task",
    {
      title: "Create a Task from the current Space message",
      description:
        "Create a durable Task only for a clear deliverable that needs ownership, progress, review, or later closure. The source message and Space are fixed by this Wake. The Task is assigned to the current Agent by default and remains To do until start_task is called.",
      inputSchema: {
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(8000).nullable().optional(),
        completionConditions: z
          .array(z.string().trim().min(1).max(500))
          .max(12)
          .optional(),
        assigneeProfileId: openMeldRuntimeProfileIdSchema.nullable().optional(),
        reviewerProfileId: openMeldRuntimeProfileIdSchema.nullable().optional(),
      },
      outputSchema: spaceTaskMutationReceiptSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (body) => executeTaskAction(() => createDispatchSpaceTask(body, env))
  );

  server.registerTool(
    "start_task",
    {
      title: "Mark a Space Task in progress",
      description:
        "Record that the current assigned Agent has begun advancing this Task. This changes collaboration state and does not start a separate Agent execution.",
      inputSchema: {
        taskId: spaceTaskIdSchema,
        expectedRevision: z.number().int().min(1),
      },
      outputSchema: spaceTaskMutationReceiptSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ expectedRevision, taskId }) =>
      executeTaskAction(() =>
        mutateDispatchSpaceTask(
          {
            taskId,
            body: { action: "mark_in_progress", expectedRevision },
          },
          env
        )
      )
  );

  server.registerTool(
    "submit_task_result",
    {
      title: "Submit a result for a Space Task",
      description:
        "Submit the concrete result and verification for an in-progress Task. A Task with a reviewer moves to In review; otherwise the stated completion boundary moves it to Done. The Space delivers the review handoff to the reviewer.",
      inputSchema: {
        taskId: spaceTaskIdSchema,
        expectedRevision: z.number().int().min(1),
        summary: z.string().trim().min(1).max(8000),
      },
      outputSchema: spaceTaskMutationReceiptSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ expectedRevision, summary, taskId }) =>
      executeTaskAction(() =>
        mutateDispatchSpaceTask(
          {
            taskId,
            body: { action: "submit_result", expectedRevision, summary },
          },
          env
        )
      )
  );

  server.registerTool(
    "review_task",
    {
      title: "Review a Space Task result",
      description:
        "Accept the exact result you read or request specific changes as this Task's reviewer. Pass that result's resultRevision as expectedResultRevision and the Task's revision as expectedRevision. A conflict requires reading the current Task and deciding again. Change requests require feedback. The Space delivers review and rework handoffs. Agent-to-Agent rework stops for a human decision after two automatic rounds.",
      inputSchema: {
        taskId: spaceTaskIdSchema,
        expectedRevision: z.number().int().min(1),
        expectedResultRevision: z.number().int().min(1),
        decision: z.enum(["accepted", "changes_requested"]),
        feedback: z.string().trim().min(1).max(8000).nullable().optional(),
      },
      outputSchema: spaceTaskMutationReceiptSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      decision,
      expectedRevision,
      expectedResultRevision,
      feedback,
      taskId,
    }) =>
      executeTaskAction(() =>
        mutateDispatchSpaceTask(
          {
            taskId,
            body: {
              action: "review",
              expectedRevision,
              expectedResultRevision,
              decision,
              ...(feedback === undefined ? {} : { feedback }),
            },
          },
          env
        )
      )
  );

  server.registerTool(
    "cancel_task",
    {
      title: "Cancel a Space Task",
      description:
        "Cancel a Task when its accepted commitment should no longer be done. Cancellation fences later Task progress; it does not by itself prove that an Agent execution stopped.",
      inputSchema: {
        taskId: spaceTaskIdSchema,
        expectedRevision: z.number().int().min(1),
        reason: z.string().trim().min(1).max(1000),
      },
      outputSchema: spaceTaskMutationReceiptSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ expectedRevision, reason, taskId }) =>
      executeTaskAction(() =>
        mutateDispatchSpaceTask(
          {
            taskId,
            body: { action: "cancel", expectedRevision, reason },
          },
          env
        )
      )
  );

  server.registerTool(
    "reply",
    {
      title: "Reply in the current OpenMeld Space",
      description:
        "Record the exact final public message for the active Wake. Shared Spaces default to a thread under the triggering message; set placement=conversation only when the user asks for the main conversation or the conclusion, decision, or blocker matters to the whole Space. Direct messages remain direct. Use real newlines. Omit recipient fields for a plain reply; use full Profile IDs from this Wake's send target reference when addressing recipients. Correct invalid arguments and retry; do not bypass denials or blindly resend an unknown outcome.",
      inputSchema: {
        message: z.string().min(1),
        placement: z.enum(["conversation", "thread"]).optional(),
        files: z.array(spaceMessageFileReferenceSchema).max(10).optional(),
        mentionTargets: z.array(z.string().min(1)).optional(),
        referenceTargets: z.array(z.string().min(1)).optional(),
        wakeTargets: z.array(z.string().min(1)).optional(),
      },
      outputSchema: dispatchSpaceActionToolResultSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
    },
    async ({
      files,
      mentionTargets,
      message,
      placement,
      referenceTargets,
      wakeTargets,
    }) =>
      executeSpaceAction(
        () =>
          recordDispatchSpaceReply({
            env,
            files,
            mentionTargets,
            placement,
            referenceTargets,
            text: message,
            wakeTargets,
          }),
        env
      )
  );

  server.registerTool(
    "stay_silent",
    {
      title: "Stay silent in the current OpenMeld Space",
      description:
        "Record that the active OpenMeld Wake intentionally needs no public reply. Use this only after deciding that silence is the correct final outcome.",
      inputSchema: {
        reason: z.string().min(1),
      },
      outputSchema: dispatchSpaceActionToolResultSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
    },
    async ({ reason }) =>
      executeSpaceAction(() => recordDispatchSpaceSilent({ reason, env }), env)
  );

  server.registerResultReader();

  server.registerTool(
    "read_receipt",
    {
      title: "Check this Wake's recorded final action",
      description:
        "Reconcile an uncertain final tool result without posting, replacing, or repeating the action. A saved receipt is a local proposal, not confirmation of publication. A missing record is an observation, not permission to bypass a denial or expiry.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const context = readDispatchSpaceActionContextForReceiptFromEnv(env);
      const record = readDispatchSpaceActionRecord({ context });
      if (record.status === "loaded") {
        return await executeSpaceAction(() => record.record, env);
      }
      if (record.status === "missing") {
        return {
          content: [
            {
              type: "text" as const,
              text: "No local final action record is present. Correct invalid arguments and use a permitted final tool only while this Wake is still authorized. This read does not reserve a write or override a denial.",
            },
          ],
        };
      }
      return executeSpaceAction(() => {
        throw new Error(
          "The existing final action record cannot be verified. Do not overwrite it or resend through another transport."
        );
      }, env);
    }
  );
  return server;
}

export function createSpaceActionMcpServer(): McpServer {
  const context = readDispatchSpaceActionContextForReceiptFromEnv();
  const tools = createDispatchSpaceTools({
    reportProgress: (update) => recordDispatchSpaceProgress(update),
  });
  const server = new McpServer(
    { name: "openmeld-dispatch-space-action", version: "1.0.0" },
    { instructions: DISPATCH_SPACE_TOOL_INSTRUCTIONS }
  );
  for (const { name, ...definition } of tools.tools) {
    server.registerTool(name, definition, async (args) => {
      try {
        const active = readDispatchSpaceActionContextForReceiptFromEnv();
        if (
          active.contextId !== context.contextId ||
          active.nonce !== context.nonce
        ) {
          throw new DispatchSpaceActionClosedError(
            "space_action.context_mismatch",
            "This MCP server cannot be rebound to another Wake."
          );
        }
        return await tools.call(name, args);
      } catch (error) {
        return executeSpaceAction(() => {
          throw error;
        });
      }
    });
  }
  server.server.onclose = () => tools.close();
  return server;
}

export async function runSpaceActionMcpServer(): Promise<void> {
  readDispatchSpaceActionContextForReceiptFromEnv();
  const server = createSpaceActionMcpServer();
  await server.connect(new StdioServerTransport());
}

export async function executeSpaceAction(
  action: () => DispatchSpaceActionRecord | Promise<DispatchSpaceActionRecord>,
  env: NodeJS.ProcessEnv = process.env
) {
  try {
    const context = readDispatchSpaceActionContextForReceiptFromEnv(env);
    const record = await action();
    if (
      record.contextId !== context.contextId ||
      record.nonce !== context.nonce
    ) {
      throw new DispatchSpaceActionClosedError(
        "space_action.context_mismatch",
        "The saved action does not match the current dispatch context."
      );
    }
    const contextState =
      Date.now() > context.expiresAtMs ? "expired" : "active";
    const structuredContent = dispatchSpaceActionToolResultSchema.parse({
      receipt: {
        status: "proposal_saved_locally",
        actionType: record.action.type,
        attemptId: context.attemptId,
        contextId: context.contextId,
        dispatchId: context.dispatchId,
        recordedAtMs: record.createdAtMs,
        contextState,
        coordinatorAcceptance: "unconfirmed",
        publication: "unconfirmed",
      },
    });
    return {
      structuredContent,
      content: [
        {
          type: "text" as const,
          text: `Local proposal saved (receipt: proposal_saved_locally, action: ${record.action.type}). OpenMeld has recorded this unpublished Space action proposal on this computer. ${contextState === "expired" ? "The local context has expired. This receipt identifies the existing record and does not extend action authority. " : ""}Coordinator acceptance and Space publication are NOT yet confirmed; do not report it as posted.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof DispatchSpaceActionRejectedError) {
      return {
        structuredContent: dispatchSpaceActionToolResultSchema.parse({
          receipt: {
            status: "rejected_before_recording",
            reasonCode: error.reasonCode,
            coordinatorAcceptance: "unconfirmed",
            publication: "unconfirmed",
          },
        }),
        content: [
          {
            type: "text" as const,
            text: `Action rejected (receipt: rejected_before_recording, reason: ${error.reasonCode}). This call did not record an action. ${error.message} ${error.reasonCode === "space_action.invalid_input" ? "Correct the indicated arguments and call the same permitted tool again. " : ""}Any earlier records are preserved; Coordinator acceptance and Space publication are unconfirmed.`,
          },
        ],
        isError: true,
      };
    }
    if (error instanceof DispatchSpaceActionClosedError) {
      return {
        structuredContent: dispatchSpaceActionToolResultSchema.parse({
          receipt: {
            status: "rejected_closed",
            reasonCode: error.reasonCode,
            coordinatorAcceptance: "unconfirmed",
            publication: "unconfirmed",
          },
        }),
        content: [
          {
            type: "text" as const,
            text: `Action rejected (receipt: rejected_closed, reason: ${error.reasonCode}). ${error.message} New actions are not permitted in this context. Existing records are preserved; Coordinator acceptance and Space publication are unconfirmed.`,
          },
        ],
        isError: true,
      };
    }
    return {
      structuredContent: dispatchSpaceActionToolResultSchema.parse({
        receipt: {
          status: "outcome_unknown",
          reasonCode: "space_action.recording_outcome_unknown",
          coordinatorAcceptance: "unconfirmed",
          publication: "unconfirmed",
        },
      }),
      content: [
        {
          type: "text" as const,
          text: `Action receipt unavailable (receipt: outcome_unknown). ${error instanceof Error ? error.message : String(error)} Existing records are preserved; Coordinator acceptance and Space publication are unconfirmed.`,
        },
      ],
      isError: true,
    };
  }
}

async function executeTaskAction<T extends Record<string, unknown>>(
  action: () => Promise<T>
) {
  try {
    const result = await action();
    return {
      structuredContent: result,
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}
