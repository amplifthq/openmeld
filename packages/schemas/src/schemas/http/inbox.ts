import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { slackMessagePermalinkSchema } from "../runtime/message-channel";

export const INBOX_TITLE_MAX_CHARS = 160;
export const INBOX_PREVIEW_MAX_CHARS = 500;
export const INBOX_CONTEXT_LABEL_MAX_CHARS = 160;
export const INBOX_LIST_DEFAULT_LIMIT = 40;
export const INBOX_LIST_MAX_LIMIT = 100;
export const INBOX_SPACE_SUMMARY_MAX_SPACES = 500;
export const INBOX_SPACE_UNREAD_TARGETS_MAX_ITEMS = 500;

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
  "urgent_updates",
  "recent_updates",
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
  "space_mention",
  "agent_reply",
  "agent_interaction",
  "wake_outcome",
  "center_agent_update",
  "document_review",
  "organization_request",
  "system_issue",
]);
const inboxItemWireKindSchema = z.union([
  inboxItemKindSchema,
  z.literal("space_reference"),
]);

export const inboxSourceKindSchema = z.enum([
  "space_signal",
  "runtime_coordinator_interaction",
  "remote_agent_native_delivery",
  "remote_agent_native_interaction",
  "organization_document_draft",
  "organization_opportunity",
  "organization_member_request",
  "agent_profile_work_recovery",
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
    kind: z.literal("organization_join_request"),
    requestId: identifierSchema,
  }),
  z.strictObject({
    kind: z.literal("agent_profile"),
    profileId: identifierSchema,
  }),
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
    threadRootSignalId: identifierSchema.nullable().optional(),
  }),
  z.strictObject({
    documentId: identifierSchema,
    kind: z.literal("organization_document"),
  }),
  slackInboxSourceTargetSchema,
  centerAgentInboxSourceTargetSchema,
  z.strictObject({
    kind: z.literal("settings"),
    section: z.enum(["channels", "computers", "notifications"]),
  }),
]);

export const inboxItemWireSchema = z
  .strictObject({
    attention: inboxAttentionSchema,
    contextLabel: contextLabelSchema.nullable(),
    createdAt: isoDateTimeSchema,
    id: identifierSchema,
    importance: inboxImportanceSchema,
    kind: inboxItemWireKindSchema,
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

export const inboxItemSchema = inboxItemWireSchema.transform((item) => ({
  ...item,
  kind: normalizeInboxItemWireKind(item.kind),
}));

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

export const listInboxItemsWireResponseSchema = z.strictObject({
  items: z.array(inboxItemWireSchema),
  nextCursor: z.string().min(1).max(1024).nullable(),
  organizationId: identifierSchema,
});

export const inboxSummaryResponseSchema = z.strictObject({
  organizationId: identifierSchema,
  totalUnreadCount: z.number().int().nonnegative(),
  unresolvedActionCount: z.number().int().nonnegative(),
  // Absent during receiver-first rollout means unknown, never zero.
  unreadUrgentUpdateCount: z.number().int().nonnegative().optional(),
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
  // Optional for consumer-first rollout: older Core deployments omit this
  // aggregate while newer Web and Gateway readers already accept the shape.
  ordinarySpaceUnreadCount: z.number().int().nonnegative().optional(),
  organizationId: identifierSchema,
  spaces: z
    .array(spaceInboxSummaryItemSchema)
    .max(INBOX_SPACE_SUMMARY_MAX_SPACES),
});

export const spaceInboxUnreadTargetSchema = z.strictObject({
  occurredAtMs: timestampMsSchema,
  signalId: identifierSchema,
  threadRootSignalId: identifierSchema.nullable(),
});

export const spaceInboxUnreadTargetsResponseSchema = z.strictObject({
  hasMoreTargets: z.boolean(),
  organizationId: identifierSchema,
  spaceId: identifierSchema,
  targets: z
    .array(spaceInboxUnreadTargetSchema)
    .max(INBOX_SPACE_UNREAD_TARGETS_MAX_ITEMS),
  totalUnreadCount: z.number().int().nonnegative(),
});

export const spaceInboxUnreadTargetsRouteParamsSchema = z.strictObject({
  spaceId: identifierSchema,
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
  threadRootSignalId: identifierSchema.optional(),
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

export const getInboxItemWireResponseSchema = z.strictObject({
  item: inboxItemWireSchema,
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

export const markInboxItemReadWireResponseSchema = z.strictObject({
  item: inboxItemWireSchema,
});

export const markAllInboxItemsReadResponseSchema = z.strictObject({
  markedReadCount: z.number().int().nonnegative(),
});

const inboxSourceCandidateWireSchema = z.strictObject({
  attention: inboxAttentionSchema,
  contextLabel: contextLabelSchema.nullable(),
  importance: inboxImportanceSchema,
  kind: inboxItemWireKindSchema,
  occurredAtMs: timestampMsSchema,
  organizationId: identifierSchema,
  preview: previewSchema,
  recipientUserId: identifierSchema,
  sourceKey: identifierSchema,
  sourceKind: inboxSourceKindSchema,
  sourceTarget: inboxSourceTargetSchema,
  title: titleSchema,
});

export const inboxSourceCandidateSchema =
  inboxSourceCandidateWireSchema.transform((candidate) => ({
    ...candidate,
    kind: normalizeInboxItemWireKind(candidate.kind),
  }));

function normalizeInboxItemWireKind(
  kind: typeof inboxItemWireKindSchema._output
): typeof inboxItemKindSchema._output {
  return kind === "space_reference" ? "space_mention" : kind;
}

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
export const getSpaceInboxUnreadTargetsRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  spaceId: identifierSchema,
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
