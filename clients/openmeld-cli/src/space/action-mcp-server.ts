import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import type { DispatchSpaceActionRecord } from "../runtime/dispatch-space-action-context";
import { readDispatchSpaceActionContextFromEnv } from "../runtime/dispatch-space-action-context";
import {
  recordDispatchSpaceReply,
  recordDispatchSpaceSilent,
  recordDispatchSpaceStatus,
} from "./action-command";

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
        "Choose exactly one final OpenMeld Space Action for the current Wake. Use reply for the exact public message, status for a final visible status, or stay_silent when no public message is needed. Private assistant output is not posted to the Space.",
    }
  );

  server.registerTool(
    "reply",
    {
      title: "Reply in the current OpenMeld Space",
      description:
        "Record the exact final public reply for the active OpenMeld Wake. Use real newline characters for paragraph breaks. Optionally wake or reference current Space targets by mention label or profile ID.",
      inputSchema: {
        message: z.string().min(1),
        referenceTargets: z.array(z.string().min(1)).optional(),
        wakeTargets: z.array(z.string().min(1)).optional(),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
    },
    async ({ message, referenceTargets, wakeTargets }) =>
      executeSpaceAction(() =>
        recordDispatchSpaceReply({
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
  readDispatchSpaceActionContextFromEnv();
  const server = createSpaceActionMcpServer();
  await server.connect(new StdioServerTransport());
}

async function executeSpaceAction(
  action: () => DispatchSpaceActionRecord | Promise<DispatchSpaceActionRecord>
) {
  try {
    const record = await action();
    return {
      content: [
        {
          type: "text" as const,
          text: `Action recorded: OpenMeld saved this unpublished Space action proposal (${record.action.type}) for the current Wake.`,
        },
      ],
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
