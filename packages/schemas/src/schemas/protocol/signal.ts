import * as z from "zod/v4";
import { isLegacyAgentActivityWorkCompatible } from "../../agent-work-activity";
import { spaceMessageFileReferencesSchema } from "../http/space-files";
import { spaceMentionLabelSchema } from "../http/space-mention-label";
import { signalStatusDataSchema as signalStatusPayloadSchema } from "../space-mesh/signal-status";
import { signalSystemNoticeDataSchema as signalSystemNoticePayloadSchema } from "../space-mesh/signal-system-notice";
import { spaceAgentActivitySchema } from "./agent-stream";
import { centerAgentInteractionSourceSchema } from "./center-agent-interaction-source";
import { clientMessageIdSchema } from "./client-message-id";
import { MAX_PROFILE_NAME_LENGTH, MAX_TEXT_LENGTH } from "./constants";
import { conversationCompactionMarkerSchema } from "./conversation-compaction";
import { coreReadinessFactsChangedSchema } from "./core-readiness-facts-changed";
import { messageEnvelopeSchema } from "./message-envelope";
import { openMeldRuntimeProfileIdSchema } from "./profile";
import { trimmedStringFromUnknown } from "./shared";
import {
  MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH,
  signalReplyToSchema,
} from "./signal-reply-to";
import { spaceMessageAttachmentsSchema } from "./space-attachment";
import { wakeDeviceWaitSchema } from "./wake-device-wait";

// biome-ignore lint/performance/noBarrelFile: This shared protocol constant must remain re-exported from the canonical signal module.
export { MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH } from "./signal-reply-to";

const MULTI_SPACE_PATTERN = /\s+/g;
const DELETE_CODE_POINT = 127;
const COMPLETE_FENCED_BLOCK_PATTERN = /```[\s\S]*?```/gu;
const TRAILING_OPENMELD_SPACE_ACTION_BLOCK_PATTERN =
  /```openmeld-space-action[\s\S]*$/u;
export const SPACE_MEMBER_JOIN_NOTICE_PURPOSE =
  "space_membership_join_notice" as const;
export const SPACE_MEMBER_REMOVE_NOTICE_PURPOSE =
  "space_membership_remove_notice" as const;
export const SPACE_MENTION_REJECT_NOTICE_PURPOSE =
  "space_mention_reject_notice" as const;
export const AGENT_REPLYING_PURPOSE = "agent_replying" as const;
export const AGENT_REPLYING_END_PURPOSE = "agent_replying_end" as const;
export const AGENT_REPLY_PREVIEW_PURPOSE = "agent_reply_preview" as const;
export const AGENT_REPLY_PREVIEW_END_PURPOSE =
  "agent_reply_preview_end" as const;
export const AGENT_REPLY_FINAL_PURPOSE = "agent_reply_final" as const;
export const REMOTE_AGENT_FAILURE_PURPOSE = "remote_agent_failure" as const;
export const DISPATCH_ACTIVITY_DISPATCHING_PURPOSE =
  "dispatch_activity_dispatching" as const;
export const DISPATCH_ACTIVITY_RETRYING_PURPOSE =
  "dispatch_activity_retrying" as const;
export const DISPATCH_ACTIVITY_FAILED_PURPOSE =
  "dispatch_activity_failed" as const;
export const CONVERSATION_CONTINUITY_WARNING_PURPOSE =
  "conversation_continuity_warning" as const;

export const sanitizeSignalTextPreview = (
  text: string | null | undefined
): string | null => {
  const normalized = trimmedStringFromUnknown(text)
    .replace(COMPLETE_FENCED_BLOCK_PATTERN, " ")
    .replace(TRAILING_OPENMELD_SPACE_ACTION_BLOCK_PATTERN, " ");
  if (normalized.length === 0) {
    return null;
  }

  const singleLine = normalized
    .split("")
    .map((character) => (isControlCharacter(character) ? " " : character))
    .join("")
    .replace(MULTI_SPACE_PATTERN, " ")
    .trim();
  if (singleLine.length === 0) {
    return null;
  }

  return singleLine.length <= MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH
    ? singleLine
    : `${singleLine.slice(0, MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH - 1)}…`;
};

export const signalTextReplyToSchema = signalReplyToSchema;

export const centerAgentTaskReferenceSchema = z.strictObject({
  taskId: z.string().trim().min(1).max(256),
});

export const CENTER_AGENT_TASK_REFERENCE_MAX_COUNT = 20 as const;

const signalTextContentSchema = z.preprocess(
  trimmedStringFromUnknown,
  z.string().max(MAX_TEXT_LENGTH)
);

const runtimeDeviceDisplayNameSchema = z.preprocess(
  trimmedStringFromUnknown,
  z.string().min(1).max(80)
);

const legacySpaceAgentActivitySchema = spaceAgentActivitySchema.superRefine(
  (activity, context) => {
    activity.steps.forEach((step, index) => {
      if (!isLegacyAgentActivityWorkCompatible(step.work)) {
        context.addIssue({
          code: "custom",
          message: "work is not compatible with legacy Agent Activity",
          path: ["steps", index, "work"],
        });
      }
    });
  }
);

const signalTextMetaSchema = z.object({
  deviceWait: wakeDeviceWaitSchema.optional(),
  transient: z.literal(true).optional(),
  agentActivity: legacySpaceAgentActivitySchema.optional(),
  agentWorkSummary: spaceAgentActivitySchema.optional(),
  centerAgentTaskReferences: z
    .array(centerAgentTaskReferenceSchema)
    .max(CENTER_AGENT_TASK_REFERENCE_MAX_COUNT)
    .optional(),
  clientMessageId: clientMessageIdSchema.optional(),
  centerAgentExecutionInput: z
    .strictObject({
      dispatchId: z.string().min(1).max(200),
      targetProfileId: openMeldRuntimeProfileIdSchema,
    })
    .optional(),
  // Confirms only this authored message, never a conversation read position.
  authorHasRead: z.literal(true).optional(),
  centerAgentInteractionSource: centerAgentInteractionSourceSchema.optional(),
  conversationCompaction: conversationCompactionMarkerSchema.optional(),
  sourceEventId: z
    .preprocess(trimmedStringFromUnknown, z.string().max(200))
    .optional(),
  sourceClientMessageId: clientMessageIdSchema.optional(),
  purpose: z
    .preprocess(trimmedStringFromUnknown, z.string().min(1).max(80))
    .optional(),
  errorCode: z
    .preprocess(trimmedStringFromUnknown, z.string().min(1).max(120))
    .optional(),
  dispatchId: z
    .preprocess(trimmedStringFromUnknown, z.string().max(200))
    .optional(),
  targetProfileId: openMeldRuntimeProfileIdSchema.optional(),
  targetProfileKind: z.enum(["human", "agent"]).optional(),
  targetProfileName: z
    .preprocess(
      trimmedStringFromUnknown,
      z.string().min(1).max(MAX_PROFILE_NAME_LENGTH)
    )
    .optional(),
  targetMentionLabel: spaceMentionLabelSchema.optional(),
  runtimeDeviceDisplayName: runtimeDeviceDisplayNameSchema.optional(),
  coreReadinessFactsChanged: coreReadinessFactsChangedSchema.optional(),
  staleness: z
    .object({
      newMessagesDuringComposition: z.number().int().positive(),
    })
    .optional(),
  addedByProfileId: openMeldRuntimeProfileIdSchema.optional(),
  addedByDisplayName: z
    .preprocess(
      trimmedStringFromUnknown,
      z.string().min(1).max(MAX_PROFILE_NAME_LENGTH)
    )
    .optional(),
  removedByProfileId: openMeldRuntimeProfileIdSchema.optional(),
  removedByDisplayName: z
    .preprocess(
      trimmedStringFromUnknown,
      z.string().min(1).max(MAX_PROFILE_NAME_LENGTH)
    )
    .optional(),
});

const validateAuthoredSignalTextMeta = (
  meta: z.infer<typeof signalTextMetaSchema>,
  context: z.RefinementCtx
) => {
  if (
    meta.purpose !== SPACE_MEMBER_JOIN_NOTICE_PURPOSE &&
    meta.purpose !== SPACE_MEMBER_REMOVE_NOTICE_PURPOSE
  ) {
    return;
  }

  if (!meta.targetProfileId) {
    context.addIssue({
      code: "custom",
      message: "targetProfileId is required for space member notices",
      path: ["targetProfileId"],
    });
  }
  if (!meta.targetProfileKind) {
    context.addIssue({
      code: "custom",
      message: "targetProfileKind is required for space member notices",
      path: ["targetProfileKind"],
    });
  }
  if (
    meta.purpose === SPACE_MEMBER_JOIN_NOTICE_PURPOSE &&
    !meta.addedByProfileId
  ) {
    context.addIssue({
      code: "custom",
      message: "addedByProfileId is required for space member notices",
      path: ["addedByProfileId"],
    });
  }
  if (
    meta.purpose === SPACE_MEMBER_JOIN_NOTICE_PURPOSE &&
    !meta.addedByDisplayName
  ) {
    context.addIssue({
      code: "custom",
      message: "addedByDisplayName is required for space member notices",
      path: ["addedByDisplayName"],
    });
  }
  if (
    meta.purpose === SPACE_MEMBER_REMOVE_NOTICE_PURPOSE &&
    !meta.removedByProfileId
  ) {
    context.addIssue({
      code: "custom",
      message: "removedByProfileId is required for space member notices",
      path: ["removedByProfileId"],
    });
  }
  if (
    meta.purpose === SPACE_MEMBER_REMOVE_NOTICE_PURPOSE &&
    !meta.removedByDisplayName
  ) {
    context.addIssue({
      code: "custom",
      message: "removedByDisplayName is required for space member notices",
      path: ["removedByDisplayName"],
    });
  }
};

const postedSignalTextMetaSchema = signalTextMetaSchema
  .omit({
    agentActivity: true,
    agentWorkSummary: true,
    centerAgentTaskReferences: true,
    conversationCompaction: true,
  })
  .superRefine(validateAuthoredSignalTextMeta);

const systemEmittedSignalTextMetaSchema = signalTextMetaSchema
  .omit({
    agentActivity: true,
    agentWorkSummary: true,
  })
  .superRefine(validateAuthoredSignalTextMeta);

const addSignalTextMessageEnvelopeIssues = (
  input: {
    messageEnvelope?: {
      text: string;
      replyToSignalId?: string;
    };
    replyTo?: { signalId: string };
    text: string;
  },
  context: z.RefinementCtx
) => {
  if (!input.messageEnvelope) {
    return;
  }

  if (input.messageEnvelope.text !== input.text) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["messageEnvelope", "text"],
      message: "messageEnvelope.text must match text",
    });
  }

  if (
    input.replyTo?.signalId &&
    input.messageEnvelope.replyToSignalId &&
    input.replyTo.signalId !== input.messageEnvelope.replyToSignalId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["messageEnvelope", "replyToSignalId"],
      message: "messageEnvelope.replyToSignalId must match replyTo.signalId",
    });
  }
};

const addSignalTextContentIssues = (
  input: {
    files?: readonly unknown[];
    text: string;
  },
  context: z.RefinementCtx
) => {
  if (input.text.length > 0 || (input.files?.length ?? 0) > 0) {
    return;
  }
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["text"],
    message: "A message must include text or at least one file",
  });
};

const buildSignalTextDataSchema = <TMetaSchema extends z.ZodTypeAny>(
  metaSchema: TMetaSchema
) =>
  z
    .strictObject({
      text: signalTextContentSchema,
      deviceWait: wakeDeviceWaitSchema.optional(),
      attachments: spaceMessageAttachmentsSchema.optional(),
      files: spaceMessageFileReferencesSchema.optional(),
      messageEnvelope: messageEnvelopeSchema.optional(),
      replyTo: signalTextReplyToSchema.optional(),
      meta: metaSchema.optional(),
    })
    .superRefine(addSignalTextContentIssues)
    .superRefine(addSignalTextMessageEnvelopeIssues);

export const signalTextDataSchema =
  buildSignalTextDataSchema(signalTextMetaSchema);

export const signalTextSchema = z.object({
  type: z.literal("signal.text"),
  data: buildSignalTextDataSchema(postedSignalTextMetaSchema),
});

export const systemEmittedSignalTextSchema = z.object({
  type: z.literal("signal.text"),
  data: buildSignalTextDataSchema(systemEmittedSignalTextMetaSchema),
});

export const signalStatusSchema = z.strictObject({
  type: z.literal("signal.status"),
  data: signalStatusPayloadSchema,
});

export const signalStatusDataSchema = signalStatusPayloadSchema;

export const signalSystemNoticeSchema = z.strictObject({
  type: z.literal("signal.system_notice"),
  data: signalSystemNoticePayloadSchema,
});

export const signalSystemNoticeDataSchema = signalSystemNoticePayloadSchema;

const isControlCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0);
  return (
    typeof codePoint === "number" &&
    (codePoint < 32 || codePoint === DELETE_CODE_POINT)
  );
};
