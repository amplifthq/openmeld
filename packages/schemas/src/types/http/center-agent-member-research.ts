import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/center-agent-member-research");

export type CenterAgentMemberResearchScope = z.infer<
  Schemas["centerAgentMemberResearchScopeSchema"]
>;
export type CenterAgentMemberResearchEvidenceItem = z.infer<
  Schemas["centerAgentMemberResearchEvidenceItemSchema"]
>;
export type CenterAgentMemberResearchCoverage = z.infer<
  Schemas["centerAgentMemberResearchCoverageSchema"]
>;
export type CenterAgentMemberResearchReport = z.infer<
  Schemas["centerAgentMemberResearchReportSchema"]
>;
export type CenterAgentMemberResearchBatchStatus = z.infer<
  Schemas["centerAgentMemberResearchBatchStatusSchema"]
>;
export type CenterAgentMemberResearchTaskStatus = z.infer<
  Schemas["centerAgentMemberResearchTaskStatusSchema"]
>;
export type CenterAgentMemberResearchTask = z.infer<
  Schemas["centerAgentMemberResearchTaskSchema"]
>;
export type CenterAgentMemberResearchBatch = z.infer<
  Schemas["centerAgentMemberResearchBatchSchema"]
>;
export type StartCenterAgentMemberResearchBody = z.infer<
  Schemas["startCenterAgentMemberResearchBodySchema"]
>;
export type StartCenterAgentMemberResearchResponse = z.infer<
  Schemas["startCenterAgentMemberResearchResponseSchema"]
>;
export type StartCenterAgentMemberResearchRpcInput = z.infer<
  Schemas["startCenterAgentMemberResearchRpcInputSchema"]
>;
export type CenterAgentStartSelfMemberResearchToolRpcInput = z.infer<
  Schemas["centerAgentStartSelfMemberResearchToolRpcInputSchema"]
>;
export type GetCenterAgentMemberResearchStatusResponse = z.infer<
  Schemas["getCenterAgentMemberResearchStatusResponseSchema"]
>;
export type GetCenterAgentMemberResearchStatusRpcInput = z.infer<
  Schemas["getCenterAgentMemberResearchStatusRpcInputSchema"]
>;
