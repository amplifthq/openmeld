import * as z from "zod/v4";
import { agentProfileIdSchema } from "../protocol/profile";

export const agentProfileWorkRecoveryActionSchema = z.enum([
  "continue_interrupted_work",
  "approve_queued_work",
]);

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
