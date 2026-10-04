import type { PostgresDatabase } from "@openmeld/db/postgresql";
export type OrganizationInformationProtectionPolicyRecord = {
  organizationId: string;
  protectedInformation: string | null;
  updatedAtMs: number | null;
  updatedByUserId: string | null;
};
type OrganizationInformationProtectionPolicyRow = {
  organization_id: string;
  protected_information: string;
  updated_at_ms: number;
  updated_by_user_id: string | null;
};
type OrganizationInformationProtectionPolicyForSpaceRow = {
  protected_information: string | null;
  space_organization_id: string;
  updated_at_ms: number | null;
  updated_by_user_id: string | null;
};
export async function readOrganizationInformationProtectionPolicy(input: {
  db: PostgresDatabase;
  organizationId: string;
}): Promise<OrganizationInformationProtectionPolicyRecord> {
  const row = await input.db
    .query<OrganizationInformationProtectionPolicyRow>({
      text: `
        SELECT
          organization_id,
          protected_information,
          updated_by_user_id,
          updated_at_ms
        FROM "openmeld"."organization_information_protection_policies"
        WHERE organization_id = $1
        LIMIT 1
      `,
      values: [input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  return mapPolicyRow(input.organizationId, row);
}
export async function readOrganizationInformationProtectionPolicyForSpace(input: {
  db: PostgresDatabase;
  spaceId: string;
}): Promise<OrganizationInformationProtectionPolicyRecord | null> {
  const row = await input.db
    .query<OrganizationInformationProtectionPolicyForSpaceRow>({
      text: `
        SELECT
          spaces.organization_id AS space_organization_id,
          policies.protected_information,
          policies.updated_by_user_id,
          policies.updated_at_ms
        FROM "openmeld"."space_index_spaces" AS spaces
        LEFT JOIN "openmeld"."organization_information_protection_policies" AS policies
          ON policies.organization_id = spaces.organization_id
        WHERE spaces.space_id = $1
        LIMIT 1
      `,
      values: [input.spaceId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row?.space_organization_id) {
    return null;
  }
  return mapPolicyRow(row.space_organization_id, row);
}
export async function saveOrganizationInformationProtectionPolicy(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  protectedInformation: string | null;
  updatedByUserId: string;
}): Promise<OrganizationInformationProtectionPolicyRecord> {
  if (input.protectedInformation === null) {
    await input.db.query({
      text: `
          DELETE FROM "openmeld"."organization_information_protection_policies"
          WHERE organization_id = $1
        `,
      values: [input.organizationId],
    });
    return {
      organizationId: input.organizationId,
      protectedInformation: null,
      updatedAtMs: input.nowMs,
      updatedByUserId: input.updatedByUserId,
    };
  }
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."organization_information_protection_policies" (
          organization_id,
          protected_information,
          updated_by_user_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(organization_id) DO UPDATE SET
          protected_information = excluded.protected_information,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at_ms = excluded.updated_at_ms
      `,
    values: [
      input.organizationId,
      input.protectedInformation,
      input.updatedByUserId,
      input.nowMs,
      input.nowMs,
    ],
  });
  return {
    organizationId: input.organizationId,
    protectedInformation: input.protectedInformation,
    updatedAtMs: input.nowMs,
    updatedByUserId: input.updatedByUserId,
  };
}
function mapPolicyRow(
  organizationId: string,
  row: {
    protected_information: string | null;
    updated_at_ms: number | null;
    updated_by_user_id: string | null;
  } | null
): OrganizationInformationProtectionPolicyRecord {
  return {
    organizationId,
    protectedInformation: row?.protected_information ?? null,
    updatedAtMs: row?.updated_at_ms ?? null,
    updatedByUserId: row?.updated_by_user_id ?? null,
  };
}
