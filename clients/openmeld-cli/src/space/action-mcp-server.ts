import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  dispatchSpaceActionToolResultSchema,
  spaceFileEntryIdSchema,
  spaceFileRevisionNumberSchema,
} from "@openmeld/schemas";
import { z } from "zod/v4";
import type { DispatchSpaceActionRecord } from "../runtime/dispatch-space-action-context";
import {
  DispatchSpaceActionClosedError,
  readDispatchSpaceActionContextForReceiptFromEnv,
} from "../runtime/dispatch-space-action-context";
import {
  recordDispatchSpaceReply,
  recordDispatchSpaceSilent,
  recordDispatchSpaceStatus,
} from "./action-command";
import { readDispatchSpaceFile } from "./dispatch-file-read";

const FINAL_STATUS_SCHEMA = z.enum([
  "done",
  "blocked",
  "needs_input",
  "handoff",
]);

export function createSpaceActionMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "openmeld-dispatch-space-action",
      version: "1.0.0",
    },
    {
      instructions:
        "Use read_file to read shared text files in the current Space. Then choose exactly one final OpenMeld Space Action for the current Wake: reply for the exact public message, status for a final visible status, or stay_silent when no public message is needed. Private assistant output is not posted to the Space.",
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
        const result = await readDispatchSpaceFile(input);
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

  server.registerTool(
    "reply",
    {
      title: "Reply in the current OpenMeld Space",
      description:
        "Record the exact final public reply for the active OpenMeld Wake. Use real newline characters for paragraph breaks. Optionally wake or reference an Agent, or mention a person, by mention label or profile ID.",
      inputSchema: {
        message: z.string().min(1),
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
    async ({ mentionTargets, message, referenceTargets, wakeTargets }) =>
      executeSpaceAction(() =>
        recordDispatchSpaceReply({
          mentionTargets,
          referenceTargets,
          text: message,
          wakeTargets,
        })
      )
  );

  server.registerTool(
    "status",
    {
      title: "Set the final OpenMeld Space status",
      description:
        "Record one final visible status for the active OpenMeld Wake. This closes the Wake; do not use it for interim progress.",
      inputSchema: {
        status: FINAL_STATUS_SCHEMA,
        text: z.string().min(1),
      },
      outputSchema: dispatchSpaceActionToolResultSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
    },
    async ({ status, text }) =>
      executeSpaceAction(() => recordDispatchSpaceStatus({ status, text }))
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
      executeSpaceAction(() => recordDispatchSpaceSilent({ reason }))
  );

  return server;
}

export async function runSpaceActionMcpServer(): Promise<void> {
  readDispatchSpaceActionContextForReceiptFromEnv();
  const server = createSpaceActionMcpServer();
  await server.connect(new StdioServerTransport());
}

export async function executeSpaceAction(
  action: () => DispatchSpaceActionRecord | Promise<DispatchSpaceActionRecord>
) {
  try {
    const context = readDispatchSpaceActionContextForReceiptFromEnv();
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
