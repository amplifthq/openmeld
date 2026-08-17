import {
  centerAgentListOpportunitiesBodySchema,
  centerAgentRecommendOpportunityBodySchema,
  centerAgentRespondToOpportunityBodySchema,
  OPPORTUNITY_LIST_DEFAULT_LIMIT,
  organizationOpportunitySchema,
} from "@openmeld/schemas";
import type {
  CenterAgentListOpportunitiesBody,
  CenterAgentRecommendOpportunityBody,
  CenterAgentRespondToOpportunityBody,
  OpportunityStatus,
  OrganizationOpportunity,
} from "@openmeld/schemas/types";
import { prepareEnsureInboxItemStatements } from "../../inbox/application/inbox-item-service";
import {
  listOrganizationOpportunitiesForRecipient,
  type OrganizationOpportunityRecord,
  prepareInsertOrganizationOpportunityStatement,
  prepareRecordOpportunityDecisionStatement,
  readOrganizationOpportunityByKey,
  readOrganizationOpportunityForRecipient,
} from "../infrastructure/d1/opportunity-repository";

const INBOX_SOURCE_KIND = "organization_opportunity" as const;

export class OpportunityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityConflictError";
  }
}

export class OpportunityNotFoundError extends Error {
  constructor() {
    super("Opportunity not found for this member.");
    this.name = "OpportunityNotFoundError";
  }
}

export function createOpportunityService(db: D1Database) {
  return {
    list: async (input: {
      organizationId: string;
      recipientUserId: string;
      request: CenterAgentListOpportunitiesBody;
    }): Promise<OrganizationOpportunity[]> => {
      const request = centerAgentListOpportunitiesBodySchema.parse(
        input.request
      );
      const records = await listOrganizationOpportunitiesForRecipient({
        db,
        limit: request.limit ?? OPPORTUNITY_LIST_DEFAULT_LIMIT,
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
        statuses: request.statuses,
      });
      return records.map(toPublicOpportunity);
    },
    recommend: async (input: {
      createdByProfileId: string;
      nowMs: number;
      organizationId: string;
      recipientUserId: string;
      request: CenterAgentRecommendOpportunityBody;
      sourceNativeDeliveryId: string | null;
    }): Promise<{ created: boolean; opportunity: OrganizationOpportunity }> => {
      const request = centerAgentRecommendOpportunityBodySchema.parse(
        input.request
      );
      const existing = await readOrganizationOpportunityByKey({
        db,
        opportunityKey: request.opportunityKey,
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
      });
      if (existing) {
        assertSameRecommendation(existing, request);
        return { created: false, opportunity: toPublicOpportunity(existing) };
      }

      const opportunityId = `opp_${crypto.randomUUID()}`;
      const preparedInbox = await prepareEnsureInboxItemStatements({
        candidate: {
          attention: "update",
          contextLabel: "Opportunity",
          importance: "normal",
          kind: "center_agent_update",
          occurredAtMs: input.nowMs,
          organizationId: input.organizationId,
          preview: request.expectedBenefit,
          recipientUserId: input.recipientUserId,
          sourceKey: opportunityId,
          sourceKind: INBOX_SOURCE_KIND,
          sourceTarget: { kind: "center_agent" },
          title: request.title,
        },
        db,
        nowMs: input.nowMs,
      });
      const insert = prepareInsertOrganizationOpportunityStatement({
        createdByProfileId: input.createdByProfileId,
        db,
        evidence: request.evidence,
        expectedBenefit: request.expectedBenefit,
        id: opportunityId,
        nowMs: input.nowMs,
        observation: request.observation,
        opportunityKey: request.opportunityKey,
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
        sourceNativeDeliveryId: input.sourceNativeDeliveryId,
        suggestedNextStep: request.suggestedNextStep,
        title: request.title,
      });
      try {
        await db.batch([insert, ...preparedInbox.statements]);
      } catch (error) {
        const raced = await readOrganizationOpportunityByKey({
          db,
          opportunityKey: request.opportunityKey,
          organizationId: input.organizationId,
          recipientUserId: input.recipientUserId,
        });
        if (!raced) {
          throw error;
        }
        assertSameRecommendation(raced, request);
        return { created: false, opportunity: toPublicOpportunity(raced) };
      }
      const created = await readOrganizationOpportunityForRecipient({
        db,
        opportunityId,
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
      });
      if (!created) {
        throw new Error("Opportunity write did not produce a readable row.");
      }
      return { created: true, opportunity: toPublicOpportunity(created) };
    },
    respond: async (input: {
      nowMs: number;
      organizationId: string;
      recipientUserId: string;
      request: CenterAgentRespondToOpportunityBody;
    }): Promise<{ changed: boolean; opportunity: OrganizationOpportunity }> => {
      const request = centerAgentRespondToOpportunityBodySchema.parse(
        input.request
      );
      const existing = await readOrganizationOpportunityForRecipient({
        db,
        opportunityId: request.opportunityId,
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
      });
      if (!existing) {
        throw new OpportunityNotFoundError();
      }
      if (isTerminal(existing.status) && existing.status !== request.decision) {
        throw new OpportunityConflictError(
          `This opportunity was already ${existing.status}.`
        );
      }

      const changed = existing.status !== request.decision;
      const statements = changed
        ? [
            prepareRecordOpportunityDecisionStatement({
              db,
              decidedByUserId: input.recipientUserId,
              decision: request.decision,
              nowMs: input.nowMs,
              opportunityId: request.opportunityId,
              organizationId: input.organizationId,
              recipientUserId: input.recipientUserId,
            }),
          ]
        : [];
      if (statements.length > 0) {
        await db.batch(statements);
      }
      const updated = await readOrganizationOpportunityForRecipient({
        db,
        opportunityId: request.opportunityId,
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
      });
      if (!updated) {
        throw new OpportunityNotFoundError();
      }
      if (updated.status !== request.decision) {
        throw new OpportunityConflictError(
          `This opportunity was already ${updated.status}.`
        );
      }
      return { changed, opportunity: toPublicOpportunity(updated) };
    },
  };
}

function assertSameRecommendation(
  existing: OrganizationOpportunityRecord,
  request: CenterAgentRecommendOpportunityBody
): void {
  if (
    existing.title === request.title &&
    existing.observation === request.observation &&
    existing.expectedBenefit === request.expectedBenefit &&
    existing.suggestedNextStep === request.suggestedNextStep &&
    arraysEqual(existing.evidence, request.evidence)
  ) {
    return;
  }
  throw new OpportunityConflictError(
    "This opportunity key already identifies different recommendation content."
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isTerminal(status: OpportunityStatus): boolean {
  return status === "accepted" || status === "dismissed";
}

function toPublicOpportunity(
  record: OrganizationOpportunityRecord
): OrganizationOpportunity {
  return organizationOpportunitySchema.parse({
    createdAtMs: record.createdAtMs,
    decidedAtMs: record.decidedAtMs,
    evidence: record.evidence,
    expectedBenefit: record.expectedBenefit,
    id: record.id,
    observation: record.observation,
    opportunityKey: record.opportunityKey,
    organizationId: record.organizationId,
    status: record.status,
    suggestedNextStep: record.suggestedNextStep,
    title: record.title,
    updatedAtMs: record.updatedAtMs,
  });
}
