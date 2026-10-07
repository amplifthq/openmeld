import * as z from "zod/v4";
import { agentProfileWorkRecoveryActionKindSchema } from "../agent-profile-work-recovery";
import { agentProfileIdSchema } from "../protocol/profile";

export const agentProfileWorkRecoveryActionSchema =
  agentProfileWorkRecoveryActionKindSchema;

export const agentProfileWorkRecoveryRouteParamsSchema = z.strictObject({
  agentProfileId: agentProfileIdSchema,
});

export const executeAgentProfileWorkRecoveryBodySchema = z.strictObject({
  action: agentProfileWorkRecoveryActionSchema,
  expectedInterruptedTargetWakeLifecycleId: z.string().trim().min(1).max(512),
  spaceId: z.string().trim().min(1).max(512).optional(),
});

export const executeAgentProfileWorkRecoveryResponseSchema = z.strictObject({
  action: agentProfileWorkRecoveryActionSchema,
  status: z.literal("accepted"),
});
