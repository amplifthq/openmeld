import * as z from "zod/v4";
import { centerAgentContextManifestEntrySchema } from "../http/center-agent-context-manifest";
import { spaceBoardResponseSchema } from "../http/space-board";
import {
  getSpaceWakeProgressInputSchema,
  getSpaceWakeProgressResponseSchema,
} from "../http/space-wake-progress";
import {
  postSpaceWakeStopBodySchema,
  postSpaceWakeStopResponseSchema,
} from "../http/space-wake-stop";
import { clientMessageIdSchema } from "../protocol/client-message-id";
import {
  agentReplyPlacementSchema,
  nativeReplyPlacementSchema,
} from "../space-mesh/agent-reply-placement";

const identifier = z.string().trim().min(1).max(256);

export const personalRemoteAgentSpaceToolRequestSchema = z.strictObject({
  submissionId: identifier,
  operation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("authorize") }),
    z.strictObject({ kind: z.literal("members") }),
    z.strictObject({ kind: z.literal("messages") }),
    z.strictObject({ kind: z.literal("board") }),
    z.strictObject({
      kind: z.literal("wake_progress"),
      spaceId: identifier.optional(),
      query: getSpaceWakeProgressInputSchema.omit({ spaceId: true }),
    }),
    z.strictObject({
      kind: z.literal("wake_stop"),
      spaceId: identifier.optional(),
      body: postSpaceWakeStopBodySchema,
    }),
    z.strictObject({
      kind: z.literal("reply_placement"),
      placement: agentReplyPlacementSchema,
    }),
    z.strictObject({
      kind: z.literal("updates"),
      afterSignalId: identifier.optional(),
    }),
    z.strictObject({
      kind: z.literal("wake"),
      clientMessageId: clientMessageIdSchema.optional(),
      agentProfileId: identifier,
      text: z.string().trim().min(1).max(8000),
    }),
  ]),
});

export const personalRemoteAgentSpaceToolResponseSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("authorize") }),
    z.strictObject({
      kind: z.literal("wake_progress"),
      progress: getSpaceWakeProgressResponseSchema,
    }),
    z.strictObject({
      kind: z.literal("wake_stop"),
      response: postSpaceWakeStopResponseSchema,
    }),
    z.strictObject({
      kind: z.literal("reply_placement"),
      placement: nativeReplyPlacementSchema,
    }),
    z.strictObject({
      kind: z.literal("board"),
      board: spaceBoardResponseSchema,
    }),
    z.strictObject({
      kind: z.literal("updates"),
      signals: z
        .array(
          z.strictObject({
            id: identifier,
            profileId: identifier.nullable(),
            profileName: z.string().nullable(),
            type: z.enum([
              "signal.text",
              "signal.status",
              "signal.system_notice",
            ]),
            text: z.string().max(4000),
            truncated: z.boolean(),
          })
        )
        .max(20),
    }),
    z.strictObject({
      kind: z.literal("messages"),
      messages: z.array(centerAgentContextManifestEntrySchema).max(30),
      truncated: z.boolean(),
    }),
    z.strictObject({
      kind: z.literal("members"),
      members: z.array(
        z.strictObject({
          profileId: identifier,
          displayName: z.string(),
          canWake: z.boolean(),
        })
      ),
    }),
    z.strictObject({
      kind: z.literal("wake"),
      signalId: identifier,
      clientMessageId: clientMessageIdSchema.optional(),
      agentProfileId: identifier,
    }),
  ]
);
