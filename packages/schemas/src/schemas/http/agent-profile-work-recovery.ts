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
});

export const executeAgentProfileWorkRecoveryResponseSchema = z.strictObject({
  action: agentProfileWorkRecoveryActionSchema,
  status: z.literal("accepted"),
});
