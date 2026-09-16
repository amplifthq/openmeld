import * as z from "zod/v4";

export const agentProfileExecutionModeSchema = z.enum(["parallel", "serial"]);

export const updateAgentProfileExecutionModeBodySchema = z
  .object({ mode: agentProfileExecutionModeSchema })
  .strict();

export const agentProfileExecutionModeResponseSchema = z
  .object({
    agentProfileId: z.string().min(1),
    mode: agentProfileExecutionModeSchema,
    migration: z.enum(["legacy", "draining", "contexts"]),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const runtimeTransportAgentProfileExecutionModeRequestSchema = z
  .object({
    ownerUserId: z.string().min(1),
    targetProfileId: z.string().min(1),
    mode: agentProfileExecutionModeSchema.optional(),
  })
  .strict();

export type AgentProfileExecutionModeResponse = z.infer<
  typeof agentProfileExecutionModeResponseSchema
>;
export type RuntimeTransportAgentProfileExecutionModeRequest = z.infer<
  typeof runtimeTransportAgentProfileExecutionModeRequestSchema
>;
