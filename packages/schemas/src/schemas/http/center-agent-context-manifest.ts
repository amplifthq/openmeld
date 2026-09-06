import * as z from "../../lazy-zod";
import { centerAgentInteractionSourceSchema } from "../protocol/center-agent-interaction-source";
import { centerAgentSessionSelectorSchema } from "./center-agent-direct-message-space";

export const CENTER_AGENT_CONTEXT_MANIFEST_VERSION =
  "center_agent_context_manifest.v1" as const;
export const CENTER_AGENT_CONTEXT_LOAD_RECEIPT_VERSION =
  "center_agent_context_load_receipt.v1" as const;
export const CENTER_AGENT_CONTEXT_TOKEN_ESTIMATE_ALGORITHM =
  "utf8_bytes_divided_by_3.v1" as const;
export const CENTER_AGENT_CONTEXT_DEFAULT_MESSAGE_LIMIT = 20;
export const CENTER_AGENT_CONTEXT_MAX_MESSAGE_LIMIT = 50;
export const CENTER_AGENT_CONTEXT_DEFAULT_TOKEN_BUDGET = 8000;
export const CENTER_AGENT_CONTEXT_MIN_TOKEN_BUDGET = 256;
export const CENTER_AGENT_CONTEXT_MAX_TOKEN_BUDGET = 32_768;
export const CENTER_AGENT_CONTEXT_ERROR_CODES = [
  "center_agent.context_conversation_required",
  "center_agent.context_cursor_invalid",
  "center_agent.context_token_budget_too_small",
  "center_agent.context_manifest_not_found",
  "center_agent.context_load_already_recorded",
  "center_agent.context_load_client_mismatch",
  "center_agent.context_load_manifest_empty",
  "center_agent.context_load_selection_duplicate",
  "center_agent.context_load_selection_invalid",
] as const;

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const contentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const centerAgentContextManifestIdSchema = z
  .string()
  .regex(/^center_agent_context_manifest_[0-9a-f-]{36}$/u);
const loadReceiptIdSchema = z
  .string()
  .regex(/^center_agent_context_load_receipt_[0-9a-f-]{36}$/u);

export const centerAgentContextManifestViewSchema = z.literal("messages");

export const createCenterAgentContextManifestBodySchema = z.strictObject({
  spaceId: centerAgentSessionSelectorSchema.shape.spaceId.optional(),
  cursor: z.string().trim().min(1).max(768).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(CENTER_AGENT_CONTEXT_MAX_MESSAGE_LIMIT)
    .default(CENTER_AGENT_CONTEXT_DEFAULT_MESSAGE_LIMIT),
  maxContextTokens: z
    .number()
    .int()
    .min(CENTER_AGENT_CONTEXT_MIN_TOKEN_BUDGET)
    .max(CENTER_AGENT_CONTEXT_MAX_TOKEN_BUDGET)
    .default(CENTER_AGENT_CONTEXT_DEFAULT_TOKEN_BUDGET),
  source: centerAgentInteractionSourceSchema,
  view: centerAgentContextManifestViewSchema.default("messages"),
});

export const centerAgentContextManifestSourceRefSchema = z.strictObject({
  id: trimmedNonEmptyStringSchema,
  type: z.literal("space_signal"),
  uri: z.string().regex(/^openmeld:\/\/spaces\/[^/]+\/signals\/[^/]+$/u),
  version: contentHashSchema,
});

export const centerAgentContextManifestEntrySchema = z.strictObject({
  author: z.strictObject({
    profileId: trimmedNonEmptyStringSchema,
    profileKind: z.enum(["agent", "human", "system"]),
    profileName: trimmedNonEmptyStringSchema,
  }),
  carrier: z
    .strictObject({
      client: trimmedNonEmptyStringSchema.max(80),
      kind: z.literal("local_agent"),
    })
    .optional(),
  content: z.strictObject({
    originalCharacterCount: z.number().int().nonnegative(),
    text: z.string(),
    truncated: z.boolean(),
    type: z.literal("text"),
  }),
  materializedContentHash: contentHashSchema,
  occurredAt: ISO_DATE_TIME_SCHEMA,
  redactions: z.array(
    z.enum([
      "attachments_not_in_messages_view",
      "local_session_locator_omitted",
      "message_content_budget",
    ])
  ),
  replyToSignalId: trimmedNonEmptyStringSchema.optional(),
  sourceRef: centerAgentContextManifestSourceRefSchema,
});

export const centerAgentContextManifestMaterializationSchema = z.strictObject({
  estimatedTokens: z.number().int().nonnegative(),
  materializedContentHash: contentHashSchema,
  sourceRef: centerAgentContextManifestSourceRefSchema,
});

export const centerAgentContextLoadSelectedEntrySchema = z.strictObject({
  materializedContentHash: contentHashSchema,
  sourceRefId: trimmedNonEmptyStringSchema,
});

export const centerAgentContextLoadSelectionSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("all_manifest_entries") }),
    z.strictObject({
      entries: z
        .array(centerAgentContextLoadSelectedEntrySchema)
        .min(1)
        .max(50),
      kind: z.literal("selected_entries"),
    }),
  ]
);

export const createCenterAgentContextLoadReceiptBodySchema = z.strictObject({
  selection: centerAgentContextLoadSelectionSchema,
  source: centerAgentInteractionSourceSchema,
});

export const createCenterAgentContextManifestResponseSchema = z.strictObject({
  authorization: z.strictObject({
    principal: z.literal("authenticated_member"),
    scope: z.literal("requester_private"),
  }),
  availableViews: z.tuple([z.literal("messages")]),
  budget: z.strictObject({
    estimateAlgorithm: z.literal(CENTER_AGENT_CONTEXT_TOKEN_ESTIMATE_ALGORITHM),
    estimatedTokens: z.number().int().nonnegative(),
    includedMessages: z.number().int().nonnegative(),
    requestedTokens: z.number().int().positive(),
    truncated: z.boolean(),
    truncationReasons: z.array(
      z.enum([
        "context_token_budget",
        "message_content_budget",
        "message_limit",
        "older_messages_available",
      ])
    ),
  }),
  continuation: z.strictObject({
    cursor: z.string().trim().min(1).max(768).nullable(),
    hasMore: z.boolean(),
  }),
  entries: z.array(centerAgentContextManifestEntrySchema),
  generatedAt: ISO_DATE_TIME_SCHEMA,
  manifestId: centerAgentContextManifestIdSchema,
  provenance: z.strictObject({
    auditEntryId: trimmedNonEmptyStringSchema,
    contentProjection: z.literal("user_visible_space_signals"),
  }),
  request: z.strictObject({
    source: centerAgentInteractionSourceSchema,
  }),
  schemaVersion: z.literal(CENTER_AGENT_CONTEXT_MANIFEST_VERSION),
  subject: z.strictObject({
    centerAgentProfileId: trimmedNonEmptyStringSchema,
    conversationId: trimmedNonEmptyStringSchema,
    kind: z.literal("center_agent_conversation"),
    memberProfileId: trimmedNonEmptyStringSchema,
    organizationId: trimmedNonEmptyStringSchema,
  }),
  view: centerAgentContextManifestViewSchema,
});

export const createCenterAgentContextLoadReceiptResponseSchema = z.strictObject(
  {
    authorization: z.strictObject({
      principal: z.literal("authenticated_member"),
      scope: z.literal("requester_private"),
    }),
    provenance: z.strictObject({
      auditEntryId: trimmedNonEmptyStringSchema,
    }),
    receipt: z.strictObject({
      client: trimmedNonEmptyStringSchema.max(80),
      estimatedTokens: z.number().int().nonnegative(),
      id: loadReceiptIdSchema,
      includedMessages: z.number().int().min(1).max(50),
      manifestId: centerAgentContextManifestIdSchema,
      selectedEntries: z
        .array(centerAgentContextLoadSelectedEntrySchema)
        .min(1)
        .max(50),
      status: z.literal("loaded"),
    }),
    recordedAt: ISO_DATE_TIME_SCHEMA,
    schemaVersion: z.literal(CENTER_AGENT_CONTEXT_LOAD_RECEIPT_VERSION),
  }
);
