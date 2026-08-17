import { organizationOpportunitySchema } from "@openmeld/schemas";
import type {
  OpportunityDecision,
  OpportunityStatus,
  OrganizationOpportunity,
} from "@openmeld/schemas/types";

type OpportunityRow = {
  created_at_ms: number;
  created_by_profile_id: string;
  decided_at_ms: number | null;
  decided_by_user_id: string | null;
  evidence_json: string;
  expected_benefit: string;
  id: string;
  observation: string;
  opportunity_key: string;
  organization_id: string;
  recipient_user_id: string;
  source_native_delivery_id: string | null;
  status: OpportunityStatus;
  suggested_next_step: string;
  title: string;
  updated_at_ms: number;
};

export type OrganizationOpportunityRecord = OrganizationOpportunity & {
  createdByProfileId: string;
  decidedByUserId: string | null;
  recipientUserId: string;
  sourceNativeDeliveryId: string | null;
};

const OPPORTUNITY_COLUMNS = `
  id,
  organization_id,
  recipient_user_id,
  opportunity_key,
  title,
  observation,
  expected_benefit,
  suggested_next_step,
  evidence_json,
  status,
  created_by_profile_id,
  source_native_delivery_id,
  decided_by_user_id,
  created_at_ms,
  decided_at_ms,
  updated_at_ms
`;

export async function readOrganizationOpportunityByKey(input: {
  db: D1Database;
  opportunityKey: string;
  organizationId: string;
  recipientUserId: string;
}): Promise<OrganizationOpportunityRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT ${OPPORTUNITY_COLUMNS}
        FROM organization_opportunities
        WHERE organization_id = ?
          AND recipient_user_id = ?
          AND opportunity_key = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.recipientUserId, input.opportunityKey)
    .first<OpportunityRow>();
  return row ? mapOpportunityRow(row) : null;
}

export async function readOrganizationOpportunityForRecipient(input: {
  db: D1Database;
  opportunityId: string;
  organizationId: string;
  recipientUserId: string;
}): Promise<OrganizationOpportunityRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT ${OPPORTUNITY_COLUMNS}
        FROM organization_opportunities
        WHERE id = ?
          AND organization_id = ?
          AND recipient_user_id = ?
        LIMIT 1
      `
    )
    .bind(input.opportunityId, input.organizationId, input.recipientUserId)
    .first<OpportunityRow>();
  return row ? mapOpportunityRow(row) : null;
}

export async function listOrganizationOpportunitiesForRecipient(input: {
  db: D1Database;
  limit: number;
  organizationId: string;
  recipientUserId: string;
  statuses?: readonly OpportunityStatus[];
}): Promise<OrganizationOpportunityRecord[]> {
  const statuses = input.statuses ?? [];
  const statusPredicate =
    statuses.length === 0
      ? ""
      : `AND status IN (${statuses.map(() => "?").join(", ")})`;
  const result = await input.db
    .prepare(
      `
        SELECT ${OPPORTUNITY_COLUMNS}
        FROM organization_opportunities
        WHERE organization_id = ?
          AND recipient_user_id = ?
          ${statusPredicate}
        ORDER BY updated_at_ms DESC, id DESC
        LIMIT ?
      `
    )
    .bind(input.organizationId, input.recipientUserId, ...statuses, input.limit)
    .all<OpportunityRow>();
  return (result.results ?? []).map(mapOpportunityRow);
}

export function prepareInsertOrganizationOpportunityStatement(input: {
  createdByProfileId: string;
  db: D1Database;
  evidence: readonly string[];
  expectedBenefit: string;
  id: string;
  nowMs: number;
  observation: string;
  opportunityKey: string;
  organizationId: string;
  recipientUserId: string;
  sourceNativeDeliveryId: string | null;
  suggestedNextStep: string;
  title: string;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        INSERT INTO organization_opportunities (
          id,
          organization_id,
          recipient_user_id,
          opportunity_key,
          title,
          observation,
          expected_benefit,
          suggested_next_step,
          evidence_json,
          status,
          created_by_profile_id,
          source_native_delivery_id,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
      `
    )
    .bind(
      input.id,
      input.organizationId,
      input.recipientUserId,
      input.opportunityKey,
      input.title,
      input.observation,
      input.expectedBenefit,
      input.suggestedNextStep,
      JSON.stringify(input.evidence),
      input.createdByProfileId,
      input.sourceNativeDeliveryId,
      input.nowMs,
      input.nowMs
    );
}

export function prepareRecordOpportunityDecisionStatement(input: {
  db: D1Database;
  decision: OpportunityDecision;
  decidedByUserId: string;
  nowMs: number;
  opportunityId: string;
  organizationId: string;
  recipientUserId: string;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        UPDATE organization_opportunities
        SET
          status = ?,
          decided_by_user_id = ?,
          decided_at_ms = ?,
          updated_at_ms = max(updated_at_ms, ?)
        WHERE id = ?
          AND organization_id = ?
          AND recipient_user_id = ?
          AND status IN ('open', 'deferred')
      `
    )
    .bind(
      input.decision,
      input.decidedByUserId,
      input.nowMs,
      input.nowMs,
      input.opportunityId,
      input.organizationId,
      input.recipientUserId
    );
}

function mapOpportunityRow(row: OpportunityRow): OrganizationOpportunityRecord {
  const opportunity = organizationOpportunitySchema.parse({
    createdAtMs: row.created_at_ms,
    decidedAtMs: row.decided_at_ms,
    evidence: JSON.parse(row.evidence_json) as unknown,
    expectedBenefit: row.expected_benefit,
    id: row.id,
    observation: row.observation,
    opportunityKey: row.opportunity_key,
    organizationId: row.organization_id,
    status: row.status,
    suggestedNextStep: row.suggested_next_step,
    title: row.title,
    updatedAtMs: row.updated_at_ms,
  });
  return {
    ...opportunity,
    createdByProfileId: row.created_by_profile_id,
    decidedByUserId: row.decided_by_user_id,
    recipientUserId: row.recipient_user_id,
    sourceNativeDeliveryId: row.source_native_delivery_id,
  };
}
