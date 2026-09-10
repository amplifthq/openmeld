import * as z from "zod/v4";

export const RECONCILE_DELETED_AGENT_PROFILE_MAX_SPACES = 500;

export const reconcileDeletedAgentProfileRequestSchema = z.strictObject({
  ownerUserId: z.string().trim().min(1).nullable(),
  organizationId: z.string().trim().min(1).nullable().optional(),
  profileId: z.string().trim().min(1),
  // Deletion fan-out covers both kinds; absent means agent for callers that
  // predate human coverage.
  profileKind: z.enum(["agent", "human"]).optional(),
  spaceIds: z
    .array(z.string().trim().min(1))
    .max(RECONCILE_DELETED_AGENT_PROFILE_MAX_SPACES),
});

export const reconcileDeletedAgentProfileSpaceOutcomeSchema = z.strictObject({
  spaceId: z.string().min(1),
  status: z.enum(["removed", "skipped_creator", "noop", "failed"]),
});

export const reconcileDeletedAgentProfileResponseSchema = z.strictObject({
  bindingDisabled: z.boolean(),
  // Optional only for rolling-deploy compatibility. New Core workers always
  // return this; Auth keeps the durable outbox item until it observes true.
  complete: z.boolean().optional(),
  profileId: z.string().min(1),
  spaces: z.array(reconcileDeletedAgentProfileSpaceOutcomeSchema),
});
