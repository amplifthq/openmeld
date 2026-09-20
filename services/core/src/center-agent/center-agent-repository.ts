import type {
  CenterAgentAction,
  CenterAgentAttribution,
  CenterAgentDesignation,
  CenterAgentOperatingState,
  ResolvedSpaceMemberProfile,
} from "@openmeld/schemas/types";
import { isAgentProfileEligibleForOrganization } from "./center-agent-organization-scope";

type CenterAgentDesignationRow = {
  organization_id: string;
  agent_profile_id: string;
  duty: string | null;
  designated_by: string | null;
  operating_state: CenterAgentOperatingState;
  paused_at: number | null;
  paused_by_user_id: string | null;
  created_at: number;
};

type CenterAgentAuditJournalRow = {
  id: string;
  organization_id: string;
  actor_profile_id: string;
  action: CenterAgentAction;
  on_behalf_of_profile_id: string | null;
  on_behalf_of_user_id: string | null;
  on_behalf_of_display_name: string | null;
  resource_type: string | null;
  resource_id: string | null;
  source_native_delivery_id: string | null;
  source_space_id: string | null;
  local_agent_client: string | null;
  context_manifest_estimated_token_count: number | null;
  context_manifest_included_message_count: number | null;
  context_manifest_truncated: number | boolean | null;
  context_load_estimated_token_count: number | null;
  context_load_included_message_count: number | null;
  context_load_manifest_id: string | null;
  created_at: number;
};

type CenterAgentAttributionProfileRow = {
  profile_id: string;
  profile_kind: "agent" | "human" | "system";
  profile_name: string;
  profile_status: "active" | "disabled";
  organization_id: string | null;
  managed_role: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  member_user_id: string | null;
  is_default: number | boolean;
};

export type CenterAgentDesignationRecord = {
  organizationId: string;
  agentProfileId: string;
  duty: null;
  designatedBy: string | null;
  operatingState: CenterAgentOperatingState;
  pausedAtMs: number | null;
  pausedByUserId: string | null;
  createdAtMs: number;
};

export type CenterAgentAuditJournalEntryRecord = {
  id: string;
  organizationId: string;
  actorProfileId: string;
  action: CenterAgentAction;
  onBehalfOfProfileId: string | null;
  onBehalfOfUserId: string | null;
  onBehalfOfDisplayName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  sourceNativeDeliveryId: string | null;
  sourceSpaceId: string | null;
  localAgentClient: string | null;
  contextManifestEstimatedTokenCount: number | null;
  contextManifestIncludedMessageCount: number | null;
  contextManifestTruncated: boolean | null;
  contextLoadEstimatedTokenCount: number | null;
  contextLoadIncludedMessageCount: number | null;
  contextLoadManifestId: string | null;
  createdAtMs: number;
};

export type ResolvedCenterAgentAttribution = CenterAgentAttribution;

export type CenterAgentProfileIdentity = {
  profileHandle: string;
  profileName: string;
};

type CenterAgentProfileIdentityRow = {
  profile_handle: string;
  profile_name: string;
};

export async function readCenterAgentProfileIdentity(input: {
  agentProfileId: string;
  db: D1Database;
}): Promise<CenterAgentProfileIdentity | null> {
  const row = await input.db
    .prepare(
      `
        SELECT profile_name, profile_handle
        FROM openmeld_profiles
        WHERE profile_id = ?
        LIMIT 1
      `
    )
    .bind(input.agentProfileId)
    .first<CenterAgentProfileIdentityRow>();

  if (!row) {
    return null;
  }

  return {
    profileHandle: row.profile_handle,
    profileName: row.profile_name,
  };
}

export async function readCenterAgentDesignationRecord(input: {
  db: D1Database;
  organizationId: string;
}): Promise<CenterAgentDesignationRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          organization_id,
          agent_profile_id,
          duty,
          designated_by,
          operating_state,
          paused_at,
          paused_by_user_id,
          created_at
        FROM center_agent_designations
        WHERE organization_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<CenterAgentDesignationRow>();

  return row ? mapDesignationRow(row) : null;
}

export async function upsertCenterAgentDesignationRecord(input: {
  agentProfileId: string;
  db: D1Database;
  designatedBy: string;
  nowMs: number;
  organizationId: string;
}): Promise<{
  designation: CenterAgentDesignationRecord;
  previousAgentProfileId: string | null;
  status: "designated" | "replaced" | "unchanged";
}> {
  const previous = await readCenterAgentDesignationRecord(input);
  await input.db
    .prepare(
      `
        INSERT INTO center_agent_designations (
          organization_id,
          agent_profile_id,
          duty,
          designated_by,
          created_at
        )
        VALUES (?, ?, NULL, ?, ?)
        ON CONFLICT(organization_id) DO UPDATE SET
          agent_profile_id = excluded.agent_profile_id,
          duty = NULL,
          designated_by = excluded.designated_by,
          created_at = excluded.created_at
      `
    )
    .bind(
      input.organizationId,
      input.agentProfileId,
      input.designatedBy,
      input.nowMs
    )
    .run();

  const designation = await readCenterAgentDesignationRecord(input);
  if (!designation) {
    throw new Error("Center Agent designation write did not produce a row");
  }
  let status: "designated" | "replaced" | "unchanged" = "designated";
  if (previous) {
    status =
      previous.agentProfileId === input.agentProfileId
        ? "unchanged"
        : "replaced";
  }

  return {
    designation,
    previousAgentProfileId: previous?.agentProfileId ?? null,
    status,
  };
}

export async function updateCenterAgentOperatingStateRecord(input: {
  db: D1Database;
  operatingState: CenterAgentOperatingState;
  organizationId: string;
  updatedByUserId: string;
  nowMs: number;
}): Promise<{
  changed: boolean;
  designation: CenterAgentDesignationRecord | null;
}> {
  const previous = await readCenterAgentDesignationRecord(input);
  if (!previous) {
    return {
      changed: false,
      designation: null,
    };
  }
  if (previous.operatingState === input.operatingState) {
    return { changed: false, designation: previous };
  }

  await input.db
    .prepare(
      `
        UPDATE center_agent_designations
        SET
          operating_state = ?,
          paused_at = ?,
          paused_by_user_id = ?
        WHERE organization_id = ?
      `
    )
    .bind(
      input.operatingState,
      input.operatingState === "paused" ? input.nowMs : null,
      input.operatingState === "paused" ? input.updatedByUserId : null,
      input.organizationId
    )
    .run();

  const designation = await readCenterAgentDesignationRecord(input);
  if (!designation || designation.operatingState !== input.operatingState) {
    throw new Error("Center Agent operating state write did not produce a row");
  }
  return {
    changed: true,
    designation,
  };
}

export function isCenterAgentDesignationActive(
  designation: CenterAgentDesignationRecord | null
): designation is CenterAgentDesignationRecord & { operatingState: "active" } {
  return designation?.operatingState === "active";
}

type CenterAgentAuditJournalEntryInput = {
  action: CenterAgentAction;
  actorProfileId: string;
  attribution: ResolvedCenterAgentAttribution;
  db: D1Database;
  id: string;
  nowMs: number;
  organizationId: string;
  resource?: { id: string; type: string } | null;
  sourceNativeDeliveryId?: string | null;
  sourceSpaceId?: string | null;
};

export function prepareCenterAgentAuditJournalEntryStatement(
  input: CenterAgentAuditJournalEntryInput
): D1PreparedStatement {
  return prepareCenterAgentAuditJournalEntryStatementWithConflictPolicy({
    ...input,
    ignoreConflict: false,
  });
}

export function prepareCenterAgentAuditJournalEntryIfMissingStatement(
  input: CenterAgentAuditJournalEntryInput
): D1PreparedStatement {
  return prepareCenterAgentAuditJournalEntryStatementWithConflictPolicy({
    ...input,
    ignoreConflict: true,
  });
}

function prepareCenterAgentAuditJournalEntryStatementWithConflictPolicy(
  input: CenterAgentAuditJournalEntryInput & { ignoreConflict: boolean }
): D1PreparedStatement {
  const onBehalfOf = input.attribution.onBehalfOf;
  return input.db
    .prepare(
      `
        INSERT ${input.ignoreConflict ? "OR IGNORE " : ""}INTO center_agent_audit_journal (
          id,
          organization_id,
          actor_profile_id,
          action,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          resource_type,
          resource_id,
          source_native_delivery_id,
          source_space_id,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      input.id,
      input.organizationId,
      input.actorProfileId,
      input.action,
      onBehalfOf?.profileId ?? null,
      onBehalfOf?.userId ?? null,
      onBehalfOf?.displayName ?? null,
      input.resource?.type ?? null,
      input.resource?.id ?? null,
      input.sourceNativeDeliveryId ?? null,
      input.sourceSpaceId ?? null,
      input.nowMs
    );
}

export async function insertCenterAgentAuditJournalEntry(
  input: CenterAgentAuditJournalEntryInput
): Promise<CenterAgentAuditJournalEntryRecord> {
  const onBehalfOf = input.attribution.onBehalfOf;
  await prepareCenterAgentAuditJournalEntryStatement(input).run();

  return {
    id: input.id,
    organizationId: input.organizationId,
    actorProfileId: input.actorProfileId,
    action: input.action,
    onBehalfOfProfileId: onBehalfOf?.profileId ?? null,
    onBehalfOfUserId: onBehalfOf?.userId ?? null,
    onBehalfOfDisplayName: onBehalfOf?.displayName ?? null,
    resourceType: input.resource?.type ?? null,
    resourceId: input.resource?.id ?? null,
    sourceNativeDeliveryId: input.sourceNativeDeliveryId ?? null,
    sourceSpaceId: input.sourceSpaceId ?? null,
    localAgentClient: null,
    contextManifestEstimatedTokenCount: null,
    contextManifestIncludedMessageCount: null,
    contextManifestTruncated: null,
    contextLoadEstimatedTokenCount: null,
    contextLoadIncludedMessageCount: null,
    contextLoadManifestId: null,
    createdAtMs: input.nowMs,
  };
}

export async function insertCenterAgentAuditJournalEntryIfMissing(
  input: CenterAgentAuditJournalEntryInput
): Promise<void> {
  await prepareCenterAgentAuditJournalEntryIfMissingStatement(input).run();
}

export async function listCenterAgentAuditJournalEntries(input: {
  db: D1Database;
  excludedActions?: readonly CenterAgentAction[];
  limit: number;
  organizationId: string;
}): Promise<CenterAgentAuditJournalEntryRecord[]> {
  const excludedActionPlaceholders = input.excludedActions
    ?.map(() => "?")
    .join(", ");
  const statement = input.db.prepare(
    `
        SELECT
          journal.id,
          journal.organization_id,
          journal.actor_profile_id,
          journal.action,
          journal.on_behalf_of_profile_id,
          journal.on_behalf_of_user_id,
          journal.on_behalf_of_display_name,
          journal.resource_type,
          journal.resource_id,
          journal.source_native_delivery_id,
          journal.source_space_id,
          journal.created_at,
          COALESCE(
            load_receipt.client_name,
            manifest.client_name,
            CASE
              WHEN journal.action = 'receive_local_agent_request'
                AND journal.resource_type = 'local_agent_client'
              THEN journal.resource_id
              ELSE (
                SELECT source_request.resource_id
                FROM center_agent_audit_journal AS source_request
                WHERE source_request.organization_id = journal.organization_id
                  AND journal.source_native_delivery_id IS NOT NULL
                  AND source_request.source_native_delivery_id = journal.source_native_delivery_id
                  AND source_request.action = 'receive_local_agent_request'
                  AND source_request.resource_type = 'local_agent_client'
                ORDER BY source_request.created_at ASC, source_request.id ASC
                LIMIT 1
              )
            END
          ) AS local_agent_client,
          manifest.estimated_token_count AS context_manifest_estimated_token_count,
          manifest.included_message_count AS context_manifest_included_message_count,
          manifest.truncated AS context_manifest_truncated,
          load_receipt.estimated_token_count AS context_load_estimated_token_count,
          load_receipt.included_message_count AS context_load_included_message_count,
          load_receipt.manifest_id AS context_load_manifest_id
        FROM center_agent_audit_journal AS journal
        LEFT JOIN center_agent_context_manifests AS manifest
          ON manifest.audit_entry_id = journal.id
        LEFT JOIN center_agent_context_load_receipts AS load_receipt
          ON load_receipt.audit_entry_id = journal.id
        WHERE journal.organization_id = ?
          ${excludedActionPlaceholders ? `AND journal.action NOT IN (${excludedActionPlaceholders})` : ""}
        ORDER BY journal.created_at DESC, journal.id DESC
        LIMIT ?
      `
  );
  const result = await statement
    .bind(input.organizationId, ...(input.excludedActions ?? []), input.limit)
    .all<CenterAgentAuditJournalRow>();

  return (result.results ?? []).map(mapAuditJournalRow);
}

export async function resolveCenterAgentAttribution(input: {
  actorProfileId: string;
  db: D1Database;
  onBehalfOfProfileId?: string | null;
  organizationId: string;
}): Promise<ResolvedCenterAgentAttribution> {
  if (!input.onBehalfOfProfileId) {
    return {
      actorProfileId: input.actorProfileId,
      onBehalfOf: null,
    };
  }

  const profile = await readOrganizationScopedAttributionProfile({
    db: input.db,
    organizationId: input.organizationId,
    profileId: input.onBehalfOfProfileId,
  });
  if (!profile?.ownerUserId) {
    throw new Error("onBehalfOf profile is not part of this Organization");
  }

  return {
    actorProfileId: input.actorProfileId,
    onBehalfOf: {
      profileId: profile.profileId,
      userId: profile.ownerUserId,
      displayName: profile.displayName,
    },
  };
}

export async function readResolvedOrganizationSpaceMember(input: {
  db: D1Database;
  organizationId: string;
  profileId: string;
}): Promise<ResolvedSpaceMemberProfile | null> {
  const profile = await readOrganizationScopedAttributionProfile({
    db: input.db,
    organizationId: input.organizationId,
    profileId: input.profileId,
  });
  if (!(profile && profile.profileKind !== "system")) {
    return null;
  }
  return {
    profileId: profile.profileId,
    profileName: profile.displayName,
    profileKind: profile.profileKind,
    ownerUserId: profile.ownerUserId,
    ownerName: profile.ownerName,
    agentControllerRef: null,
  };
}

export async function readResolvedOrganizationDirectorySpaceMember(input: {
  db: D1Database;
  organizationId: string;
  profileId: string;
}): Promise<ResolvedSpaceMemberProfile | null> {
  const profile = await readOrganizationScopedAttributionProfile({
    db: input.db,
    organizationId: input.organizationId,
    profileId: input.profileId,
    requireDefaultHumanProfile: true,
  });
  if (!(profile && profile.profileKind !== "system")) {
    return null;
  }
  return {
    profileId: profile.profileId,
    profileName: profile.displayName,
    profileKind: profile.profileKind,
    ownerUserId: profile.ownerUserId,
    ownerName: profile.ownerName,
    agentControllerRef: null,
  };
}

export async function readResolvedOrganizationOwnerHumanSpaceMember(input: {
  db: D1Database;
  organizationId: string;
  ownerUserId: string;
}): Promise<ResolvedSpaceMemberProfile | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          profiles.profile_id,
          profiles.profile_name,
          profiles.status AS profile_status,
          profiles.owner_user_id,
          users.name AS owner_name,
          members.user_id AS member_user_id
        FROM openmeld_profiles AS profiles
        LEFT JOIN users
          ON users.id = profiles.owner_user_id
        LEFT JOIN members
          ON members.user_id = profiles.owner_user_id
          AND members.organization_id = ?
        WHERE profiles.owner_user_id = ?
          AND profiles.profile_kind = 'human'
          AND profiles.is_default = 1
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.ownerUserId)
    .first<{
      member_user_id: string | null;
      owner_name: string | null;
      owner_user_id: string;
      profile_id: string;
      profile_name: string;
      profile_status: string;
    }>();
  if (!(row && row.profile_status === "active" && row.member_user_id)) {
    return null;
  }
  return {
    agentControllerRef: null,
    ownerName: normalizeNullableText(row.owner_name),
    ownerUserId: row.owner_user_id,
    profileId: row.profile_id,
    profileKind: "human",
    profileName: row.profile_name,
  };
}

async function readOrganizationScopedAttributionProfile(input: {
  db: D1Database;
  organizationId: string;
  profileId: string;
  requireDefaultHumanProfile?: boolean;
}): Promise<{
  displayName: string;
  ownerName: string | null;
  ownerUserId: string | null;
  profileId: string;
  profileKind: "agent" | "human" | "system";
} | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          profiles.profile_id,
          profiles.profile_kind,
          profiles.profile_name,
          profiles.is_default,
          profiles.status AS profile_status,
          profiles.organization_id,
          profiles.managed_role,
          profiles.owner_user_id,
          users.name AS owner_name,
          members.user_id AS member_user_id
        FROM openmeld_profiles AS profiles
        LEFT JOIN users
          ON users.id = profiles.owner_user_id
        LEFT JOIN members
          ON members.user_id = profiles.owner_user_id
          AND members.organization_id = ?
        WHERE profiles.profile_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.profileId)
    .first<CenterAgentAttributionProfileRow>();

  if (row?.profile_status !== "active") {
    return null;
  }
  const profileKind = row.profile_kind;
  if (
    profileKind === "agent" &&
    !isAgentProfileEligibleForOrganization({
      managedRole: normalizeNullableText(row.managed_role),
      profileOrganizationId: normalizeNullableText(row.organization_id),
      targetOrganizationId: input.organizationId,
    })
  ) {
    return null;
  }
  if (profileKind === "human" && row.member_user_id === null) {
    return null;
  }
  const isDefault = row.is_default === true || row.is_default === 1;
  if (
    profileKind === "human" &&
    input.requireDefaultHumanProfile === true &&
    !isDefault
  ) {
    return null;
  }
  if (profileKind === "system") {
    return null;
  }

  return {
    displayName: row.profile_name,
    ownerName: normalizeNullableText(row.owner_name),
    ownerUserId: row.owner_user_id,
    profileId: row.profile_id,
    profileKind,
  };
}

export function toCenterAgentDesignationDto(
  record: CenterAgentDesignationRecord
): CenterAgentDesignation {
  return {
    organizationId: record.organizationId,
    agentProfileId: record.agentProfileId,
    duty: null,
    designatedBy: record.designatedBy,
    createdAt: toIsoDateTime(record.createdAtMs),
  };
}

export function toCenterAgentAuditJournalEntryDto(
  record: CenterAgentAuditJournalEntryRecord,
  input: {
    includeContextDetails?: boolean;
    includeInteractionSource?: boolean;
    includeSourceSpaceId?: boolean;
  } = {}
) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    actorProfileId: record.actorProfileId,
    action: record.action,
    onBehalfOf: record.onBehalfOfProfileId
      ? {
          profileId: record.onBehalfOfProfileId,
          userId: record.onBehalfOfUserId,
          displayName:
            record.onBehalfOfDisplayName ?? record.onBehalfOfProfileId,
        }
      : null,
    ...(input.includeInteractionSource && record.localAgentClient
      ? {
          interactionSource: {
            client: record.localAgentClient,
            kind: "local_agent" as const,
          },
        }
      : {}),
    ...(input.includeContextDetails &&
    record.contextManifestEstimatedTokenCount !== null &&
    record.contextManifestIncludedMessageCount !== null &&
    record.contextManifestTruncated !== null
      ? {
          contextManifest: {
            estimatedTokens: record.contextManifestEstimatedTokenCount,
            includedMessages: record.contextManifestIncludedMessageCount,
            truncated: record.contextManifestTruncated,
          },
        }
      : {}),
    ...(input.includeContextDetails &&
    record.contextLoadEstimatedTokenCount !== null &&
    record.contextLoadIncludedMessageCount !== null &&
    record.contextLoadManifestId
      ? {
          contextLoad: {
            estimatedTokens: record.contextLoadEstimatedTokenCount,
            includedMessages: record.contextLoadIncludedMessageCount,
            manifestId: record.contextLoadManifestId,
          },
        }
      : {}),
    resource:
      record.resourceType && record.resourceId
        ? {
            type: record.resourceType,
            id: record.resourceId,
          }
        : null,
    ...(input.includeSourceSpaceId
      ? { sourceSpaceId: record.sourceSpaceId }
      : {}),
    createdAt: toIsoDateTime(record.createdAtMs),
  };
}

function mapDesignationRow(
  row: CenterAgentDesignationRow
): CenterAgentDesignationRecord {
  if (row.duty !== null) {
    throw new Error("Center Agent designation duty must be null in MVP");
  }
  return {
    organizationId: row.organization_id,
    agentProfileId: row.agent_profile_id,
    duty: null,
    designatedBy: row.designated_by,
    operatingState: row.operating_state,
    pausedAtMs: row.paused_at,
    pausedByUserId: row.paused_by_user_id,
    createdAtMs: row.created_at,
  };
}

function mapAuditJournalRow(
  row: CenterAgentAuditJournalRow
): CenterAgentAuditJournalEntryRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    actorProfileId: row.actor_profile_id,
    action: row.action,
    onBehalfOfProfileId: row.on_behalf_of_profile_id,
    onBehalfOfUserId: row.on_behalf_of_user_id,
    onBehalfOfDisplayName: row.on_behalf_of_display_name,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    sourceNativeDeliveryId: row.source_native_delivery_id,
    sourceSpaceId: row.source_space_id,
    localAgentClient: row.local_agent_client,
    contextManifestEstimatedTokenCount:
      row.context_manifest_estimated_token_count,
    contextManifestIncludedMessageCount:
      row.context_manifest_included_message_count,
    contextManifestTruncated:
      row.context_manifest_truncated === null
        ? null
        : Boolean(row.context_manifest_truncated),
    contextLoadEstimatedTokenCount: row.context_load_estimated_token_count,
    contextLoadIncludedMessageCount: row.context_load_included_message_count,
    contextLoadManifestId: row.context_load_manifest_id,
    createdAtMs: row.created_at,
  };
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toIsoDateTime(value: number): string {
  return new Date(value).toISOString();
}
