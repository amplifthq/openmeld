import { describe, expect, it } from "vitest";
import {
  centerAgentRecommendOpportunityToolRpcInputSchema,
  centerAgentRespondToOpportunityBodySchema,
  organizationOpportunitySchema,
} from "../../src";

const REQUEST_CONTEXT = {
  activeOrganizationId: "org-1",
  actorContext: {
    agentControllerRef: "hosted:center-agent",
    callerPrincipalId: "user-1",
    ownerUserId: "user-1",
    profileKind: "agent" as const,
    requestId: "request-opportunity",
    openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
  },
};

const OPEN_OPPORTUNITY = {
  createdAtMs: 1000,
  decidedAtMs: null,
  evidence: ["The release-review checklist is not scheduled."],
  expectedBenefit: "Catch release blockers before customers encounter them.",
  id: "opp-1",
  observation: "This Organization reviews releases manually after deployment.",
  opportunityKey: "release-review:weekly-check",
  organizationId: "org-1",
  status: "open" as const,
  suggestedNextStep: "Create a weekly release-review Routine.",
  title: "Review releases before they ship",
  updatedAtMs: 1000,
};

describe("Opportunity contracts", () => {
  it("keeps open and decided lifecycle timestamps consistent", () => {
    expect(organizationOpportunitySchema.parse(OPEN_OPPORTUNITY)).toEqual(
      OPEN_OPPORTUNITY
    );
    expect(
      organizationOpportunitySchema.safeParse({
        ...OPEN_OPPORTUNITY,
        decidedAtMs: 2000,
      }).success
    ).toBe(false);
    expect(
      organizationOpportunitySchema.parse({
        ...OPEN_OPPORTUNITY,
        decidedAtMs: 2000,
        status: "deferred",
        updatedAtMs: 2000,
      })
    ).toMatchObject({ decidedAtMs: 2000, status: "deferred" });
  });

  it("requires a verified member for Center Agent recommendations", () => {
    const recommendation = {
      context: REQUEST_CONTEXT,
      evidence: OPEN_OPPORTUNITY.evidence,
      expectedBenefit: OPEN_OPPORTUNITY.expectedBenefit,
      observation: OPEN_OPPORTUNITY.observation,
      opportunityKey: OPEN_OPPORTUNITY.opportunityKey,
      suggestedNextStep: OPEN_OPPORTUNITY.suggestedNextStep,
      title: OPEN_OPPORTUNITY.title,
    };

    expect(
      centerAgentRecommendOpportunityToolRpcInputSchema.parse({
        ...recommendation,
        speakerMember: { memberId: "member-1", userId: "user-1" },
      })
    ).toMatchObject({ opportunityKey: "release-review:weekly-check" });
    expect(
      centerAgentRecommendOpportunityToolRpcInputSchema.safeParse({
        ...recommendation,
        speakerMember: null,
      }).success
    ).toBe(false);
  });

  it("accepts only the three explicit member decisions", () => {
    for (const decision of ["accepted", "deferred", "dismissed"] as const) {
      expect(
        centerAgentRespondToOpportunityBodySchema.parse({
          decision,
          opportunityId: "opp-1",
        })
      ).toEqual({ decision, opportunityId: "opp-1" });
    }
    expect(
      centerAgentRespondToOpportunityBodySchema.safeParse({
        decision: "approved_and_execute",
        opportunityId: "opp-1",
      }).success
    ).toBe(false);
  });
});
