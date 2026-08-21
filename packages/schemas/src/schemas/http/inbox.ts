import { z } from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { slackMessagePermalinkSchema } from "../runtime/message-channel";

export const INBOX_TITLE_MAX_CHARS = 160;
export const INBOX_PREVIEW_MAX_CHARS = 500;
export const INBOX_CONTEXT_LABEL_MAX_CHARS = 160;
export const INBOX_LIST_DEFAULT_LIMIT = 40;
export const INBOX_LIST_MAX_LIMIT = 100;
export const INBOX_SPACE_SUMMARY_MAX_SPACES = 500;

const identifierSchema = z.string().trim().min(1).max(256);
const timestampMsSchema = z.number().int().nonnegative();
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const titleSchema = z.string().trim().min(1).max(INBOX_TITLE_MAX_CHARS);
const previewSchema = z.string().trim().min(1).max(INBOX_PREVIEW_MAX_CHARS);
const contextLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(INBOX_CONTEXT_LABEL_MAX_CHARS);

export const inboxViewSchema = z.enum([
  "all",
  "unread",
  "needs_action",
  "updates",
]);
export const inboxAttentionSchema = z.enum(["update", "action_required"]);
export const inboxImportanceSchema = z.enum(["normal", "urgent"]);
export const inboxResolutionStatusSchema = z.enum([
  "not_applicable",
  "open",
  "resolved",
]);
export const inboxItemKindSchema = z.enum([
  "space_message",
  "space_reference",
  "agent_reply",
  "agent_interaction",
  "wake_outcome",
  "center_agent_update",
  "center_agent_task",
  "document_review",
  "organization_request",
  "system_issue",
]);

export const inboxSourceKindSchema = z.enum([
  "space_signal",
  "runtime_coordinator_interaction",
  "remote_agent_native_delivery",
  "remote_agent_native_interaction",
  "center_agent_task_event",
  "organization_document_draft",
  "organization_opportunity",
  "organization_member_request",
  "system_attention_event",
]);

export const centerAgentAttentionImpactSchema = z.enum([
  "response_needed",
  "work_blocked",
  "material_failure_risk",
]);

export const centerAgentRequestMemberAttentionBodySchema = z.strictObject({
  impact: centerAgentAttentionImpactSchema,
  prompt: previewSchema,
  submissionId: identifierSchema,
  title: titleSchema,
});

export const centerAgentRequestMemberAttentionResponseSchema = z.strictObject({
  importance: inboxImportanceSchema,
  instruction: z.string().trim().min(1).max(500),
  organizationId: identifierSchema,
  requestId: identifierSchema,
});

const centerAgentInboxSourceTargetSchema = z
  .strictObject({
    kind: z.literal("center_agent"),
    signalId: identifierSchema.optional(),
    spaceId: identifierSchema.optional(),
  })
  .superRefine((target, context) => {
    if ((target.signalId === undefined) !== (target.spaceId === undefined)) {
      context.addIssue({
        code: "custom",
        message:
          "Center Agent Inbox targets must include both spaceId and signalId.",
      });
    }
  });

export const slackInboxSourceTargetSchema = z.strictObject({
  channelId: identifierSchema,
  kind: z.literal("message_channel"),
  messageId: identifierSchema,
  permalink: slackMessagePermalinkSchema,
  provider: z.literal("slack"),
  teamId: identifierSchema,
  threadRootMessageId: identifierSchema,
});

export const inboxSourceTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("agent_profile_creation_request"),
    requestId: identifierSchema,
  }),
  z.strictObject({
    kind: z.literal("space"),
    signalId: identifierSchema.optional(),
    spaceId: identifierSchema,
    threadRootSignalId: identifierSchema.optional(),
  }),
  z.strictObject({
    interactionId: identifierSchema,
    kind: z.literal("agent_interaction"),
    runtimeCoordinatorExecutionId: identifierSchema,
    sourceSignalId: identifierSchema.optional(),
    spaceId: identifierSchema,
  }),
  z.strictObject({
    documentId: identifierSchema,
    kind: z.literal("organization_document"),
  }),
  z.strictObject({
    kind: z.literal("center_agent_task"),
    taskId: identifierSchema,
  }),
  slackInboxSourceTargetSchema,
  centerAgentInboxSourceTargetSchema,
  z.strictObject({
    kind: z.literal("settings"),
    section: z.enum(["channels", "computers", "notifications"]),
  }),
]);

export const inboxItemSchema = z
  .strictObject({
    attention: inboxAttentionSchema,
    contextLabel: contextLabelSchema.nullable(),
    createdAt: isoDateTimeSchema,
    id: identifierSchema,
    importance: inboxImportanceSchema,
    kind: inboxItemKindSchema,
    occurredAt: isoDateTimeSchema,
    organizationId: identifierSchema,
    preview: previewSchema,
    readAt: isoDateTimeSchema.nullable(),
    recipientUserId: identifierSchema,
    resolutionStatus: inboxResolutionStatusSchema,
    sourceTarget: inboxSourceTargetSchema,
    title: titleSchema,
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((item, context) => {
    const validResolution =
      item.attention === "update"
        ? item.resolutionStatus === "not_applicable"
        : item.resolutionStatus === "open" ||
          item.resolutionStatus === "resolved";
    if (!validResolution) {
      context.addIssue({
        code: "custom",
        message: "Inbox resolution status must match its attention class.",
        path: ["resolutionStatus"],
      });
    }
  });

export const listInboxItemsQuerySchema = z.strictObject({
  cursor: z.string().trim().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(INBOX_LIST_MAX_LIMIT).optional(),
  view: inboxViewSchema.optional(),
});

export const listInboxItemsResponseSchema = z.strictObject({
  items: z.array(inboxItemSchema),
  nextCursor: z.string().min(1).max(1024).nullable(),
  organizationId: identifierSchema,
});

export const inboxSummaryResponseSchema = z.strictObject({
  organizationId: identifierSchema,
  totalUnreadCount: z.number().int().nonnegative(),
  unresolvedActionCount: z.number().int().nonnegative(),
});

export const centerAgentInboxSummaryResponseSchema = z.strictObject({
  organizationId: identifierSchema,
  unreadCount: z.number().int().nonnegative(),
});

export const spaceInboxSummaryItemSchema = z.strictObject({
  latestUnreadOccurredAtMs: timestampMsSchema,
  spaceId: identifierSchema,
  unreadCount: z.number().int().positive(),
});

export const spaceInboxSummaryResponseSchema = z.strictObject({
  organizationId: identifierSchema,
  spaces: z
    .array(spaceInboxSummaryItemSchema)
    .max(INBOX_SPACE_SUMMARY_MAX_SPACES),
});

export const markCenterAgentInboxReadThroughBodySchema = z.strictObject({
  spaceId: identifierSchema,
  throughOccurredAtMs: timestampMsSchema,
});

export const markCenterAgentInboxReadThroughResponseSchema = z.strictObject({
  markedReadCount: z.number().int().nonnegative(),
  readThroughAt: isoDateTimeSchema,
});

export const markSpaceInboxReadThroughBodySchema = z.strictObject({
  spaceId: identifierSchema,
  throughOccurredAtMs: timestampMsSchema,
});

export const markSpaceInboxReadThroughResponseSchema = z.strictObject({
  markedReadCount: z.number().int().nonnegative(),
  readThroughAt: isoDateTimeSchema,
});

export const inboxNotificationPreferencesResponseSchema = z.strictObject({
  updatedAt: isoDateTimeSchema.nullable(),
  urgentEmailEnabled: z.boolean(),
});

export const updateInboxNotificationPreferencesBodySchema = z.strictObject({
  urgentEmailEnabled: z.boolean(),
});

export const inboxItemRouteParamsSchema = z.strictObject({
  itemId: identifierSchema,
});

export const getInboxItemResponseSchema = z.strictObject({
  item: inboxItemSchema,
});

export const dismissInboxItemResponseSchema = z.strictObject({
  dismissedItemId: identifierSchema,
});

export const markInboxItemReadBodySchema = z.strictObject({
  read: z.boolean(),
});

export const markInboxItemReadResponseSchema = z.strictObject({
  item: inboxItemSchema,
});

export const markAllInboxItemsReadResponseSchema = z.strictObject({
  markedReadCount: z.number().int().nonnegative(),
});

export const inboxSourceCandidateSchema = z.strictObject({
  attention: inboxAttentionSchema,
  contextLabel: contextLabelSchema.nullable(),
  importance: inboxImportanceSchema,
  kind: inboxItemKindSchema,
  occurredAtMs: timestampMsSchema,
  organizationId: identifierSchema,
  preview: previewSchema,
  recipientUserId: identifierSchema,
  sourceKey: identifierSchema,
  sourceKind: inboxSourceKindSchema,
  sourceTarget: inboxSourceTargetSchema,
  title: titleSchema,
});

export const listInboxItemsRpcInputSchema = listInboxItemsQuerySchema.extend({
  context: openMeldRequestContextSchema,
});
export const getInboxSummaryRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
export const getCenterAgentInboxSummaryRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
export const getSpaceInboxSummaryRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
export const markCenterAgentInboxReadThroughRpcInputSchema =
  markCenterAgentInboxReadThroughBodySchema.extend({
    context: openMeldRequestContextSchema,
  });
export const markSpaceInboxReadThroughRpcInputSchema =
  markSpaceInboxReadThroughBodySchema.extend({
    context: openMeldRequestContextSchema,
  });
export const getInboxItemRpcInputSchema = inboxItemRouteParamsSchema.extend({
  context: openMeldRequestContextSchema,
});
export const dismissInboxItemRpcInputSchema = inboxItemRouteParamsSchema.extend(
  {
    context: openMeldRequestContextSchema,
  }
);
export const markInboxItemReadRpcInputSchema =
  markInboxItemReadBodySchema.extend({
    context: openMeldRequestContextSchema,
    itemId: identifierSchema,
  });
export const markAllInboxItemsReadRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
export const getInboxNotificationPreferencesRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
export const updateInboxNotificationPreferencesRpcInputSchema =
  updateInboxNotificationPreferencesBodySchema.extend({
    context: openMeldRequestContextSchema,
  });
export const centerAgentRequestMemberAttentionRpcInputSchema =
  centerAgentRequestMemberAttentionBodySchema.extend({
    context: openMeldRequestContextSchema,
  });
