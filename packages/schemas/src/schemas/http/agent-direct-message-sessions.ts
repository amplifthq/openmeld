import * as z from "zod/v4";
import { agentProfileIdSchema } from "../protocol/profile";
import { accountSpaceIndexItemSchema } from "./account-space-index";
import { centerAgentSessionSelectorSchema } from "./center-agent-direct-message-space";
import { MAX_SPACE_NAME_LENGTH, spaceNameSchema } from "./space-name";

// Agent Direct Message Sessions (developing/product/space-collaboration.md):
// one Session is one Direct Message Space; New Chat creates another Space for
// the same Human–Agent pair key. These contracts list and manage the Sessions
// of one pair. The Center Agent pair uses the same operations.

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const trimmedNonEmptyStringSchema = z.string().trim().min(1);

// A Session is a Space; its name follows the Space name contract.
export const AGENT_DIRECT_MESSAGE_SESSION_NAME_MAX_LENGTH =
  MAX_SPACE_NAME_LENGTH;

export const agentDirectMessageSessionSelectorSchema =
  centerAgentSessionSelectorSchema;

export const listAgentDirectMessageSessionsQuerySchema = z.strictObject({
  agentProfileId: agentProfileIdSchema,
  cursor: z.string().trim().min(1).max(1024).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  // Archived Sessions are listed only on request; the default list is active.
  archived: z.boolean().default(false),
});

export const agentDirectMessageSessionListCursorSchema = z.strictObject({
  v: z.literal(1),
  organizationId: trimmedNonEmptyStringSchema,
  pairKey: trimmedNonEmptyStringSchema,
  archived: z.boolean(),
  createdAtMs: z.number().int().nonnegative(),
  spaceId: agentDirectMessageSessionSelectorSchema.shape.spaceId,
});

export const agentDirectMessageSessionSchema = z.strictObject({
  spaceId: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
  agentProfileId: trimmedNonEmptyStringSchema,
  memberProfileId: trimmedNonEmptyStringSchema,
  name: z.string().nullable(),
  createdAt: ISO_DATE_TIME_SCHEMA.nullable(),
  archivedAt: ISO_DATE_TIME_SCHEMA.nullable(),
  messagePreview: accountSpaceIndexItemSchema.shape.messagePreview,
});

export const listAgentDirectMessageSessionsResponseSchema = z.strictObject({
  generatedAt: ISO_DATE_TIME_SCHEMA,
  organizationId: trimmedNonEmptyStringSchema,
  agentProfileId: trimmedNonEmptyStringSchema,
  memberProfileId: trimmedNonEmptyStringSchema,
  sessions: z.array(agentDirectMessageSessionSchema).max(100),
  nextCursor: z.string().min(1).max(1024).nullable(),
});

// One dedicated operation per Session change. These never unlock the generic
// Direct Message metadata, lifecycle, or deletion mutations.
export const updateAgentDirectMessageSessionBodySchema = z.union([
  z.strictObject({
    operation: z.literal("rename"),
    name: spaceNameSchema,
  }),
  z.strictObject({ operation: z.literal("archive") }),
  z.strictObject({ operation: z.literal("unarchive") }),
]);

export const updateAgentDirectMessageSessionResponseSchema = z.strictObject({
  spaceId: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
  name: z.string().nullable(),
  archivedAt: ISO_DATE_TIME_SCHEMA.nullable(),
});

export const deleteAgentDirectMessageSessionResponseSchema = z.strictObject({
  spaceId: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
  deleted: z.literal(true),
});

export type ListAgentDirectMessageSessionsQuery = z.input<
  typeof listAgentDirectMessageSessionsQuerySchema
>;
export type ListAgentDirectMessageSessionsResponse = z.infer<
  typeof listAgentDirectMessageSessionsResponseSchema
>;
export type AgentDirectMessageSession = z.infer<
  typeof agentDirectMessageSessionSchema
>;
export type UpdateAgentDirectMessageSessionBody = z.infer<
  typeof updateAgentDirectMessageSessionBodySchema
>;
export type UpdateAgentDirectMessageSessionResponse = z.infer<
  typeof updateAgentDirectMessageSessionResponseSchema
>;
export type DeleteAgentDirectMessageSessionResponse = z.infer<
  typeof deleteAgentDirectMessageSessionResponseSchema
>;
