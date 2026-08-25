import * as z from "zod/v4";
import { agentControllerConversationRefSchema } from "../daemon/conversation-contract";
import { dispatchExecutionSchema } from "../daemon/conversation-lifecycle";
import { messageEnvelopeSchema } from "../protocol/message-envelope";
import { openMeldRuntimeProfileIdSchema } from "../protocol/profile";
import { trimmedStringFromUnknown } from "../protocol/shared";
import { spaceStatusSchema } from "./signal-status";
import { spaceThreadContextSchema } from "./space-thread";

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const nullableTrimmedStringSchema = z.union([
  z.string().trim().min(1),
  z.null(),
]);

export const dispatchResultKindSchema = z.enum(["text", "status"]);
export const dispatchResultPublicOutcomeSchema = z.enum([
  "internal_only",
  "raw_context_sharing",
  "system_notice",
  "stay_silent",
  "post_message",
  "post_status",
]);

export const dispatchResultRuntimeWorkspaceSchema = z.strictObject({
  fingerprint: nullableTrimmedStringSchema,
  path: z.string().trim().min(1),
});

export const dispatchResultSchema = z
  .strictObject({
    resultRef: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
    dispatchId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
    spaceId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
    actorProfileId: openMeldRuntimeProfileIdSchema,
    actorName: z
      .preprocess(trimmedStringFromUnknown, z.string().min(1))
      .optional(),
    replyToSignalId: z
      .preprocess(trimmedStringFromUnknown, z.string().min(1))
      .optional(),
    resultKind: dispatchResultKindSchema,
    finalText: z
      .preprocess(trimmedStringFromUnknown, z.string().min(1))
      .optional(),
    messageEnvelope: messageEnvelopeSchema.optional(),
    threadContext: spaceThreadContextSchema.optional(),
    statusType: spaceStatusSchema.optional(),
    previewText: z
      .preprocess(trimmedStringFromUnknown, z.string().min(1))
      .optional(),
    publicOutcome: dispatchResultPublicOutcomeSchema,
    agentControllerConversation:
      agentControllerConversationRefSchema.optional(),
    runtimeWorkspace: dispatchResultRuntimeWorkspaceSchema.optional(),
    dispatchExecution: dispatchExecutionSchema.optional(),
    publishedSignalId: z
      .preprocess(trimmedStringFromUnknown, z.string().min(1))
      .optional(),
    createdAt: isoDateTimeSchema,
  })
  .superRefine((value, ctx) => {
    if (value.resultKind === "text" && !value.finalText) {
      ctx.addIssue({
        code: "custom",
        message: "finalText is required when resultKind is text",
        path: ["finalText"],
      });
    }
    if (value.resultKind === "status" && !value.statusType) {
      ctx.addIssue({
        code: "custom",
        message: "statusType is required when resultKind is status",
        path: ["statusType"],
      });
    }
    if (value.messageEnvelope && value.resultKind !== "text") {
      ctx.addIssue({
        code: "custom",
        message: "messageEnvelope is only allowed when resultKind is text",
        path: ["messageEnvelope"],
      });
    }
    if (
      value.messageEnvelope &&
      value.finalText &&
      value.finalText !== value.messageEnvelope.text
    ) {
      ctx.addIssue({
        code: "custom",
        message: "messageEnvelope.text must match finalText",
        path: ["messageEnvelope", "text"],
      });
    }
    if (
      value.messageEnvelope?.replyToSignalId &&
      value.replyToSignalId &&
      value.replyToSignalId !== value.messageEnvelope.replyToSignalId
    ) {
      ctx.addIssue({
        code: "custom",
        message: "messageEnvelope.replyToSignalId must match replyToSignalId",
        path: ["messageEnvelope", "replyToSignalId"],
      });
    }
  });
