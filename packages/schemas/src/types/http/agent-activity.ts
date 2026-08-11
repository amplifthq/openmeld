import type { z } from "zod/v4";

type AgentActivitySchemas = typeof import("../../schemas/http/agent-activity");

export type AgentActivityEvent = z.infer<
  AgentActivitySchemas["agentActivityEventSchema"]
>;
export type AgentActivityEventType = z.infer<
  AgentActivitySchemas["agentActivityEventTypeSchema"]
>;
export type AgentActivityEventOutcome = z.infer<
  AgentActivitySchemas["agentActivityEventOutcomeSchema"]
>;
export type AgentActivityEventRejectionReason = z.infer<
  AgentActivitySchemas["agentActivityEventRejectionReasonSchema"]
>;
export type AgentActivitySessionStatus = z.infer<
  AgentActivitySchemas["agentActivitySessionStatusSchema"]
>;
export type AgentActivityProvider = z.infer<
  AgentActivitySchemas["agentActivityProviderSchema"]
>;
export type AgentActivityClientKind = z.infer<
  AgentActivitySchemas["agentActivityClientKindSchema"]
>;
export type AgentActivityPublicEvent = z.infer<
  AgentActivitySchemas["agentActivityPublicEventSchema"]
>;
export type AgentActivityPublicDigest = z.infer<
  AgentActivitySchemas["agentActivityPublicDigestSchema"]
>;
export type AgentActivityDigestCitation = z.infer<
  AgentActivitySchemas["agentActivityDigestCitationSchema"]
>;
export type AgentActivityDigestEvidence = z.infer<
  AgentActivitySchemas["agentActivityDigestEvidenceSchema"]
>;
export type AgentActivityPublicSession = z.infer<
  AgentActivitySchemas["agentActivityPublicSessionSchema"]
>;
export type AgentActivitySnapshotQuery = z.infer<
  AgentActivitySchemas["agentActivitySnapshotQuerySchema"]
>;
export type AgentActivitySnapshotResponse = z.infer<
  AgentActivitySchemas["agentActivitySnapshotResponseSchema"]
>;
export type AgentActivitySnapshotRpcInput = z.infer<
  AgentActivitySchemas["agentActivitySnapshotRpcInputSchema"]
>;
export type AgentActivityStatsDaily = z.infer<
  AgentActivitySchemas["agentActivityStatsDailySchema"]
>;
export type AgentActivityStatsQuery = z.infer<
  AgentActivitySchemas["agentActivityStatsQuerySchema"]
>;
export type AgentActivityStatsResponse = z.infer<
  AgentActivitySchemas["agentActivityStatsResponseSchema"]
>;
export type AgentActivityStatsRpcInput = z.infer<
  AgentActivitySchemas["agentActivityStatsRpcInputSchema"]
>;
export type CenterAgentReadAgentActivityToolRpcInput = z.infer<
  AgentActivitySchemas["centerAgentReadAgentActivityToolRpcInputSchema"]
>;
export type SubmitAgentActivityEventsBody = z.infer<
  AgentActivitySchemas["submitAgentActivityEventsBodySchema"]
>;
export type SubmitAgentActivityEventResult = z.infer<
  AgentActivitySchemas["submitAgentActivityEventResultSchema"]
>;
export type SubmitAgentActivityEventsResponse = z.infer<
  AgentActivitySchemas["submitAgentActivityEventsResponseSchema"]
>;
export type SubmitAgentActivityEventsRpcInput = z.infer<
  AgentActivitySchemas["submitAgentActivityEventsRpcInputSchema"]
>;
export type SummarizeAgentActivityDigestRpcInput = z.infer<
  AgentActivitySchemas["summarizeAgentActivityDigestRpcInputSchema"]
>;
export type SummarizeAgentActivityDigestRpcResponse = z.infer<
  AgentActivitySchemas["summarizeAgentActivityDigestRpcResponseSchema"]
>;
