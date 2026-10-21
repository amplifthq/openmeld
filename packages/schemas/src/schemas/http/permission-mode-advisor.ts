import * as z from "zod/v4";
import { agentControllerPermissionModeSchema } from "../agent-controller-permission-mode";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { runtimeCoordinatorExecutionTokenEchoSchema } from "../daemon/runtime-coordinator-execution-token";

// Contract: developing/product/organizations-and-center-agent.md
// (Permission-mode advisor). The advisor is prompt guidance plus an
// owner-only suggestion card; it never changes a setting by itself.

export const PERMISSION_MODE_ADVISOR_TOP_REQUESTER_LIMIT = 3;
const MAX_REQUESTER_NAME_LENGTH = 120;
const identifierSchema = z.string().trim().min(1).max(256);

/**
 * Core-computed advisory carried in an owner-requested Wake's dispatch
 * payload. Core sends it only when the Service advertises
 * `permissionModeAdvisoryPrompt` and Core verified that the Agent owner
 * requested the Wake.
 */
export const permissionModeAdvisorySchema = z.strictObject({
  windowDays: z.literal(7),
  waitingApprovalCount: z.number().int().min(1).max(10_000),
  topRequesterNames: z
    .array(z.string().trim().min(1).max(MAX_REQUESTER_NAME_LENGTH))
    .max(PERMISSION_MODE_ADVISOR_TOP_REQUESTER_LIMIT),
  currentPermissionMode: agentControllerPermissionModeSchema,
  currentPermissionModeLabel: z.string().trim().min(1).max(120),
  suggestedPermissionMode: agentControllerPermissionModeSchema,
  suggestedPermissionModeLabel: z.string().trim().min(1).max(120),
});
export type PermissionModeAdvisory = z.infer<
  typeof permissionModeAdvisorySchema
>;

/** Owner-only suggestion card shown in the Space where the Agent offered it. */
export const permissionModeSuggestionSchema = z.strictObject({
  suggestionId: identifierSchema,
  agentProfileId: identifierSchema,
  spaceId: identifierSchema,
  currentPermissionMode: agentControllerPermissionModeSchema,
  suggestedPermissionMode: agentControllerPermissionModeSchema,
  waitingApprovalCount: z.number().int().min(1),
  offeredAtMs: z.number().int().nonnegative(),
});
export type PermissionModeSuggestion = z.infer<
  typeof permissionModeSuggestionSchema
>;

/**
 * Body the task stand-in sends for the `suggest_permission_mode` action. The
 * dispatch id and execution proof bind the card to the one owner-requested
 * Wake that received the advisory.
 */
export const suggestPermissionModeRequestSchema = z.strictObject({
  dispatchId: identifierSchema,
  executionTokenEcho: runtimeCoordinatorExecutionTokenEchoSchema,
});
export type SuggestPermissionModeRequest = z.infer<
  typeof suggestPermissionModeRequestSchema
>;
export const suggestPermissionModeRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  expectedOrganizationId: identifierSchema,
  request: suggestPermissionModeRequestSchema,
});
export type SuggestPermissionModeRpcInput = z.infer<
  typeof suggestPermissionModeRpcInputSchema
>;
export const suggestPermissionModeResponseSchema = z.strictObject({
  status: z.enum(["offered", "already_offered", "already_resolved"]),
  suggestion: permissionModeSuggestionSchema,
});
export type SuggestPermissionModeResponse = z.infer<
  typeof suggestPermissionModeResponseSchema
>;

export const listPermissionModeSuggestionsBodySchema = z.strictObject({
  spaceId: identifierSchema,
});
export const listPermissionModeSuggestionsRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  expectedOrganizationId: identifierSchema,
  spaceId: identifierSchema,
});
export type ListPermissionModeSuggestionsRpcInput = z.infer<
  typeof listPermissionModeSuggestionsRpcInputSchema
>;
export const listPermissionModeSuggestionsResponseSchema = z.strictObject({
  suggestions: z.array(permissionModeSuggestionSchema).max(50),
});
export type ListPermissionModeSuggestionsResponse = z.infer<
  typeof listPermissionModeSuggestionsResponseSchema
>;

/**
 * Closes a card. `applied` is recorded after the owner's Web session saved the
 * mode through the existing permission-mode write; this call never writes it.
 */
export const resolvePermissionModeSuggestionBodySchema = z.strictObject({
  suggestionId: identifierSchema,
  resolution: z.enum(["applied", "dismissed"]),
});
export const resolvePermissionModeSuggestionRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  expectedOrganizationId: identifierSchema,
  suggestionId: identifierSchema,
  resolution: z.enum(["applied", "dismissed"]),
});
export type ResolvePermissionModeSuggestionRpcInput = z.infer<
  typeof resolvePermissionModeSuggestionRpcInputSchema
>;
export const resolvePermissionModeSuggestionResponseSchema = z.strictObject({
  suggestionId: identifierSchema,
  status: z.enum(["applied", "dismissed"]),
});
export type ResolvePermissionModeSuggestionResponse = z.infer<
  typeof resolvePermissionModeSuggestionResponseSchema
>;
