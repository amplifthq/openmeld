import type { z } from "zod/v4";

type AgentTaskHandleSchema =
  typeof import("../../schemas/runtime/agent-task-coordination")["agentTaskHandleSchema"];
type ControllerAgentTaskHandleSchema =
  typeof import("../../schemas/runtime/agent-task-coordination")["controllerAgentTaskHandleSchema"];
type AgentTaskTerminalStatusSchema =
  typeof import("../../schemas/runtime/agent-task-coordination")["agentTaskTerminalStatusSchema"];
type AgentTaskTerminalOutcomeSchema =
  typeof import("../../schemas/runtime/agent-task-coordination")["agentTaskTerminalOutcomeSchema"];
type AgentTaskNeedsAttentionObservationSchema =
  typeof import("../../schemas/runtime/agent-task-coordination")["agentTaskNeedsAttentionObservationSchema"];
type AgentTaskCompletionObservationSchema =
  typeof import("../../schemas/runtime/agent-task-coordination")["agentTaskCompletionObservationSchema"];
type AgentTaskCompletionConditionSchema =
  typeof import("../../schemas/runtime/agent-task-coordination")["agentTaskCompletionConditionSchema"];
type AgentTaskContinuationSchema =
  typeof import("../../schemas/runtime/agent-task-coordination")["agentTaskContinuationSchema"];
type AgentDelegationBarrierSchema =
  typeof import("../../schemas/runtime/agent-task-coordination")["agentDelegationBarrierSchema"];
type AgentDelegationCompletionPolicySchema =
  typeof import("../../schemas/runtime/agent-task-coordination")["agentDelegationCompletionPolicySchema"];
type AgentDelegationSnapshotSchema =
  typeof import("../../schemas/runtime/agent-task-coordination")["agentDelegationSnapshotSchema"];

export type AgentTaskHandle = z.infer<AgentTaskHandleSchema>;
export type ControllerAgentTaskHandle =
  z.infer<ControllerAgentTaskHandleSchema>;
export type AgentTaskTerminalStatus = z.infer<AgentTaskTerminalStatusSchema>;
export type AgentTaskTerminalOutcome = z.infer<AgentTaskTerminalOutcomeSchema>;
export type AgentTaskNeedsAttentionObservation =
  z.infer<AgentTaskNeedsAttentionObservationSchema>;
export type AgentTaskCompletionObservation =
  z.infer<AgentTaskCompletionObservationSchema>;
export type AgentTaskCompletionCondition =
  z.infer<AgentTaskCompletionConditionSchema>;
export type AgentTaskContinuation = z.infer<AgentTaskContinuationSchema>;
export type AgentDelegationBarrier = z.infer<AgentDelegationBarrierSchema>;
export type AgentDelegationCompletionPolicy =
  z.infer<AgentDelegationCompletionPolicySchema>;
export type AgentDelegationSnapshot = z.infer<AgentDelegationSnapshotSchema>;
