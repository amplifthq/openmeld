import type { z } from "zod/v4";
import type {
  agentExecutionSteerRequestSchema,
  agentExecutionSteerResponseSchema,
} from "../../schemas/runtime/agent-execution-steer";

export type AgentExecutionSteerRequest = z.infer<
  typeof agentExecutionSteerRequestSchema
>;
export type AgentExecutionSteerResponse = z.infer<
  typeof agentExecutionSteerResponseSchema
>;
