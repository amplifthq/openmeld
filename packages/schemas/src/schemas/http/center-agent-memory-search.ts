import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentVerifiedMemberToolSpeakerSchema } from "./center-agent-speaker";

export const CENTER_AGENT_RETAINED_MEMORY_QUERY_MAX_CHARS = 400;
export const CENTER_AGENT_RETAINED_MEMORY_MAX_ITEMS = 6;
export const CENTER_AGENT_RETAINED_MEMORY_MAX_SOURCES = 8;
export const CENTER_AGENT_RETAINED_MEMORY_MAX_TEXT_CHARS = 1000;

export const centerAgentSearchMemoryRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  speakerMember: centerAgentVerifiedMemberToolSpeakerSchema,
  query: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_RETAINED_MEMORY_QUERY_MAX_CHARS),
  limit: z
    .number()
    .int()
    .min(1)
    .max(CENTER_AGENT_RETAINED_MEMORY_MAX_ITEMS)
    .optional(),
});
export const centerAgentMemorySourceReferenceSchema = z.strictObject({
  source: z.enum(["ca_dm", "space_conversation"]),
  spaceId: z.string().min(1).max(256),
  signalId: z.string().min(1).max(256),
  occurredAtMs: z.number().int().nonnegative(),
  captureMethod: z.enum(["automatic_turn", "explicit_save"]),
  availability: z.literal("readable"),
  version: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/u)
    .optional(),
  authorKind: z.enum(["human", "agent", "system"]).optional(),
});
export const centerAgentSearchMemoryResponseSchema = z.strictObject({
  organizationId: z.string().min(1),
  observedAtMs: z.number().int().nonnegative(),
  status: z.enum(["matched", "no_match", "partial", "unavailable"]),
  items: z
    .array(
      z.strictObject({
        text: z
          .string()
          .min(1)
          .max(CENTER_AGENT_RETAINED_MEMORY_MAX_TEXT_CHARS),
        textShortened: z.boolean(),
        scope: z.enum(["member", "organization", "space"]),
        interpretation: z.literal("remembered_summary_not_quote"),
        currentness: z.literal("not_verified"),
        sources: z
          .array(centerAgentMemorySourceReferenceSchema)
          .min(1)
          .max(CENTER_AGENT_RETAINED_MEMORY_MAX_SOURCES),
      })
    )
    .max(CENTER_AGENT_RETAINED_MEMORY_MAX_ITEMS),
  coverage: z.strictObject({
    kind: z.literal("bounded_retained_memory_search"),
    access: z.literal("all_sources_and_reply_audience_checked"),
    completeHistory: z.literal(false),
    cursorSupported: z.literal(false),
    supportedSources: z.tuple([
      z.literal("ca_dm"),
      z.literal("space_conversation"),
    ]),
    unsupportedSources: z.tuple([
      z.literal("slack_conversation"),
      z.literal("message_channel_conversation"),
      z.literal("legacy_explicit_tool_without_conversation_origin"),
    ]),
    currentDecisionVerification: z.literal(
      "read_original_sources_and_current_organization_document_revisions"
    ),
  }),
});
