import * as z from "zod/v4";
import { centerAgentContextManifestEntrySchema } from "../http/center-agent-context-manifest";
import { spaceBoardResponseSchema } from "../http/space-board";
import {
  agentReplyPlacementSchema,
  nativeReplyPlacementSchema,
} from "../space-mesh/agent-reply-placement";
import { spaceMessageEvidenceRequestSchema } from "../space-mesh/space-message-evidence";

const identifier = z.string().trim().min(1).max(256);

export const personalRemoteAgentSpaceToolRequestSchema = z.strictObject({
  submissionId: identifier,
  operation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("authorize") }),
    z.strictObject({ kind: z.literal("members") }),
    z.strictObject({ kind: z.literal("messages") }),
    spaceMessageEvidenceRequestSchema.safeExtend({
      kind: z.literal("evidence"),
    }),
    z.strictObject({
      kind: z.literal("thread"),
      threadId: identifier,
      afterSignalId: identifier.optional(),
      limit: z.int().min(1).max(30).optional(),
    }),
    z.strictObject({ kind: z.literal("board") }),
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
      kind: z.literal("evidence"),
      message: centerAgentContextManifestEntrySchema,
      offset: z.int().nonnegative(),
      nextOffset: z.int().positive().nullable(),
    }),
    z.strictObject({
      kind: z.literal("thread"),
      threadId: identifier,
      messages: z.array(centerAgentContextManifestEntrySchema).max(30),
      nextAfterSignalId: identifier.nullable(),
      truncated: z.boolean(),
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
      agentProfileId: identifier,
    }),
  ]
);
