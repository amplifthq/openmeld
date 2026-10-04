import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
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
  db: PostgresDatabase;
  opportunityKey: string;
  organizationId: string;
  recipientUserId: string;
}): Promise<OrganizationOpportunityRecord | null> {
  const row = await input.db
    .query<OpportunityRow>({
      text: `
        SELECT ${OPPORTUNITY_COLUMNS}
        FROM "openmeld"."organization_opportunities"
        WHERE organization_id = $1
          AND recipient_user_id = $2
          AND opportunity_key = $3
        LIMIT 1
      `,
      values: [
        input.organizationId,
        input.recipientUserId,
        input.opportunityKey,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapOpportunityRow(row) : null;
}
export async function readOrganizationOpportunityForRecipient(input: {
  db: PostgresDatabase;
  opportunityId: string;
  organizationId: string;
  recipientUserId: string;
}): Promise<OrganizationOpportunityRecord | null> {
  const row = await input.db
    .query<OpportunityRow>({
      text: `
        SELECT ${OPPORTUNITY_COLUMNS}
        FROM "openmeld"."organization_opportunities"
        WHERE id = $1
          AND organization_id = $2
          AND recipient_user_id = $3
        LIMIT 1
      `,
      values: [
        input.opportunityId,
        input.organizationId,
        input.recipientUserId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapOpportunityRow(row) : null;
}
export async function listOrganizationOpportunitiesForRecipient(input: {
  db: PostgresDatabase;
  limit: number;
  organizationId: string;
  recipientUserId: string;
  statuses?: readonly OpportunityStatus[];
}): Promise<OrganizationOpportunityRecord[]> {
  const statuses = input.statuses ?? [];
  const result = await input.db.query<OpportunityRow>({
    text: `
        SELECT ${OPPORTUNITY_COLUMNS}
        FROM "openmeld"."organization_opportunities"
        WHERE organization_id = $1
          AND recipient_user_id = $2
          AND ($3::text[] IS NULL OR status = ANY($3))
        ORDER BY updated_at_ms DESC NULLS LAST, id DESC NULLS LAST
        LIMIT $4
      `,
    values: [
      input.organizationId,
      input.recipientUserId,
      statuses.length ? statuses : null,
      input.limit,
    ],
  });
  return (result.rows ?? []).map(mapOpportunityRow);
}
export function prepareInsertOrganizationOpportunityStatement(input: {
  createdByProfileId: string;
  db: PostgresDatabase;
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
}): QueryConfig {
  return {
    text: `
        INSERT INTO "openmeld"."organization_opportunities" (
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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, $11, $12, $13)
      `,
    values: [
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
      input.nowMs,
    ],
  };
}
export function prepareRecordOpportunityDecisionStatement(input: {
  db: PostgresDatabase;
  decision: OpportunityDecision;
  decidedByUserId: string;
  nowMs: number;
  opportunityId: string;
  organizationId: string;
  recipientUserId: string;
}): QueryConfig {
  return {
    text: `
        UPDATE "openmeld"."organization_opportunities"
        SET
          status = $1,
          decided_by_user_id = $2,
          decided_at_ms = $3,
          updated_at_ms = GREATEST(updated_at_ms, $4)
        WHERE id = $5
          AND organization_id = $6
          AND recipient_user_id = $7
          AND status IN ('open', 'deferred')
      `,
    values: [
      input.decision,
      input.decidedByUserId,
      input.nowMs,
      input.nowMs,
      input.opportunityId,
      input.organizationId,
      input.recipientUserId,
    ],
  };
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
