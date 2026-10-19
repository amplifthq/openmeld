import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { daemonServiceLaneSchema } from "../daemon/service-contract";
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
  "needs_review",
  "mentions",
  "updates",
  "urgent_updates",
  "recent_updates",
]);
export const inboxPresentationSchema = z.enum(["attention"]);
export const inboxAttentionSchema = z.enum(["update", "action_required"]);
export const inboxImportanceSchema = z.enum(["normal", "urgent"]);
export const inboxRecipientReasonSchema = z.enum([
  "human_mention",
  "thread_reply",
  "requester",
  "direct_message",
  "space_member",
  "agent_owner",
  "device_owner",
]);
const inboxAgentProfileIdsSchema = z.array(identifierSchema).max(100);

/** Source-owned relevance, not authorization or notification-channel consent. */
export const inboxSourceFactsSchema = z
  .strictObject({
    version: z.literal(1),
    agentProfileIds: inboxAgentProfileIdsSchema.optional(),
    personalAgentProfileIds: inboxAgentProfileIdsSchema.optional(),
    mentionedAgentProfileIds: inboxAgentProfileIdsSchema.optional(),
    firstContactAgentProfileIds: inboxAgentProfileIdsSchema.optional(),
    recipientReasons: z.array(inboxRecipientReasonSchema).min(1).max(7),
    requestCategory: z.enum(["action", "review"]).optional(),
  })
  .superRefine((facts, context) => {
    const agents = new Set(facts.agentProfileIds ?? []);
    const personalAgents = new Set(facts.personalAgentProfileIds ?? []);
    for (const field of [
      "personalAgentProfileIds",
      "mentionedAgentProfileIds",
    ] as const) {
      if (facts[field]?.some((id) => !agents.has(id))) {
        context.addIssue({
          code: "custom",
          message: "Agent relevance must name an actual Agent in this event.",
          path: [field],
        });
      }
    }
    if (
      facts.firstContactAgentProfileIds?.some((id) => !personalAgents.has(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "First contact must name the recipient's personal Agent.",
        path: ["firstContactAgentProfileIds"],
      });
    }
    if (
      personalAgents.size > 0 &&
      !facts.recipientReasons.includes("agent_owner")
    ) {
      context.addIssue({
        code: "custom",
        message: "Personal Agent relevance requires an owner relationship.",
        path: ["recipientReasons"],
      });
    }
  });
export const inboxResolutionStatusSchema = z.enum([
  "not_applicable",
  "open",
  "resolved",
]);
export const inboxItemKindSchema = z.enum([
  "space_joined",
  "space_message",
  "space_mention",
  "agent_reply",
  "agent_interaction",
  "wake_outcome",
  "center_agent_update",
  "document_review",
  "organization_request",
  "agent_access_request",
  "agent_space_request",
  "credential_confirmation",
  "system_issue",
  "computer_connection",
  "desktop_update",
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
  "agent_access_request",
  "credential_confirmation",
  "system_attention_event",
  "computer_connection",
  "desktop_update",
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

export const computerInboxSourceTargetSchema = z.strictObject({
  kind: z.literal("computer_connection"),
  computerId: identifierSchema,
  deviceId: identifierSchema,
  incidentId: identifierSchema,
  lane: daemonServiceLaneSchema,
  state: z.enum(["disconnected", "restored", "deactivated"]),
});

export const desktopUpdateInboxSourceTargetSchema = z.strictObject({
  kind: z.literal("desktop_update"),
  installationId: identifierSchema,
  lane: daemonServiceLaneSchema,
  deviceName: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(100),
  platform: z.enum(["darwin", "win32", "linux"]),
  state: z.enum(["available", "installed", "superseded"]),
});

export const inboxSourceTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("plugin_action_request"),
    requestId: identifierSchema,
    // Stored provenance for Space attention; the request remains the action target.
    spaceId: identifierSchema.optional(),
  }),
  computerInboxSourceTargetSchema,
  desktopUpdateInboxSourceTargetSchema,
  z.strictObject({
    kind: z.literal("organization_join_request"),
    requestId: identifierSchema,
  }),
  // An Agent owner's consent request; the request owns its state and its
  // Space. No spaceId: the owner may not be in that Space.
  z.strictObject({
    kind: z.literal("agent_access_request"),
    requestId: identifierSchema,
  }),
  // The owner's confirmation of a sensitive operation made with the CLI
  // credential while a task with another root requester was running.
  z.strictObject({
    kind: z.literal("credential_confirmation"),
    confirmationId: identifierSchema,
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
    directMessage: z.boolean().optional(),
    agentOwnerActivity: z.boolean().optional(),
    replyToRecipient: z.boolean().optional(),
    signalId: identifierSchema.optional(),
    spaceId: identifierSchema,
    threadRootSignalId: identifierSchema.optional(),
  }),
  z.strictObject({
    // Set when the Agent owner only observes the Space through their Agent.
    agentOwnerActivity: z.boolean().optional(),
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
    organizationId: identifierSchema.nullable(),
    preview: previewSchema,
    readAt: isoDateTimeSchema.nullable(),
    recipientUserId: identifierSchema,
    resolutionStatus: inboxResolutionStatusSchema,
    sourceFacts: inboxSourceFactsSchema.optional(),
    sourceTarget: inboxSourceTargetSchema,
    title: titleSchema,
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((item, context) => {
    const accountTarget =
      item.sourceTarget.kind === "computer_connection" ||
      item.sourceTarget.kind === "desktop_update";
    if (
      (item.organizationId === null) !== accountTarget ||
      (accountTarget && item.kind !== item.sourceTarget.kind)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Account Inbox scope is reserved for a matching typed device event.",
        path: ["organizationId"],
      });
    }
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

export const inboxNotificationObservationCursorSchema = z
  .strictObject({
    version: z.literal(1),
    organizationId: identifierSchema,
    recipientUserId: identifierSchema,
    afterRowId: z.number().int().nonnegative(),
    throughRowId: z.number().int().nonnegative(),
  })
  .refine((cursor) => cursor.afterRowId <= cursor.throughRowId);

/** A read position over insertions, not a delivery receipt or an unread store. */
export const inboxNotificationObservationsQuerySchema = z.strictObject({
  cursor: z.string().trim().min(1).max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(INBOX_LIST_MAX_LIMIT).optional(),
});

export const inboxNotificationObservationsResponseSchema = z.strictObject({
  organizationId: identifierSchema,
  items: z.array(inboxItemSchema).max(INBOX_LIST_MAX_LIMIT),
  cursor: z.string().min(1).max(4096),
  hasMore: z.boolean(),
});

export const observeInboxNotificationsRpcInputSchema =
  inboxNotificationObservationsQuerySchema.extend({
    context: openMeldRequestContextSchema,
    includeMembershipNotices: z.boolean().optional(),
  });

export const listInboxItemsQuerySchema = z.strictObject({
  cursor: z.string().trim().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(INBOX_LIST_MAX_LIMIT).optional(),
  presentation: inboxPresentationSchema.optional(),
  notificationPreview: z.literal("true").optional(),
  view: inboxViewSchema.optional(),
});

export const inboxSummaryQuerySchema = z.strictObject({
  presentation: inboxPresentationSchema.optional(),
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
  // Opt-in version-9 source facts: priority is not synonymous with open work.
  priorityCount: z.number().int().nonnegative().optional(),
  needsActionCount: z.number().int().nonnegative().optional(),
  needsReviewCount: z.number().int().nonnegative().optional(),
  unreadPriorityUpdateCount: z.number().int().nonnegative().optional(),
  organizationId: identifierSchema,
  totalUnreadCount: z.number().int().nonnegative(),
  unresolvedActionCount: z.number().int().nonnegative(),
  // Absent during receiver-first rollout means unknown, never zero.
  unreadUrgentUpdateCount: z.number().int().nonnegative().optional(),
  // Attention-presentation categories are disjoint. They are absent from
  // legacy/raw summaries and required by consumers only after opt-in.
  unreadMentionCount: z.number().int().nonnegative().optional(),
  ordinaryUnreadCount: z.number().int().nonnegative().optional(),
});

export const centerAgentInboxSummaryResponseSchema = z.strictObject({
  organizationId: identifierSchema,
  unreadCount: z.number().int().nonnegative(),
});

export const spaceInboxSummaryItemSchema = z.strictObject({
  messageUnreadCount: z.number().int().nonnegative().optional(),
  latestUnreadOccurredAtMs: timestampMsSchema,
  spaceId: identifierSchema,
  unreadCount: z.number().int().positive(),
});

export const spaceInboxSummaryResponseSchema = z.strictObject({
  chatUnreadCount: z.number().int().nonnegative().optional(),
  chatUnresolvedActionCount: z.number().int().nonnegative().optional(),
  chatUnreadUrgentUpdateCount: z.number().int().nonnegative().optional(),
  attention: z
    .array(
      z.strictObject({
        spaceId: identifierSchema,
        unresolvedActionCount: z.number().int().nonnegative(),
        unreadUrgentUpdateCount: z.number().int().nonnegative(),
      })
    )
    .optional(),
  // Optional for consumer-first rollout: older Core deployments omit this
  // aggregate while newer Web and Gateway readers already accept the shape.
  ordinarySpaceUnreadCount: z.number().int().nonnegative().optional(),
  organizationId: identifierSchema,
  spaces: z
    .array(spaceInboxSummaryItemSchema)
    .max(INBOX_SPACE_SUMMARY_MAX_SPACES),
});

export const spaceInboxUnreadTargetSchema = z.strictObject({
  itemId: identifierSchema.optional(),
  sourceKey: identifierSchema.optional(),
  occurredAtMs: timestampMsSchema,
  signalId: identifierSchema,
  threadRootSignalId: identifierSchema.nullable(),
});

export const spaceInboxUnreadTargetsResponseSchema = z.strictObject({
  joinedItems: z
    .array(
      z.strictObject({
        itemId: identifierSchema,
        occurredAtMs: timestampMsSchema,
      })
    )
    .max(INBOX_SPACE_UNREAD_TARGETS_MAX_ITEMS)
    .optional(),
  scopes: z
    .array(
      z.strictObject({
        threadRootSignalId: identifierSchema.nullable(),
        unreadCount: z.number().int().nonnegative(),
      })
    )
    .optional(),
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

// Membership fields share the item-kind opt-in. Summary version 3 predates them.
export function projectSpaceInboxSummaryForMembershipReceiver(
  response: zod.infer<typeof spaceInboxSummaryResponseSchema>,
  includeMembershipNotices?: boolean
): zod.infer<typeof spaceInboxSummaryResponseSchema> {
  if (includeMembershipNotices === true) {
    return response;
  }
  return {
    ...response,
    spaces: response.spaces.map(
      ({ messageUnreadCount: _messages, ...space }) => space
    ),
  };
}

export function projectSpaceInboxUnreadTargetsForMembershipReceiver(
  response: zod.infer<typeof spaceInboxUnreadTargetsResponseSchema>,
  includeMembershipNotices?: boolean
): zod.infer<typeof spaceInboxUnreadTargetsResponseSchema> {
  if (includeMembershipNotices === true) {
    return response;
  }
  const { joinedItems: _joined, ...legacy } = response;
  return legacy;
}

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

export const spaceInboxReadSourceSchema = z.strictObject({
  signalId: identifierSchema,
  occurredAtMs: timestampMsSchema,
});
export const getSpaceInboxReadCandidatesInputSchema = z.strictObject({
  spaceId: identifierSchema,
  organizationId: identifierSchema,
  recipientUserId: identifierSchema,
  sources: z.array(spaceInboxReadSourceSchema).min(1).max(500),
});

export const mutateSpaceInboxReadBodySchema = z.discriminatedUnion(
  "operation",
  [
    z.strictObject({
      spaceId: identifierSchema,
      operation: z.literal("read_sources"),
      sources: z.array(spaceInboxReadSourceSchema).min(1).max(500),
    }),
    z.strictObject({
      spaceId: identifierSchema,
      operation: z.literal("prepare"),
    }),
    z.strictObject({
      spaceId: identifierSchema,
      operation: z.literal("read"),
      items: z
        .array(
          z.strictObject({
            itemId: identifierSchema,
            occurredAtMs: timestampMsSchema,
          })
        )
        .min(1)
        .max(500),
    }),
    z.strictObject({
      spaceId: identifierSchema,
      operation: z.literal("clear"),
      snapshotId: identifierSchema,
    }),
  ]
);
export const mutateSpaceInboxReadRpcInputSchema = z.strictObject({
  body: mutateSpaceInboxReadBodySchema,
  context: openMeldRequestContextSchema,
});
export const mutateSpaceInboxReadResponseSchema = z.discriminatedUnion(
  "operation",
  [
    z.strictObject({
      operation: z.literal("prepare"),
      snapshotId: identifierSchema,
      unreadCount: z.number().int().nonnegative(),
    }),
    z.strictObject({
      operation: z.literal("read"),
      markedReadCount: z.number().int().nonnegative(),
    }),
  ]
);

export const inboxNotificationPreferencesResponseSchema = z.strictObject({
  updatedAt: isoDateTimeSchema.nullable(),
  urgentEmailEnabled: z.boolean(),
});

export const updateInboxNotificationPreferencesBodySchema = z.strictObject({
  urgentEmailEnabled: z.boolean(),
});

export const inboxMessageNotificationModeSchema = z.enum([
  "all_messages",
  "mentions_and_replies",
]);
export const inboxConversationNotificationModeSchema = z.enum([
  "all_messages",
  "mentions_and_replies",
  "muted",
]);
export const inboxMessageNotificationPreferencesQuerySchema = z.strictObject({
  spaceId: identifierSchema.optional(),
});
export const inboxMessageNotificationPreferencesResponseSchema = z.strictObject(
  {
    organizationId: identifierSchema,
    spaceId: identifierSchema.nullable(),
    defaultMode: inboxMessageNotificationModeSchema,
    overrideMode: inboxConversationNotificationModeSchema.nullable(),
    effectiveMode: inboxConversationNotificationModeSchema,
  }
);
export const updateInboxMessageNotificationPreferencesBodySchema =
  z.discriminatedUnion("scope", [
    z.strictObject({
      scope: z.literal("account"),
      mode: inboxMessageNotificationModeSchema,
    }),
    z.strictObject({
      scope: z.literal("conversation"),
      spaceId: identifierSchema,
      mode: inboxConversationNotificationModeSchema.nullable(),
    }),
  ]);
export const getInboxMessageNotificationPreferencesRpcInputSchema =
  inboxMessageNotificationPreferencesQuerySchema.extend({
    context: openMeldRequestContextSchema,
  });
export const updateInboxMessageNotificationPreferencesRpcInputSchema =
  z.strictObject({
    context: openMeldRequestContextSchema,
    preference: updateInboxMessageNotificationPreferencesBodySchema,
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

export const markAllInboxItemsReadQuerySchema = z.strictObject({
  presentation: inboxPresentationSchema.optional(),
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
  sourceFacts: inboxSourceFactsSchema.optional(),
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
  includeMembershipNotices: z.boolean().optional(),
  includeReplyToRecipient: z.boolean().optional(),
  includeSourceFacts: z.boolean().optional(),
  includeAccountItems: z.boolean().optional(),
});
export const getInboxSummaryRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  includeAccountItems: z.boolean().optional(),
  presentation: inboxPresentationSchema.optional(),
});
export const getCenterAgentInboxSummaryRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
export const getSpaceInboxSummaryRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  includeMembershipNotices: z.boolean().optional(),
});
export const getSpaceInboxUnreadTargetsRpcInputSchema = z.strictObject({
  includeMembershipNotices: z.boolean().optional(),
  includeItemIds: z.boolean().optional(),
  includeSourceKeys: z.boolean().optional(),
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
  includeMembershipNotices: z.boolean().optional(),
  includeReplyToRecipient: z.boolean().optional(),
  includeSourceFacts: z.boolean().optional(),
  includeAccountItems: z.boolean().optional(),
});
export const dismissInboxItemRpcInputSchema = inboxItemRouteParamsSchema.extend(
  {
    context: openMeldRequestContextSchema,
    includeAccountItems: z.boolean().optional(),
  }
);
export const markInboxItemReadRpcInputSchema =
  markInboxItemReadBodySchema.extend({
    context: openMeldRequestContextSchema,
    includeMembershipNotices: z.boolean().optional(),
    includeReplyToRecipient: z.boolean().optional(),
    includeSourceFacts: z.boolean().optional(),
    includeAccountItems: z.boolean().optional(),
    itemId: identifierSchema,
  });
export const markAllInboxItemsReadRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  presentation: inboxPresentationSchema.optional(),
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
