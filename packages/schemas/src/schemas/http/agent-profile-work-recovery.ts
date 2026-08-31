import * as z from "zod/v4";
import { agentProfileWorkRecoveryActionKindSchema } from "../agent-profile-work-recovery";
import { agentProfileIdSchema } from "../protocol/profile";

export const agentProfileWorkRecoveryActionSchema =
  agentProfileWorkRecoveryActionKindSchema;

export const agentProfileWorkRecoveryRouteParamsSchema = z.strictObject({
  agentProfileId: agentProfileIdSchema,
});

export const executeAgentProfileWorkRecoveryBodySchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({ action: z.literal("continue_interrupted_work") }),
    z.strictObject({ action: z.literal("approve_queued_work") }),
    z.strictObject({
      action: z.literal("skip_interrupted_work"),
      expectedInterruptedTargetWakeLifecycleId: z
        .string()
        .trim()
        .min(1)
        .max(512),
    }),
  ]
);

export const executeAgentProfileWorkRecoveryResponseSchema = z.strictObject({
  action: agentProfileWorkRecoveryActionSchema,
  status: z.literal("accepted"),
});
