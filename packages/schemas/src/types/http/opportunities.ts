import type { z } from "zod/v4";

type OpportunitySchemas = typeof import("../../schemas/http/opportunities");

export type OpportunityStatus = z.infer<
  OpportunitySchemas["opportunityStatusSchema"]
>;
export type OpportunityDecision = z.infer<
  OpportunitySchemas["opportunityDecisionSchema"]
>;
export type OrganizationOpportunity = z.infer<
  OpportunitySchemas["organizationOpportunitySchema"]
>;
export type CenterAgentRecommendOpportunityBody = z.infer<
  OpportunitySchemas["centerAgentRecommendOpportunityBodySchema"]
>;
export type CenterAgentRecommendOpportunityToolRpcInput = z.infer<
  OpportunitySchemas["centerAgentRecommendOpportunityToolRpcInputSchema"]
>;
export type CenterAgentRecommendOpportunityToolResponse = z.infer<
  OpportunitySchemas["centerAgentRecommendOpportunityToolResponseSchema"]
>;
export type CenterAgentListOpportunitiesBody = z.infer<
  OpportunitySchemas["centerAgentListOpportunitiesBodySchema"]
>;
export type CenterAgentListOpportunitiesToolRpcInput = z.infer<
  OpportunitySchemas["centerAgentListOpportunitiesToolRpcInputSchema"]
>;
export type CenterAgentListOpportunitiesToolResponse = z.infer<
  OpportunitySchemas["centerAgentListOpportunitiesToolResponseSchema"]
>;
export type CenterAgentRespondToOpportunityBody = z.infer<
  OpportunitySchemas["centerAgentRespondToOpportunityBodySchema"]
>;
export type CenterAgentRespondToOpportunityToolRpcInput = z.infer<
  OpportunitySchemas["centerAgentRespondToOpportunityToolRpcInputSchema"]
>;
export type CenterAgentRespondToOpportunityToolResponse = z.infer<
  OpportunitySchemas["centerAgentRespondToOpportunityToolResponseSchema"]
>;
