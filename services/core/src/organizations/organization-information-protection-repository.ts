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
  db: D1Database;
  organizationId: string;
}): Promise<OrganizationInformationProtectionPolicyRecord> {
  const row = await input.db
    .prepare(
      `
        SELECT
          organization_id,
          protected_information,
          updated_by_user_id,
          updated_at_ms
        FROM organization_information_protection_policies
        WHERE organization_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<OrganizationInformationProtectionPolicyRow>();
  return mapPolicyRow(input.organizationId, row);
}

export async function readOrganizationInformationProtectionPolicyForSpace(input: {
  db: D1Database;
  spaceId: string;
}): Promise<OrganizationInformationProtectionPolicyRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          spaces.organization_id AS space_organization_id,
          policies.protected_information,
          policies.updated_by_user_id,
          policies.updated_at_ms
        FROM space_index_spaces AS spaces
        LEFT JOIN organization_information_protection_policies AS policies
          ON policies.organization_id = spaces.organization_id
        WHERE spaces.space_id = ?
        LIMIT 1
      `
    )
    .bind(input.spaceId)
    .first<OrganizationInformationProtectionPolicyForSpaceRow>();
  if (!row?.space_organization_id) {
    return null;
  }
  return mapPolicyRow(row.space_organization_id, row);
}

export async function saveOrganizationInformationProtectionPolicy(input: {
  db: D1Database;
  nowMs: number;
  organizationId: string;
  protectedInformation: string | null;
  updatedByUserId: string;
}): Promise<OrganizationInformationProtectionPolicyRecord> {
  if (input.protectedInformation === null) {
    await input.db
      .prepare(
        `
          DELETE FROM organization_information_protection_policies
          WHERE organization_id = ?
        `
      )
      .bind(input.organizationId)
      .run();
    return {
      organizationId: input.organizationId,
      protectedInformation: null,
      updatedAtMs: input.nowMs,
      updatedByUserId: input.updatedByUserId,
    };
  }

  await input.db
    .prepare(
      `
        INSERT INTO organization_information_protection_policies (
          organization_id,
          protected_information,
          updated_by_user_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(organization_id) DO UPDATE SET
          protected_information = excluded.protected_information,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at_ms = excluded.updated_at_ms
      `
    )
    .bind(
      input.organizationId,
      input.protectedInformation,
      input.updatedByUserId,
      input.nowMs,
      input.nowMs
    )
    .run();
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
