import type { z } from "zod/v4";

type AgentExecutionReadinessRouteParamsSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["agentExecutionReadinessRouteParamsSchema"];
type AgentExecutionReadinessResponseOptionsSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["agentExecutionReadinessResponseOptionsSchema"];
type AgentExecutionReadinessTargetRuntimeSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["agentExecutionReadinessTargetRuntimeSchema"];
type AgentExecutionReadinessSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["agentExecutionReadinessSchema"];
type AgentExecutionReadinessPrimaryActionSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["agentExecutionReadinessPrimaryActionSchema"];
type AgentExecutionReadinessPrimaryActionPlanSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["agentExecutionReadinessPrimaryActionPlanSchema"];
type AgentWakeAvailabilitySchema =
  typeof import("../../schemas/http/agent-execution-readiness")["agentWakeAvailabilitySchema"];
type AgentWakeAvailabilityCategorySchema =
  typeof import("../../schemas/http/agent-execution-readiness")["agentWakeAvailabilityCategorySchema"];
type AgentWakeAvailabilityPhaseSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["agentWakeAvailabilityPhaseSchema"];
type AgentWakeAvailabilityStatusSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["agentWakeAvailabilityStatusSchema"];
type AgentWakeRouteRegistrationSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["agentWakeRouteRegistrationSchema"];
type AgentWakeRouteRegistrationStatusSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["agentWakeRouteRegistrationStatusSchema"];
type GetAgentExecutionReadinessBatchBodySchema =
  typeof import("../../schemas/http/agent-execution-readiness")["getAgentExecutionReadinessBatchBodySchema"];
type GetAgentExecutionReadinessBatchResponseSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["getAgentExecutionReadinessBatchResponseSchema"];
type GetAgentExecutionReadinessResponseSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["getAgentExecutionReadinessResponseSchema"];
type WakeRouteEvidenceSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["wakeRouteEvidenceSchema"];
type WakeRouteStatusSchema =
  typeof import("../../schemas/http/agent-execution-readiness")["wakeRouteStatusSchema"];

export type AgentExecutionReadinessRouteParams =
  z.infer<AgentExecutionReadinessRouteParamsSchema>;
export type AgentExecutionReadinessResponseOptions =
  z.infer<AgentExecutionReadinessResponseOptionsSchema>;
export type AgentExecutionReadinessTargetRuntime =
  z.infer<AgentExecutionReadinessTargetRuntimeSchema>;
export type AgentExecutionReadiness = z.infer<AgentExecutionReadinessSchema>;
export type AgentExecutionReadinessPrimaryAction =
  z.infer<AgentExecutionReadinessPrimaryActionSchema>;
export type AgentExecutionReadinessPrimaryActionPlan =
  z.infer<AgentExecutionReadinessPrimaryActionPlanSchema>;
export type AgentWakeAvailability = z.infer<AgentWakeAvailabilitySchema>;
export type AgentWakeAvailabilityCategory =
  z.infer<AgentWakeAvailabilityCategorySchema>;
export type AgentWakeAvailabilityPhase =
  z.infer<AgentWakeAvailabilityPhaseSchema>;
export type AgentWakeAvailabilityStatus =
  z.infer<AgentWakeAvailabilityStatusSchema>;
export type AgentWakeRouteRegistration =
  z.infer<AgentWakeRouteRegistrationSchema>;
export type AgentWakeRouteRegistrationStatus =
  z.infer<AgentWakeRouteRegistrationStatusSchema>;
export type GetAgentExecutionReadinessBatchBody =
  z.infer<GetAgentExecutionReadinessBatchBodySchema>;
export type GetAgentExecutionReadinessBatchResponse =
  z.infer<GetAgentExecutionReadinessBatchResponseSchema>;
export type GetAgentExecutionReadinessResponse =
  z.infer<GetAgentExecutionReadinessResponseSchema>;
export type WakeRouteEvidence = z.infer<WakeRouteEvidenceSchema>;
export type WakeRouteStatus = z.infer<WakeRouteStatusSchema>;
