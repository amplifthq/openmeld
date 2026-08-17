import { z } from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentVerifiedMemberToolSpeakerSchema } from "./center-agent-speaker";

export const OPPORTUNITY_TITLE_MAX_CHARS = 160;
export const OPPORTUNITY_OBSERVATION_MAX_CHARS = 1000;
export const OPPORTUNITY_EXPECTED_BENEFIT_MAX_CHARS = 500;
export const OPPORTUNITY_SUGGESTED_NEXT_STEP_MAX_CHARS = 500;
export const OPPORTUNITY_EVIDENCE_MAX_CHARS = 500;
export const OPPORTUNITY_EVIDENCE_MAX_ITEMS = 8;
export const OPPORTUNITY_LIST_DEFAULT_LIMIT = 20;
export const OPPORTUNITY_LIST_MAX_LIMIT = 50;

export const OPPORTUNITY_STATUSES = [
  "open",
  "accepted",
  "deferred",
  "dismissed",
] as const;

export const OPPORTUNITY_DECISIONS = [
  "accepted",
  "deferred",
  "dismissed",
] as const;

const identifierSchema = z.string().trim().min(1).max(256);
const timestampMsSchema = z.number().int().nonnegative();
const titleSchema = z.string().trim().min(1).max(OPPORTUNITY_TITLE_MAX_CHARS);
const observationSchema = z
  .string()
  .trim()
  .min(1)
  .max(OPPORTUNITY_OBSERVATION_MAX_CHARS);
const expectedBenefitSchema = z
  .string()
  .trim()
  .min(1)
  .max(OPPORTUNITY_EXPECTED_BENEFIT_MAX_CHARS);
const suggestedNextStepSchema = z
  .string()
  .trim()
  .min(1)
  .max(OPPORTUNITY_SUGGESTED_NEXT_STEP_MAX_CHARS);
const evidenceSchema = z
  .array(z.string().trim().min(1).max(OPPORTUNITY_EVIDENCE_MAX_CHARS))
  .min(1)
  .max(OPPORTUNITY_EVIDENCE_MAX_ITEMS);

export const opportunityStatusSchema = z.enum(OPPORTUNITY_STATUSES);
export const opportunityDecisionSchema = z.enum(OPPORTUNITY_DECISIONS);

export const organizationOpportunitySchema = z
  .strictObject({
    createdAtMs: timestampMsSchema,
    decidedAtMs: timestampMsSchema.nullable(),
    evidence: evidenceSchema,
    expectedBenefit: expectedBenefitSchema,
    id: identifierSchema,
    observation: observationSchema,
    opportunityKey: identifierSchema,
    organizationId: identifierSchema,
    status: opportunityStatusSchema,
    suggestedNextStep: suggestedNextStepSchema,
    title: titleSchema,
    updatedAtMs: timestampMsSchema,
  })
  .superRefine((opportunity, context) => {
    const isOpen = opportunity.status === "open";
    if (isOpen !== (opportunity.decidedAtMs === null)) {
      context.addIssue({
        code: "custom",
        message:
          "Open opportunities cannot have a decision time, and decided opportunities must have one.",
        path: ["decidedAtMs"],
      });
    }
    if (opportunity.updatedAtMs < opportunity.createdAtMs) {
      context.addIssue({
        code: "custom",
        message: "Opportunity updatedAtMs cannot precede createdAtMs.",
        path: ["updatedAtMs"],
      });
    }
  });

export const centerAgentRecommendOpportunityBodySchema = z.strictObject({
  evidence: evidenceSchema,
  expectedBenefit: expectedBenefitSchema,
  observation: observationSchema,
  opportunityKey: identifierSchema,
  suggestedNextStep: suggestedNextStepSchema,
  title: titleSchema,
});

export const centerAgentRecommendOpportunityToolRpcInputSchema =
  centerAgentRecommendOpportunityBodySchema.extend({
    context: openMeldRequestContextSchema,
    speakerMember: centerAgentVerifiedMemberToolSpeakerSchema,
  });

export const centerAgentRecommendOpportunityToolResponseSchema = z.strictObject(
  {
    created: z.boolean(),
    instruction: z.string().trim().min(1).max(1000),
    opportunity: organizationOpportunitySchema,
  }
);

export const centerAgentListOpportunitiesBodySchema = z.strictObject({
  limit: z.number().int().min(1).max(OPPORTUNITY_LIST_MAX_LIMIT).optional(),
  statuses: z
    .array(opportunityStatusSchema)
    .min(1)
    .max(OPPORTUNITY_STATUSES.length)
    .optional(),
});

export const centerAgentListOpportunitiesToolRpcInputSchema =
  centerAgentListOpportunitiesBodySchema.extend({
    context: openMeldRequestContextSchema,
    speakerMember: centerAgentVerifiedMemberToolSpeakerSchema,
  });

export const centerAgentListOpportunitiesToolResponseSchema = z.strictObject({
  opportunities: z
    .array(organizationOpportunitySchema)
    .max(OPPORTUNITY_LIST_MAX_LIMIT),
  organizationId: identifierSchema,
});

export const centerAgentRespondToOpportunityBodySchema = z.strictObject({
  decision: opportunityDecisionSchema,
  opportunityId: identifierSchema,
});

export const centerAgentRespondToOpportunityToolRpcInputSchema =
  centerAgentRespondToOpportunityBodySchema.extend({
    context: openMeldRequestContextSchema,
    speakerMember: centerAgentVerifiedMemberToolSpeakerSchema,
  });

export const centerAgentRespondToOpportunityToolResponseSchema = z.strictObject(
  {
    changed: z.boolean(),
    instruction: z.string().trim().min(1).max(1000),
    opportunity: organizationOpportunitySchema,
  }
);
