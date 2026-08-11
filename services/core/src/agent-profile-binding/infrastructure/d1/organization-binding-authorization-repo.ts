export type OrganizationBindingAuthorizationRecord = {
  id: string;
  organizationId: string;
  bindingId: string;
  authorizedBy: string;
  createdAtMs: number;
};

export type OrganizationBindingAuthorizationProjection =
  OrganizationBindingAuthorizationRecord & {
    agentProfileId: string;
  };

export type OrganizationBindingAuthorizationCandidate = {
  agentProfileId: string;
  bindingId: string;
  managedRole: string | null;
  organizationId: string;
  ownerUserId: string;
};

export type OrganizationBindingAuthorizationProfile = {
  agentProfileId: string;
  authorizedAtMs: number | null;
  authorizedBy: string | null;
  bindingId: string | null;
  ownerUserId: string;
  profileHandle: string;
  profileName: string;
  profileOrganizationId: string;
};

export type OrganizationBindingAuthorizationPreferenceRecord = {
  autoAuthorizeAgentProfileBindings: boolean;
  createdAtMs: number;
  id: string;
  organizationId: string;
  updatedAtMs: number;
  userId: string;
};

export type SaveOrganizationWakeAccessChoiceResult = {
  alreadyAuthorizedCount: number;
  authorizedCount: number;
  preference: OrganizationBindingAuthorizationPreferenceRecord;
};

type OrganizationBindingAuthorizationRow = {
  id: string;
  organization_id: string;
  binding_id: string;
  authorized_by: string;
  created_at: number;
};

type OrganizationBindingAuthorizationProjectionRow =
  OrganizationBindingAuthorizationRow & {
    agent_profile_id: string;
  };
type OrganizationBindingAuthorizedAgentProfileIdRow = {
  agent_profile_id: string;
};
type OrganizationBindingAuthorizationCandidateRow = {
  agent_profile_id: string;
  binding_id: string;
  managed_role: string | null;
  organization_id: string;
  owner_user_id: string;
};
type OrganizationBindingAuthorizationProfileRow = {
  agent_profile_id: string;
  authorized_at: number | null;
  authorized_by: string | null;
  binding_id: string | null;
  owner_user_id: string;
  profile_handle: string;
  profile_name: string;
  profile_organization_id: string;
};
type OrganizationBindingAuthorizationPreferenceRow = {
  auto_authorize_agent_profile_bindings: number;
  created_at: number;
  id: string;
  organization_id: string;
  updated_at: number;
  user_id: string;
};

export async function ensureOrganizationBindingAuthorizationRecord(input: {
  authorizedBy: string;
  bindingId: string;
  db: D1Database;
  nowMs: number;
  organizationId: string;
}): Promise<{
  record: OrganizationBindingAuthorizationRecord;
  status: "authorized" | "already_authorized";
}> {
  const insertResult =
    await prepareOrganizationBindingAuthorizationInsert(input).run();

  const record = await readOrganizationBindingAuthorizationRecord({
    bindingId: input.bindingId,
    db: input.db,
    organizationId: input.organizationId,
  });
  if (!record) {
    throw new Error(
      "Organization Binding authorization write did not produce a row"
    );
  }

  return {
    record,
    status:
      getChangedRows(insertResult) > 0 ? "authorized" : "already_authorized",
  };
}

export async function readOrganizationBindingAuthorizationRecord(input: {
  bindingId: string;
  db: D1Database;
  organizationId: string;
}): Promise<OrganizationBindingAuthorizationRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          id,
          organization_id,
          binding_id,
          authorized_by,
          created_at
        FROM organization_binding_authorizations
        WHERE organization_id = ?
          AND binding_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.bindingId)
    .first<OrganizationBindingAuthorizationRow>();

  return row ? mapOrganizationBindingAuthorizationRow(row) : null;
}

export async function listOrganizationBindingAuthorizationRecords(input: {
  db: D1Database;
  organizationId: string;
}): Promise<OrganizationBindingAuthorizationProjection[]> {
  const result = await input.db
    .prepare(
      `
        SELECT
          authorizations.id,
          authorizations.organization_id,
          authorizations.binding_id,
          authorizations.authorized_by,
          authorizations.created_at,
          bindings.agent_profile_id
        FROM organization_binding_authorizations AS authorizations
        INNER JOIN openMeldDaemon_agent_profile_bindings AS bindings
          ON bindings.binding_id = authorizations.binding_id
        INNER JOIN openmeld_profiles AS profiles
          ON profiles.profile_id = bindings.agent_profile_id
          AND profiles.profile_kind = 'agent'
          AND profiles.status = 'active'
        WHERE authorizations.organization_id = ?
        ORDER BY
          authorizations.created_at DESC,
          bindings.agent_profile_id ASC,
          authorizations.binding_id ASC
      `
    )
    .bind(input.organizationId)
    .all<OrganizationBindingAuthorizationProjectionRow>();

  return (result.results ?? []).map((row) => ({
    ...mapOrganizationBindingAuthorizationRow(row),
    agentProfileId: row.agent_profile_id,
  }));
}

export async function listOrganizationBindingAuthorizedAgentProfileIds(input: {
  db: D1Database;
  organizationId: string;
}): Promise<string[]> {
  const result = await input.db
    .prepare(
      `
        SELECT DISTINCT bindings.agent_profile_id
        FROM organization_binding_authorizations AS authorizations
        INNER JOIN openMeldDaemon_agent_profile_bindings AS bindings
          ON bindings.binding_id = authorizations.binding_id
        WHERE authorizations.organization_id = ?
        ORDER BY bindings.agent_profile_id ASC
      `
    )
    .bind(input.organizationId)
    .all<OrganizationBindingAuthorizedAgentProfileIdRow>();

  return [
    ...new Set((result.results ?? []).map((row) => row.agent_profile_id)),
  ];
}

export async function listOrganizationBindingAuthorizationRecordsForBinding(input: {
  bindingId: string;
  db: D1Database;
}): Promise<OrganizationBindingAuthorizationRecord[]> {
  const result = await input.db
    .prepare(
      `
        SELECT
          id,
          organization_id,
          binding_id,
          authorized_by,
          created_at
        FROM organization_binding_authorizations
        WHERE binding_id = ?
        ORDER BY created_at ASC, organization_id ASC
      `
    )
    .bind(input.bindingId)
    .all<OrganizationBindingAuthorizationRow>();

  return (result.results ?? []).map(mapOrganizationBindingAuthorizationRow);
}

export async function listOrganizationBindingAuthorizationCandidates(input: {
  agentProfileIds?: readonly string[];
  db: D1Database;
  organizationId: string;
  userId: string;
}): Promise<OrganizationBindingAuthorizationCandidate[]> {
  const agentProfileIds = [...(input.agentProfileIds ?? [])];
  const profileFilter =
    agentProfileIds.length > 0
      ? `AND profiles.profile_id IN (${agentProfileIds.map(() => "?").join(", ")})`
      : "";
  const result = await input.db
    .prepare(
      `
        SELECT
          profiles.profile_id AS agent_profile_id,
          profiles.organization_id AS organization_id,
          profiles.owner_user_id AS owner_user_id,
          profiles.managed_role AS managed_role,
          bindings.binding_id AS binding_id
        FROM openmeld_profiles AS profiles
        INNER JOIN openMeldDaemon_agent_profile_bindings AS bindings
          ON bindings.agent_profile_id = profiles.profile_id
          AND bindings.owner_kind = 'owner_account'
          AND bindings.owner_id = profiles.owner_user_id
          AND bindings.binding_state = 'enabled_primary'
        WHERE profiles.organization_id = ?
          AND profiles.owner_user_id = ?
          AND profiles.profile_kind = 'agent'
          AND profiles.status = 'active'
          ${profileFilter}
        ORDER BY profiles.profile_id ASC
      `
    )
    .bind(input.organizationId, input.userId, ...agentProfileIds)
    .all<OrganizationBindingAuthorizationCandidateRow>();

  return (result.results ?? []).map((row) => ({
    agentProfileId: row.agent_profile_id,
    bindingId: row.binding_id,
    managedRole: row.managed_role,
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
  }));
}

export async function listOrganizationBindingAuthorizationProfiles(input: {
  authorizationOrganizationId: string;
  db: D1Database;
  profileOrganizationIds: readonly string[];
  preferredProfileOrganizationId: string;
  userId: string;
}): Promise<OrganizationBindingAuthorizationProfile[]> {
  const profileOrganizationIds = [...new Set(input.profileOrganizationIds)];
  if (profileOrganizationIds.length === 0) {
    return [];
  }

  const profileOrganizationPlaceholders = profileOrganizationIds
    .map(() => "?")
    .join(", ");
  const result = await input.db
    .prepare(
      `
        SELECT
          profiles.profile_id AS agent_profile_id,
          profiles.profile_name AS profile_name,
          profiles.profile_handle AS profile_handle,
          profiles.organization_id AS profile_organization_id,
          profiles.owner_user_id AS owner_user_id,
          bindings.binding_id AS binding_id,
          authorizations.authorized_by AS authorized_by,
          authorizations.created_at AS authorized_at
        FROM openmeld_profiles AS profiles
        LEFT JOIN openMeldDaemon_agent_profile_bindings AS bindings
          ON bindings.agent_profile_id = profiles.profile_id
          AND bindings.owner_kind = 'owner_account'
          AND bindings.owner_id = profiles.owner_user_id
          AND bindings.binding_state = 'enabled_primary'
        LEFT JOIN organization_binding_authorizations AS authorizations
          ON authorizations.organization_id = ?
          AND authorizations.binding_id = bindings.binding_id
        WHERE profiles.organization_id IN (${profileOrganizationPlaceholders})
          AND profiles.owner_user_id = ?
          AND profiles.profile_kind = 'agent'
          AND profiles.status = 'active'
        ORDER BY
          CASE
            WHEN profiles.organization_id = ? THEN 0
            ELSE 1
          END,
          lower(profiles.profile_name) ASC,
          profiles.profile_id ASC
      `
    )
    .bind(
      input.authorizationOrganizationId,
      ...profileOrganizationIds,
      input.userId,
      input.preferredProfileOrganizationId
    )
    .all<OrganizationBindingAuthorizationProfileRow>();

  return (result.results ?? []).map((row) => ({
    agentProfileId: row.agent_profile_id,
    authorizedAtMs: row.authorized_at,
    authorizedBy: row.authorized_by,
    bindingId: row.binding_id,
    ownerUserId: row.owner_user_id,
    profileHandle: row.profile_handle,
    profileName: row.profile_name,
    profileOrganizationId: row.profile_organization_id,
  }));
}

export async function readPersonalOrganizationIdForUser(input: {
  db: D1Database;
  userId: string;
}): Promise<string | null> {
  const row = await input.db
    .prepare(
      `
        SELECT organizations.id AS organization_id
        FROM organizations
        INNER JOIN members
          ON members.organization_id = organizations.id
        WHERE members.user_id = ?
          AND (
            organizations.slug LIKE 'personal-%'
            OR (
              organizations.metadata IS NOT NULL
              AND json_valid(organizations.metadata)
              AND json_extract(organizations.metadata, '$.personal') = 1
            )
          )
        ORDER BY organizations.created_at ASC, organizations.id ASC
        LIMIT 1
      `
    )
    .bind(input.userId)
    .first<{ organization_id: string }>();

  return row?.organization_id ?? null;
}

export async function readOrganizationBindingAuthorizationPreferenceRecord(input: {
  db: D1Database;
  organizationId: string;
  userId: string;
}): Promise<OrganizationBindingAuthorizationPreferenceRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          id,
          organization_id,
          user_id,
          auto_authorize_agent_profile_bindings,
          created_at,
          updated_at
        FROM organization_binding_authorization_preferences
        WHERE organization_id = ?
          AND user_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.userId)
    .first<OrganizationBindingAuthorizationPreferenceRow>();

  return row ? mapOrganizationBindingAuthorizationPreferenceRow(row) : null;
}

export async function upsertOrganizationBindingAuthorizationPreferenceRecord(input: {
  autoAuthorizeAgentProfileBindings: boolean;
  db: D1Database;
  nowMs: number;
  organizationId: string;
  userId: string;
}): Promise<OrganizationBindingAuthorizationPreferenceRecord> {
  await prepareOrganizationBindingAuthorizationPreferenceUpsert(input).run();

  const record = await readOrganizationBindingAuthorizationPreferenceRecord({
    db: input.db,
    organizationId: input.organizationId,
    userId: input.userId,
  });
  if (!record) {
    throw new Error(
      "Organization Binding authorization preference write did not produce a row"
    );
  }

  return record;
}

export async function saveOrganizationWakeAccessChoiceRecord(input: {
  authorizeExistingBindings: readonly OrganizationBindingAuthorizationCandidate[];
  autoAuthorizeAgentProfileBindings: boolean;
  db: D1Database;
  nowMs: number;
  organizationId: string;
  userId: string;
}): Promise<SaveOrganizationWakeAccessChoiceResult> {
  const authorizationStatements = input.authorizeExistingBindings.map(
    (candidate) =>
      prepareOrganizationBindingAuthorizationInsert({
        authorizedBy: input.userId,
        bindingId: candidate.bindingId,
        db: input.db,
        nowMs: input.nowMs,
        organizationId: input.organizationId,
      })
  );
  const results = await input.db.batch([
    ...authorizationStatements,
    prepareOrganizationBindingAuthorizationPreferenceUpsert({
      autoAuthorizeAgentProfileBindings:
        input.autoAuthorizeAgentProfileBindings,
      db: input.db,
      nowMs: input.nowMs,
      organizationId: input.organizationId,
      userId: input.userId,
    }),
  ]);
  const authorizedCount = results
    .slice(0, authorizationStatements.length)
    .reduce((count, result) => count + (getChangedRows(result) > 0 ? 1 : 0), 0);
  const preference = await readOrganizationBindingAuthorizationPreferenceRecord(
    {
      db: input.db,
      organizationId: input.organizationId,
      userId: input.userId,
    }
  );
  if (!preference) {
    throw new Error(
      "Organization Wake access choice write did not produce a preference row"
    );
  }

  return {
    alreadyAuthorizedCount: authorizationStatements.length - authorizedCount,
    authorizedCount,
    preference,
  };
}

export async function deleteOrganizationBindingAuthorizationRecord(input: {
  bindingId: string;
  db: D1Database;
  organizationId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        DELETE FROM organization_binding_authorizations
        WHERE organization_id = ?
          AND binding_id = ?
      `
    )
    .bind(input.organizationId, input.bindingId)
    .run();

  return getChangedRows(result) > 0;
}

function mapOrganizationBindingAuthorizationRow(
  row: OrganizationBindingAuthorizationRow
): OrganizationBindingAuthorizationRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    bindingId: row.binding_id,
    authorizedBy: row.authorized_by,
    createdAtMs: row.created_at,
  };
}

function prepareOrganizationBindingAuthorizationInsert(input: {
  authorizedBy: string;
  bindingId: string;
  db: D1Database;
  nowMs: number;
  organizationId: string;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        INSERT INTO organization_binding_authorizations (
          id,
          organization_id,
          binding_id,
          authorized_by,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, binding_id) DO NOTHING
      `
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.bindingId,
      input.authorizedBy,
      input.nowMs
    );
}

function prepareOrganizationBindingAuthorizationPreferenceUpsert(input: {
  autoAuthorizeAgentProfileBindings: boolean;
  db: D1Database;
  nowMs: number;
  organizationId: string;
  userId: string;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        INSERT INTO organization_binding_authorization_preferences (
          id,
          organization_id,
          user_id,
          auto_authorize_agent_profile_bindings,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, user_id) DO UPDATE SET
          auto_authorize_agent_profile_bindings = excluded.auto_authorize_agent_profile_bindings,
          updated_at = excluded.updated_at
      `
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.userId,
      input.autoAuthorizeAgentProfileBindings ? 1 : 0,
      input.nowMs,
      input.nowMs
    );
}

function mapOrganizationBindingAuthorizationPreferenceRow(
  row: OrganizationBindingAuthorizationPreferenceRow
): OrganizationBindingAuthorizationPreferenceRecord {
  return {
    autoAuthorizeAgentProfileBindings:
      row.auto_authorize_agent_profile_bindings === 1,
    createdAtMs: row.created_at,
    id: row.id,
    organizationId: row.organization_id,
    updatedAtMs: row.updated_at,
    userId: row.user_id,
  };
}

function getChangedRows(result: D1Result): number {
  const meta = result.meta as { changes?: unknown; rows_written?: unknown };
  if (typeof meta.changes === "number") {
    return meta.changes;
  }
  if (typeof meta.rows_written === "number") {
    return meta.rows_written;
  }
  return 0;
}
