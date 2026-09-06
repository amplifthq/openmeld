import { isCenterAgentDirectMessageSpaceProjection } from "@openmeld/schemas";
import type {
  AccountSpaceIndexDeletedItem,
  AccountSpaceIndexItem,
  AccountSpaceIndexJoinedProfile,
  AccountSpaceIndexQuery,
  AccountSpaceIndexResponse,
  CenterAgentRoutineTargetSpace,
  OrganizationSpaceDirectoryWithMemberCountsResponse,
  ProfileSpaceCreatorKind,
  SpaceOrganizationVisibility,
} from "@openmeld/schemas/types";
import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";

const LEGACY_WELCOMING_SPACE_PURPOSE = "openmeld_welcoming_space";

export type SpaceIndexSpaceProjection = {
  spaceId: string;
  status: "active" | "deleted";
  organizationId: string;
  visibility: SpaceOrganizationVisibility;
  spaceName?: string | null;
  spacePurpose?: string | null;
  directMessagePairKey?: string | null;
  directMessageConvertedAt?: string | null;
  activeMemberCount?: number | null;
  activeHumanCount?: number | null;
  activeAgentCount?: number | null;
  creatorProfileId?: string | null;
  creatorKind?: ProfileSpaceCreatorKind | null;
  creatorOwnerUserId?: string | null;
  creatorProfileName?: string | null;
  spaceCreatedAt?: string | null;
  spaceUpdatedAt?: string | null;
  deletedAt?: string | null;
  deletedByProfileId?: string | null;
  deletedByOwnerUserId?: string | null;
  deletedByProfileName?: string | null;
  sourceUpdatedAt: string;
  projectionEventId: string;
};

export type SpaceIndexMembershipProjection = {
  spaceId: string;
  profileId: string;
  profileKindSnapshot: "human" | "agent";
  profileNameSnapshot: string;
  ownerUserIdSnapshot?: string | null;
  ownerNameSnapshot?: string | null;
  controllerRefSnapshot?: string | null;
  status: "active" | "removed";
  memberSource: string;
  addedAt: string;
  removedAt?: string | null;
  addedByProfileId?: string | null;
  addedByOwnerUserId?: string | null;
  addedByDisplayNameSnapshot?: string | null;
  removedByProfileId?: string | null;
  removedByOwnerUserId?: string | null;
  removalReason?: string | null;
  firstEnteredAt?: string | null;
  lastEnteredAt?: string | null;
  sourceUpdatedAt: string;
  projectionEventId: string;
};

export type SpaceIndexProjectionEvent = {
  projectionEventId: string;
  spaceId: string;
  eventType: string;
  sourceUpdatedAt: string;
  payload: unknown;
};

export type SpaceIndexOrganizationJoinTarget = {
  creatorProfileId: string | null;
  creatorProfileName: string | null;
  organizationId: string;
  spaceId: string;
  spaceName: string | null;
  visibility: SpaceOrganizationVisibility;
};

export type ListAccountSpacesFromSpaceIndexInput = {
  db: D1Database;
  gatewayHost: string;
  ownerUserId: string;
  scope: AccountSpaceIndexQuery["scope"];
  selectedProfileId: string;
  limit: number;
  includeDirectMessageProfileIds?: boolean;
  includeRecentlyDeletedItems?: boolean;
  includePurposes?: boolean;
  includeMemberPreviews?: boolean;
};

export type SpaceIndexProjectionDriftIssueCode =
  | "space_index_space_missing_completed_event"
  | "space_index_membership_missing_completed_event"
  | "space_index_space_behind_completed_event"
  | "space_index_projection_event_membership_count_mismatch";

export type SpaceIndexProjectionDriftIssue = {
  code: SpaceIndexProjectionDriftIssueCode;
  message: string;
  projectionEventId?: string;
  profileId?: string;
  spaceId: string;
};

export type SpaceIndexProjectionDriftDiagnostic = {
  issues: SpaceIndexProjectionDriftIssue[];
  ok: boolean;
  spaceId: string;
};

type SpaceIndexJoinedRow = {
  center_agent_profile_id: string | null;
  direct_message_pair_key: string | null;
  direct_message_converted_at_ms: number | null;
  space_id: string;
  organization_id: string;
  organization_visibility: SpaceOrganizationVisibility;
  space_name: string | null;
  space_purpose: string | null;
  active_member_count: number | null;
  active_human_count: number | null;
  active_agent_count: number | null;
  creator_profile_id: string | null;
  creator_kind: ProfileSpaceCreatorKind | null;
  creator_owner_user_id: string | null;
  creator_profile_name: string | null;
  space_created_at_ms: number | null;
  space_updated_at_ms: number | null;
  membership_profile_id: string;
  profile_kind_snapshot: "human" | "agent";
  profile_name_snapshot: string;
  owner_user_id_snapshot: string | null;
  added_at_ms: number;
  last_entered_at_ms: number | null;
  overlay_last_joined_at_ms: number | null;
  overlay_last_seen_ts: number | null;
  overlay_pinned_at_ms: number | null;
  overlay_updated_at_ms: number | null;
  source_updated_at_ms: number;
  projected_at_ms: number;
};

type AccountSpaceIndexItemDraft = AccountSpaceIndexItem & {
  directMessagePairKey: string | null;
  openProfileRankMs: number;
  spaceNameSnapshot: string | null;
};

type OrganizationSpaceDirectoryRow = {
  active_member_count: number | null;
  center_agent_profile_id: string | null;
  direct_message_pair_key: string | null;
  space_id: string;
  organization_id: string;
  organization_visibility: SpaceOrganizationVisibility;
  space_name: string | null;
  space_purpose: string | null;
  space_created_at_ms: number | null;
  space_updated_at_ms: number | null;
  source_updated_at_ms: number;
  latest_joined_at_ms: number | null;
};

type SpaceIndexNameRow = {
  space_id: string;
  space_name: string | null;
};

type RoutineTargetSpaceRow = {
  center_agent_can_publish: number | boolean;
  is_active: number | boolean;
  is_eligible: number | boolean;
  organization_id: string;
  same_organization: number | boolean;
  represented_human_visible: number | boolean;
  space_id: string;
  space_name: string | null;
  space_purpose: string | null;
  target_shape_allowed: number | boolean;
};

export type RoutineTargetSpaceEligibilityProjection = {
  active: boolean;
  centerAgentCanPublish: boolean;
  eligible: boolean;
  organizationId: string;
  representedHumanVisible: boolean;
  sameOrganization: boolean;
  shapeAllowed: boolean;
  spaceId: string;
};

type RoutineTargetSpaceEligibilityQueryInput = {
  centerAgentDirectMessagePairKey: string | null;
  centerAgentProfileId: string | null;
  db: D1Database;
  organizationId: string;
  representedHumanProfileId: string;
  representedHumanUserId: string;
} & (
  | { limit: number; scope: "list" }
  | { scope: "target"; targetSpaceId: string }
);

export type SpaceIndexCenterAgentDirectMessageProjectionCandidate = {
  directMessagePairKey: string | null;
  organizationId: string;
  spaceId: string;
  spacePurpose: string | null;
};

type SpaceIndexCenterAgentDirectMessageProjectionCandidateRow = {
  direct_message_pair_key: string | null;
  organization_id: string;
  space_id: string;
  space_purpose: string | null;
};

type SpaceIndexOrganizationJoinTargetRow = {
  creator_profile_id: string | null;
  creator_profile_name: string | null;
  organization_id: string;
  organization_visibility: SpaceOrganizationVisibility;
  space_id: string;
  space_name: string | null;
};

export type SpaceIndexDirectMessageCandidate = {
  activeAgentCount: number | null;
  activeHumanCount: number | null;
  activeMemberCount: number | null;
  organizationId: string;
  spaceId: string;
  visibility: SpaceOrganizationVisibility;
};

type SpaceIndexDirectMessageCandidateRow = {
  active_agent_count: number | null;
  active_human_count: number | null;
  active_member_count: number | null;
  organization_id: string;
  organization_visibility: SpaceOrganizationVisibility;
  space_id: string;
};

export async function writeSpaceIndexProjectionEvent(input: {
  db: D1Database;
  event: SpaceIndexProjectionEvent;
}): Promise<void> {
  await input.db
    .prepare(
      `
        INSERT INTO space_index_projection_events (
          projection_event_id,
          space_id,
          event_type,
          source_updated_at_ms,
          projected_at_ms,
          payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(projection_event_id) DO NOTHING
      `
    )
    .bind(
      input.event.projectionEventId,
      input.event.spaceId,
      input.event.eventType,
      parseIsoTimestampMs(input.event.sourceUpdatedAt, "sourceUpdatedAt"),
      Date.now(),
      JSON.stringify(input.event.payload)
    )
    .run();
}

export async function upsertSpaceIndexSpace(input: {
  db: D1Database;
  space: SpaceIndexSpaceProjection;
}): Promise<void> {
  const sourceUpdatedAtMs = parseIsoTimestampMs(
    input.space.sourceUpdatedAt,
    "sourceUpdatedAt"
  );
  const projectedAtMs = Date.now();

  // Monotonic + terminal-state guard, enforced ATOMICALLY inside the ON CONFLICT
  // WHERE clause below. A prior JS "SELECT current, decide, then write" guard
  // raced against the projection's own out-of-order / redriven event delivery
  // (e.g. a stale members_updated applied just after space.deleted), reading a
  // pre-delete row and reviving a deleted space. Evaluating the guard against the
  // live row at write time closes that window.
  await input.db
    .prepare(
      `
        INSERT INTO space_index_spaces (
          space_id,
          status,
          organization_id,
          organization_visibility,
          space_name,
          space_purpose,
          direct_message_pair_key,
          direct_message_converted_at_ms,
          active_member_count,
          active_human_count,
          active_agent_count,
          creator_profile_id,
          creator_kind,
          creator_owner_user_id,
          creator_profile_name,
          space_created_at_ms,
          space_updated_at_ms,
          deleted_at_ms,
          deleted_by_profile_id,
          deleted_by_owner_user_id,
          deleted_by_profile_name,
          source_updated_at_ms,
          projected_at_ms,
          projection_event_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(space_id) DO UPDATE SET
          status = excluded.status,
          organization_id = excluded.organization_id,
          organization_visibility = excluded.organization_visibility,
          space_name = excluded.space_name,
          space_purpose = excluded.space_purpose,
          direct_message_pair_key = excluded.direct_message_pair_key,
          direct_message_converted_at_ms = excluded.direct_message_converted_at_ms,
          active_member_count = excluded.active_member_count,
          active_human_count = excluded.active_human_count,
          active_agent_count = excluded.active_agent_count,
          creator_profile_id = excluded.creator_profile_id,
          creator_kind = excluded.creator_kind,
          creator_owner_user_id = excluded.creator_owner_user_id,
          creator_profile_name = excluded.creator_profile_name,
          space_created_at_ms = excluded.space_created_at_ms,
          space_updated_at_ms = excluded.space_updated_at_ms,
          deleted_at_ms = excluded.deleted_at_ms,
          deleted_by_profile_id = excluded.deleted_by_profile_id,
          deleted_by_owner_user_id = excluded.deleted_by_owner_user_id,
          deleted_by_profile_name = excluded.deleted_by_profile_name,
          source_updated_at_ms = excluded.source_updated_at_ms,
          projected_at_ms = excluded.projected_at_ms,
          projection_event_id = excluded.projection_event_id
        WHERE
          excluded.source_updated_at_ms >= space_index_spaces.source_updated_at_ms
          AND NOT (
            space_index_spaces.status = 'deleted'
            AND excluded.status = 'active'
            AND space_index_spaces.source_updated_at_ms >= excluded.source_updated_at_ms
          )
      `
    )
    .bind(
      input.space.spaceId,
      input.space.status,
      normalizeRequiredText(input.space.organizationId, "organizationId"),
      normalizeOrganizationVisibility(input.space.visibility),
      normalizeOptionalText(input.space.spaceName),
      normalizeOptionalText(input.space.spacePurpose),
      normalizeOptionalText(input.space.directMessagePairKey),
      parseOptionalIsoTimestampMs(input.space.directMessageConvertedAt),
      normalizeOptionalNonNegativeInteger(input.space.activeMemberCount),
      normalizeOptionalNonNegativeInteger(input.space.activeHumanCount),
      normalizeOptionalNonNegativeInteger(input.space.activeAgentCount),
      normalizeOptionalText(input.space.creatorProfileId),
      normalizeOptionalText(input.space.creatorKind),
      normalizeOptionalText(input.space.creatorOwnerUserId),
      normalizeOptionalText(input.space.creatorProfileName),
      parseOptionalIsoTimestampMs(input.space.spaceCreatedAt),
      parseOptionalIsoTimestampMs(input.space.spaceUpdatedAt),
      parseOptionalIsoTimestampMs(input.space.deletedAt),
      normalizeOptionalText(input.space.deletedByProfileId),
      normalizeOptionalText(input.space.deletedByOwnerUserId),
      normalizeOptionalText(input.space.deletedByProfileName),
      sourceUpdatedAtMs,
      projectedAtMs,
      input.space.projectionEventId
    )
    .run();
}

export async function upsertSpaceIndexMembership(input: {
  db: D1Database;
  membership: SpaceIndexMembershipProjection;
}): Promise<void> {
  const sourceUpdatedAtMs = parseIsoTimestampMs(
    input.membership.sourceUpdatedAt,
    "sourceUpdatedAt"
  );
  const projectedAtMs = Date.now();

  // Monotonic + terminal-state guard, enforced ATOMICALLY in the ON CONFLICT
  // WHERE below (same race fix as upsertSpaceIndexSpace): a JS read-then-write
  // guard loses to out-of-order / redriven projection events and can re-activate
  // a removed membership. "removed" is terminal against an equal/older "active".
  await input.db
    .prepare(
      `
        INSERT INTO space_index_memberships (
          space_id,
          profile_id,
          profile_kind_snapshot,
          profile_name_snapshot,
          owner_user_id_snapshot,
          owner_name_snapshot,
          controller_ref_snapshot,
          status,
          member_source,
          added_at_ms,
          removed_at_ms,
          added_by_profile_id,
          added_by_owner_user_id,
          added_by_display_name_snapshot,
          removed_by_profile_id,
          removed_by_owner_user_id,
          removal_reason,
          first_entered_at_ms,
          last_entered_at_ms,
          source_updated_at_ms,
          projected_at_ms,
          projection_event_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(space_id, profile_id) DO UPDATE SET
          profile_kind_snapshot = excluded.profile_kind_snapshot,
          profile_name_snapshot = excluded.profile_name_snapshot,
          owner_user_id_snapshot = excluded.owner_user_id_snapshot,
          owner_name_snapshot = excluded.owner_name_snapshot,
          controller_ref_snapshot = excluded.controller_ref_snapshot,
          status = excluded.status,
          member_source = excluded.member_source,
          added_at_ms = excluded.added_at_ms,
          removed_at_ms = excluded.removed_at_ms,
          added_by_profile_id = excluded.added_by_profile_id,
          added_by_owner_user_id = excluded.added_by_owner_user_id,
          added_by_display_name_snapshot = excluded.added_by_display_name_snapshot,
          removed_by_profile_id = excluded.removed_by_profile_id,
          removed_by_owner_user_id = excluded.removed_by_owner_user_id,
          removal_reason = excluded.removal_reason,
          first_entered_at_ms = excluded.first_entered_at_ms,
          last_entered_at_ms = excluded.last_entered_at_ms,
          source_updated_at_ms = excluded.source_updated_at_ms,
          projected_at_ms = excluded.projected_at_ms,
          projection_event_id = excluded.projection_event_id
        WHERE
          excluded.source_updated_at_ms >= space_index_memberships.source_updated_at_ms
          AND NOT (
            space_index_memberships.status = 'removed'
            AND excluded.status = 'active'
            AND space_index_memberships.source_updated_at_ms >= excluded.source_updated_at_ms
          )
      `
    )
    .bind(
      input.membership.spaceId,
      input.membership.profileId,
      input.membership.profileKindSnapshot,
      input.membership.profileNameSnapshot,
      normalizeOptionalText(input.membership.ownerUserIdSnapshot),
      normalizeOptionalText(input.membership.ownerNameSnapshot),
      normalizeOptionalText(input.membership.controllerRefSnapshot),
      input.membership.status,
      input.membership.memberSource,
      parseIsoTimestampMs(input.membership.addedAt, "addedAt"),
      parseOptionalIsoTimestampMs(input.membership.removedAt),
      normalizeOptionalText(input.membership.addedByProfileId),
      normalizeOptionalText(input.membership.addedByOwnerUserId),
      normalizeOptionalText(input.membership.addedByDisplayNameSnapshot),
      normalizeOptionalText(input.membership.removedByProfileId),
      normalizeOptionalText(input.membership.removedByOwnerUserId),
      normalizeOptionalText(input.membership.removalReason),
      parseOptionalIsoTimestampMs(input.membership.firstEnteredAt),
      parseOptionalIsoTimestampMs(input.membership.lastEnteredAt),
      sourceUpdatedAtMs,
      projectedAtMs,
      input.membership.projectionEventId
    )
    .run();
}

// Narrow lookup used by the deleted-profile reconcile fan-out: the
// membership projection is the Space-truth source for "which Spaces does
// this profile belong to" and covers owner-added members, unlike the
// auth-owned join history.
export async function listActiveSpaceIdsForProfileFromSpaceIndex(input: {
  db: D1Database;
  limit: number;
  profileId: string;
}): Promise<string[]> {
  const rows = await input.db
    .prepare(
      `
        SELECT space_id
        FROM space_index_memberships
        WHERE profile_id = ? AND status = 'active'
        ORDER BY source_updated_at_ms DESC
        LIMIT ?
      `
    )
    .bind(input.profileId, input.limit)
    .all<{ space_id: string }>();
  return (rows.results ?? []).map((row) => row.space_id);
}

export type HumanSpaceMembershipAccess = "active" | "missing" | "removed";

export async function readHumanSpaceMembershipAccessForOwner(input: {
  db: D1Database;
  organizationId: string;
  ownerUserId: string;
  spaceId: string;
}): Promise<HumanSpaceMembershipAccess> {
  const row = await input.db
    .prepare(
      `
        SELECT
          space.status AS space_status,
          count(membership.profile_id) AS membership_count,
          max(CASE WHEN membership.status = 'active' THEN 1 ELSE 0 END)
            AS has_active_membership
        FROM space_index_spaces AS space
        LEFT JOIN space_index_memberships AS membership
          ON membership.space_id = space.space_id
          AND membership.owner_user_id_snapshot = ?
          AND membership.profile_kind_snapshot = 'human'
        WHERE space.space_id = ?
          AND space.organization_id = ?
        GROUP BY space.status
      `
    )
    .bind(input.ownerUserId, input.spaceId, input.organizationId)
    .first<{
      has_active_membership: number | null;
      membership_count: number;
      space_status: string;
    }>();
  if (row?.space_status !== "active") {
    return row ? "removed" : "missing";
  }
  if (Number(row?.has_active_membership ?? 0) === 1) {
    return "active";
  }
  return Number(row?.membership_count ?? 0) > 0 ? "removed" : "missing";
}

// Space authorization read for the auth worker (Knife 1 split-brain fix): auth
// must not read this core-owned projections table directly — after cutover the
// writer is openmeld-projections while auth still binds openmeld-db. Auth calls this via
// the OPENMELD_CORE_WORKER RPC so the read always lands on whatever DB core writes.
// Pure data read; the union/fallback authorization decision stays in auth.
export async function listMembershipSpaceIdsForProfilesFromSpaceIndex(input: {
  db: D1Database;
  profileIds: readonly string[];
  spaceIds: readonly string[];
}): Promise<string[]> {
  if (input.profileIds.length === 0 || input.spaceIds.length === 0) {
    return [];
  }
  const profilePlaceholders = input.profileIds.map(() => "?").join(", ");
  const spacePlaceholders = input.spaceIds.map(() => "?").join(", ");
  const rows = await input.db
    .prepare(
      `
        SELECT DISTINCT space_id
        FROM space_index_memberships
        WHERE status = 'active'
          AND profile_id IN (${profilePlaceholders})
          AND space_id IN (${spacePlaceholders})
      `
    )
    .bind(...input.profileIds, ...input.spaceIds)
    .all<{ space_id: string }>();
  return (rows.results ?? []).map((row) => row.space_id);
}

const ACCOUNT_SCOPED_CANDIDATE_SPACES_CTE = `
  candidate_spaces AS (
    SELECT
      s.space_id,
      MAX(COALESCE(CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_pinned_at_ms END, 0)) AS latest_pinned_at_ms,
      MAX(COALESCE(CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_last_joined_at_ms END, m.added_at_ms)) AS latest_joined_at_ms,
      COALESCE(s.space_name, 'Untitled space') AS ordered_space_name
    FROM space_index_memberships m
    CROSS JOIN host_scope hs
    INNER JOIN space_index_spaces s ON s.space_id = m.space_id
    WHERE m.owner_user_id_snapshot = ?
      AND m.status = 'active'
      AND s.status = 'active'
    GROUP BY s.space_id
    ORDER BY
      latest_pinned_at_ms DESC,
      latest_joined_at_ms DESC,
      ordered_space_name ASC,
      s.space_id ASC
    LIMIT ?
  )
`;

// Lightweight account-level fan-out candidates (e.g. the active-wake
// summary). The CTE is shared with the full Account Space Index read so both
// surfaces keep the exact same bounded selection and ordering.
export async function listAccountSpaceIdsFromSpaceIndex(input: {
  db: D1Database;
  gatewayHost: string;
  limit: number;
  ownerUserId: string;
}): Promise<string[]> {
  const rows = await input.db
    .prepare(
      `
        WITH host_scope AS (SELECT ? AS gateway_host),
        ${ACCOUNT_SCOPED_CANDIDATE_SPACES_CTE}
        SELECT space_id
        FROM candidate_spaces
        ORDER BY
          latest_pinned_at_ms DESC,
          latest_joined_at_ms DESC,
          ordered_space_name ASC,
          space_id ASC
      `
    )
    .bind(input.gatewayHost, input.ownerUserId, input.limit)
    .all<{ space_id: string }>();
  return (rows.results ?? []).map((row) => row.space_id);
}

const TARGET_PROFILE_NAME_SNAPSHOT_CHUNK_SIZE = 40;

export type SpaceIndexTargetProfileNameSnapshot = {
  profileId: string;
  profileName: string;
  spaceId: string;
};

export async function listSpaceIndexTargetProfileNameSnapshots(input: {
  db: D1Database;
  targets: readonly { profileId: string; spaceId: string }[];
}): Promise<SpaceIndexTargetProfileNameSnapshot[]> {
  const uniqueTargets = [
    ...new Map(
      input.targets.map((target) => [buildSpaceProfileKey(target), target])
    ).values(),
  ];
  const snapshots: SpaceIndexTargetProfileNameSnapshot[] = [];
  for (
    let offset = 0;
    offset < uniqueTargets.length;
    offset += TARGET_PROFILE_NAME_SNAPSHOT_CHUNK_SIZE
  ) {
    const chunk = uniqueTargets.slice(
      offset,
      offset + TARGET_PROFILE_NAME_SNAPSHOT_CHUNK_SIZE
    );
    if (chunk.length === 0) {
      continue;
    }
    const predicates = chunk
      .map(() => "(space_id = ? AND profile_id = ?)")
      .join(" OR ");
    const bindings = chunk.flatMap((target) => [
      target.spaceId,
      target.profileId,
    ]);
    // Deliberately include removed membership projections. They preserve the
    // frozen target identity needed to explain a still-active Wake after its
    // Agent Profile has been deleted.
    const rows = await input.db
      .prepare(
        `
          SELECT space_id, profile_id, profile_name_snapshot
          FROM space_index_memberships
          WHERE ${predicates}
        `
      )
      .bind(...bindings)
      .all<{
        profile_id?: unknown;
        profile_name_snapshot?: unknown;
        space_id?: unknown;
      }>();
    for (const row of rows.results ?? []) {
      const profileId = normalizeOptionalText(row.profile_id);
      const profileName = normalizeOptionalText(row.profile_name_snapshot);
      const spaceId = normalizeOptionalText(row.space_id);
      if (profileId && profileName && spaceId) {
        snapshots.push({ profileId, profileName, spaceId });
      }
    }
  }
  return snapshots.sort((left, right) =>
    buildSpaceProfileKey(left).localeCompare(buildSpaceProfileKey(right))
  );
}

function buildSpaceProfileKey(input: {
  profileId: string;
  spaceId: string;
}): string {
  return `${input.spaceId}\u0000${input.profileId}`;
}

export async function listAccountSpacesFromSpaceIndex(
  input: ListAccountSpacesFromSpaceIndexInput
): Promise<AccountSpaceIndexResponse> {
  const [rows, recentlyDeletedItems] = await Promise.all([
    input.scope === "profile"
      ? listProfileScopedRows(input)
      : listAccountScopedRows(input),
    input.includeRecentlyDeletedItems === true
      ? listRecentlyDeletedSpacesForAccount(input)
      : Promise.resolve(undefined),
  ]);
  const sections = partitionAccountSpaceIndexItems(
    buildAccountSpaceItems(input, rows)
  );
  if (input.includeMemberPreviews === true) {
    await attachSpaceMemberPreviews(input.db, [
      ...sections.pinnedItems,
      ...sections.spaceItems,
    ]);
  }
  // Opt-in only: omit recentlyDeletedItems for callers that did not request it, so a
  // strict legacy client (CLI) receives the legacy {pinnedItems, spaceItems} shape
  // its own strictObject parse accepts. See the schema note. The query is skipped
  // entirely when not requested.
  if (recentlyDeletedItems === undefined) {
    return sections;
  }
  return { ...sections, recentlyDeletedItems };
}

// Only enrich the already authorized candidate list. Read at most three active
// members per Space, in stable membership order; never fan out to Space DOs.
async function attachSpaceMemberPreviews(
  db: D1Database,
  items: AccountSpaceIndexResponse["spaceItems"]
): Promise<void> {
  for (let offset = 0; offset < items.length; offset += 90) {
    const chunk = items.slice(offset, offset + 90);
    const rows = await db
      .prepare(`
      SELECT space_id, profile_id, profile_name_snapshot,
        profile_kind_snapshot, controller_ref_snapshot
      FROM (
        SELECT space_id, profile_id, profile_name_snapshot,
          profile_kind_snapshot, controller_ref_snapshot,
          ROW_NUMBER() OVER (
            PARTITION BY space_id ORDER BY added_at_ms, profile_id
          ) AS member_rank
        FROM space_index_memberships
        WHERE status = 'active'
          AND space_id IN (${chunk.map(() => "?").join(",")})
      )
      WHERE member_rank <= 3
      ORDER BY space_id, member_rank
    `)
      .bind(...chunk.map((item) => item.spaceId))
      .all<{
        space_id: string;
        profile_id: string;
        profile_name_snapshot: string;
        profile_kind_snapshot: "human" | "agent";
        controller_ref_snapshot: string | null;
      }>();
    const byId = new Map(
      chunk.map((item) => {
        item.memberPreviews = [];
        return [item.spaceId, item] as const;
      })
    );
    for (const row of rows.results ?? []) {
      byId.get(row.space_id)?.memberPreviews?.push({
        profileId: row.profile_id,
        profileName: row.profile_name_snapshot,
        profileKind: row.profile_kind_snapshot,
        agentControllerRef: row.controller_ref_snapshot,
      });
    }
  }
}

export async function listOrganizationSpacesFromSpaceIndex(input: {
  db: D1Database;
  generatedAt: string;
  limit: number;
  organizationId: string;
  ownerUserId: string;
}): Promise<OrganizationSpaceDirectoryWithMemberCountsResponse> {
  const { results } = await input.db
    .prepare(
      `
        SELECT
          s.active_member_count,
          cad.agent_profile_id AS center_agent_profile_id,
          s.space_id,
          s.organization_id,
          s.organization_visibility,
          s.space_name,
          s.space_purpose,
          s.direct_message_pair_key,
          s.direct_message_converted_at_ms,
          s.space_created_at_ms,
          s.space_updated_at_ms,
          s.source_updated_at_ms,
          MAX(m.added_at_ms) AS latest_joined_at_ms
        FROM space_index_spaces s
        LEFT JOIN center_agent_designations cad
          ON cad.organization_id = s.organization_id
        LEFT JOIN space_index_memberships m
          ON m.space_id = s.space_id
          AND m.owner_user_id_snapshot = ?
          AND m.status = 'active'
        WHERE s.organization_id = ?
          AND s.status = 'active'
          AND (
            s.organization_visibility = 'public'
            OR m.profile_id IS NOT NULL
          )
        GROUP BY
          s.active_member_count,
          s.space_id,
          s.organization_id,
          s.organization_visibility,
          s.space_name,
          s.space_purpose,
          s.direct_message_pair_key,
          s.direct_message_converted_at_ms,
          cad.agent_profile_id,
          s.space_created_at_ms,
          s.space_updated_at_ms,
          s.source_updated_at_ms
        ORDER BY
          CASE WHEN latest_joined_at_ms IS NULL THEN 1 ELSE 0 END ASC,
          latest_joined_at_ms DESC,
          COALESCE(s.space_updated_at_ms, s.source_updated_at_ms) DESC,
          COALESCE(s.space_name, 'Untitled space') ASC,
          s.space_id ASC
        LIMIT ?
      `
    )
    .bind(input.ownerUserId, input.organizationId, input.limit)
    .all<OrganizationSpaceDirectoryRow>();

  return {
    organizationId: input.organizationId,
    generatedAt: input.generatedAt,
    spaces: (results ?? [])
      .filter((row) => !isHiddenCurrentSpaceIndexRow(row))
      .map((row) => ({
        activeMemberCount: row.active_member_count ?? null,
        spaceId: row.space_id,
        name: row.space_name ?? "Untitled space",
        organizationId: row.organization_id,
        visibility: row.organization_visibility,
        joined: row.latest_joined_at_ms !== null,
        lastJoinedAt: timestampMsToIsoOrNull(row.latest_joined_at_ms),
        spaceCreatedAt: timestampMsToIsoOrNull(row.space_created_at_ms),
        spaceUpdatedAt: timestampMsToIsoOrNull(row.space_updated_at_ms),
        updatedAt: timestampMsToIso(row.source_updated_at_ms),
      })),
  };
}

export async function readSpaceIndexNamesByIds(input: {
  db: D1Database;
  organizationId: string;
  spaceIds: readonly string[];
}): Promise<Map<string, string>> {
  const spaceIds = [...new Set(input.spaceIds.filter((spaceId) => spaceId))];
  if (spaceIds.length === 0) {
    return new Map();
  }
  const { results } = await input.db
    .prepare(
      `
        SELECT space_id, space_name
        FROM space_index_spaces
        WHERE organization_id = ?
          AND status = 'active'
          AND space_id IN (SELECT value FROM json_each(?))
      `
    )
    .bind(input.organizationId, JSON.stringify(spaceIds))
    .all<SpaceIndexNameRow>();
  return new Map(
    (results ?? []).map((row) => [
      row.space_id,
      normalizeSpaceName(row.space_name),
    ])
  );
}

export async function listRoutineTargetSpacesFromSpaceIndex(input: {
  centerAgentDirectMessagePairKey: string;
  centerAgentProfileId: string;
  db: D1Database;
  limit: number;
  organizationId: string;
  representedHumanProfileId: string;
  representedHumanUserId: string;
}): Promise<CenterAgentRoutineTargetSpace[]> {
  const rows = await queryRoutineTargetSpaceEligibilityFromSpaceIndex({
    ...input,
    scope: "list",
  });
  return rows.map(toRoutineTargetSpace);
}

export async function readRoutineTargetSpaceEligibilityFromSpaceIndex(input: {
  centerAgentDirectMessagePairKey: string | null;
  centerAgentProfileId: string | null;
  db: D1Database;
  organizationId: string;
  representedHumanProfileId: string;
  representedHumanUserId: string;
  targetSpaceId: string;
}): Promise<RoutineTargetSpaceEligibilityProjection | null> {
  const rows = await queryRoutineTargetSpaceEligibilityFromSpaceIndex({
    ...input,
    scope: "target",
  });
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    active: isSqlTrue(row.is_active),
    centerAgentCanPublish: isSqlTrue(row.center_agent_can_publish),
    eligible: isSqlTrue(row.is_eligible),
    organizationId: row.organization_id,
    representedHumanVisible: isSqlTrue(row.represented_human_visible),
    sameOrganization: isSqlTrue(row.same_organization),
    shapeAllowed: isSqlTrue(row.target_shape_allowed),
    spaceId: row.space_id,
  };
}

async function queryRoutineTargetSpaceEligibilityFromSpaceIndex(
  input: RoutineTargetSpaceEligibilityQueryInput
): Promise<RoutineTargetSpaceRow[]> {
  const organizationId = normalizeRequiredText(
    input.organizationId,
    "organizationId"
  );
  const representedHumanProfileId = normalizeRequiredText(
    input.representedHumanProfileId,
    "representedHumanProfileId"
  );
  const representedHumanUserId = normalizeRequiredText(
    input.representedHumanUserId,
    "representedHumanUserId"
  );
  const centerAgentProfileId = normalizeOptionalText(
    input.centerAgentProfileId
  );
  const centerAgentDirectMessagePairKey = normalizeOptionalText(
    input.centerAgentDirectMessagePairKey
  );
  const scopePredicate =
    input.scope === "list"
      ? "s.organization_id = context.organization_id AND s.status = 'active'"
      : "s.space_id = ?";
  const resultFilter = input.scope === "list" ? "WHERE is_eligible = 1" : "";
  const resultOrder =
    input.scope === "list"
      ? `
          ORDER BY
            CASE WHEN space_purpose = ? THEN 0 ELSE 1 END ASC,
            COALESCE(NULLIF(TRIM(space_name), ''), 'Untitled space') COLLATE NOCASE ASC,
            space_id ASC
          LIMIT ?
        `
      : "LIMIT 1";
  const scopeBindings =
    input.scope === "list"
      ? []
      : [normalizeRequiredText(input.targetSpaceId, "targetSpaceId")];
  const resultBindings =
    input.scope === "list"
      ? [OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE, input.limit]
      : [];
  const { results } = await input.db
    .prepare(
      `
        WITH routine_target_context AS (
          SELECT
            ? AS organization_id,
            ? AS represented_human_profile_id,
            ? AS represented_human_user_id,
            ? AS center_agent_profile_id,
            ? AS center_agent_direct_message_pair_key,
            ? AS direct_message_purpose,
            ? AS legacy_welcoming_purpose
        ),
        routine_target_facts AS (
          SELECT
            s.space_id,
            s.organization_id,
            s.space_name,
            s.space_purpose,
            s.direct_message_pair_key,
            CASE WHEN s.organization_id = context.organization_id THEN 1 ELSE 0 END
              AS same_organization,
            CASE WHEN s.status = 'active' THEN 1 ELSE 0 END AS is_active,
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM space_index_memberships center_agent_membership
                WHERE center_agent_membership.space_id = s.space_id
                  AND center_agent_membership.profile_id = context.center_agent_profile_id
                  AND center_agent_membership.profile_kind_snapshot = 'agent'
                  AND center_agent_membership.status = 'active'
              ) THEN 1
              ELSE 0
            END AS center_agent_can_publish,
            CASE
              WHEN s.organization_visibility = 'public' THEN 1
              WHEN EXISTS (
                SELECT 1
                FROM space_index_memberships represented_human_membership
                WHERE represented_human_membership.space_id = s.space_id
                  AND represented_human_membership.status = 'active'
                  AND represented_human_membership.profile_kind_snapshot = 'human'
                  AND (
                    represented_human_membership.profile_id = context.represented_human_profile_id
                    OR represented_human_membership.owner_user_id_snapshot = context.represented_human_user_id
                  )
              ) THEN 1
              ELSE 0
            END AS represented_human_visible,
            CASE
              WHEN s.space_purpose = context.direct_message_purpose THEN (
                SELECT COUNT(*)
                FROM space_index_memberships active_dm_member
                WHERE active_dm_member.space_id = s.space_id
                  AND active_dm_member.status = 'active'
              )
              ELSE NULL
            END AS active_dm_membership_count,
            CASE
              WHEN s.space_purpose = context.direct_message_purpose
                AND EXISTS (
                  SELECT 1
                  FROM space_index_memberships represented_dm_member
                  WHERE represented_dm_member.space_id = s.space_id
                    AND represented_dm_member.profile_id = context.represented_human_profile_id
                    AND represented_dm_member.profile_kind_snapshot = 'human'
                    AND represented_dm_member.status = 'active'
                ) THEN 1
              ELSE 0
            END AS represented_human_is_exact_dm_member,
            CASE
              WHEN s.space_purpose = context.direct_message_purpose THEN (
                SELECT current_dm.space_id
                FROM space_index_spaces current_dm
                WHERE current_dm.organization_id = context.organization_id
                  AND current_dm.direct_message_pair_key = context.center_agent_direct_message_pair_key
                  AND current_dm.space_purpose = context.direct_message_purpose
                  AND current_dm.status = 'active'
                ORDER BY current_dm.space_created_at_ms DESC, current_dm.space_id DESC
                LIMIT 1
              )
              ELSE NULL
            END AS latest_center_agent_dm_space_id,
            context.center_agent_direct_message_pair_key,
            context.direct_message_purpose,
            context.legacy_welcoming_purpose
          FROM routine_target_context context
          CROSS JOIN space_index_spaces s
          WHERE ${scopePredicate}
        ),
        routine_target_shapes AS (
          SELECT
            *,
            CASE
              WHEN COALESCE(space_purpose, '') = legacy_welcoming_purpose THEN 0
              WHEN space_purpose = direct_message_purpose THEN
                CASE
                  WHEN direct_message_pair_key = center_agent_direct_message_pair_key
                    AND active_dm_membership_count = 2
                    AND represented_human_is_exact_dm_member = 1
                    AND center_agent_can_publish = 1
                    AND space_id = latest_center_agent_dm_space_id
                    THEN 1
                  ELSE 0
                END
              ELSE 1
            END AS target_shape_allowed
          FROM routine_target_facts
        ),
        routine_target_eligibility AS (
          SELECT
            *,
            CASE
              WHEN same_organization = 1
                AND is_active = 1
                AND represented_human_visible = 1
                AND center_agent_can_publish = 1
                AND target_shape_allowed = 1
                THEN 1
              ELSE 0
            END AS is_eligible
          FROM routine_target_shapes
        )
        SELECT
          space_id,
          organization_id,
          space_name,
          space_purpose,
          same_organization,
          is_active,
          represented_human_visible,
          center_agent_can_publish,
          target_shape_allowed,
          is_eligible
        FROM routine_target_eligibility
        ${resultFilter}
        ${resultOrder}
      `
    )
    .bind(
      organizationId,
      representedHumanProfileId,
      representedHumanUserId,
      centerAgentProfileId,
      centerAgentDirectMessagePairKey,
      OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
      LEGACY_WELCOMING_SPACE_PURPOSE,
      ...scopeBindings,
      ...resultBindings
    )
    .all<RoutineTargetSpaceRow>();
  return results ?? [];
}

function toRoutineTargetSpace(
  row: RoutineTargetSpaceRow
): CenterAgentRoutineTargetSpace {
  return {
    kind:
      row.space_purpose === OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE
        ? "center_agent_dm"
        : "space",
    name: normalizeSpaceName(row.space_name),
    spaceId: row.space_id,
  };
}

function isSqlTrue(value: number | boolean): boolean {
  return value === true || value === 1;
}

export async function readCenterAgentDirectMessageProjectionCandidateByPairKey(input: {
  db: D1Database;
  organizationId: string;
  pairKey: string;
}): Promise<SpaceIndexCenterAgentDirectMessageProjectionCandidate | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          s.space_id,
          s.organization_id,
          s.space_purpose,
          s.direct_message_pair_key
        FROM space_index_spaces s
        WHERE s.organization_id = ?
          AND s.direct_message_pair_key = ?
          AND s.space_purpose = ?
          AND s.direct_message_converted_at_ms IS NULL
          AND s.status = 'active'
        ORDER BY s.space_created_at_ms DESC, s.space_id DESC
        LIMIT 1
      `
    )
    .bind(
      normalizeRequiredText(input.organizationId, "organizationId"),
      normalizeRequiredText(input.pairKey, "pairKey"),
      OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE
    )
    .first<SpaceIndexCenterAgentDirectMessageProjectionCandidateRow>();

  return row ? toCenterAgentDirectMessageProjectionCandidate(row) : null;
}

export async function readCenterAgentDirectMessageProjectionCandidateBySpaceId(input: {
  db: D1Database;
  spaceId: string;
}): Promise<SpaceIndexCenterAgentDirectMessageProjectionCandidate | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          s.space_id,
          s.organization_id,
          s.space_purpose,
          s.direct_message_pair_key
        FROM space_index_spaces s
        WHERE s.space_id = ?
          AND s.status = 'active'
          AND s.direct_message_converted_at_ms IS NULL
        LIMIT 1
      `
    )
    .bind(normalizeRequiredText(input.spaceId, "spaceId"))
    .first<SpaceIndexCenterAgentDirectMessageProjectionCandidateRow>();

  return row ? toCenterAgentDirectMessageProjectionCandidate(row) : null;
}

export async function listCenterAgentSessionIndexRows(input: {
  db: D1Database;
  organizationId: string;
  pairKey: string;
  limit: number;
  before?: { createdAtMs: number; spaceId: string };
}): Promise<
  Array<{ spaceId: string; name: string | null; createdAtMs: number | null }>
> {
  const beforeClause = input.before
    ? "AND (COALESCE(s.space_created_at_ms, 0) < ? OR (COALESCE(s.space_created_at_ms, 0) = ? AND s.space_id < ?))"
    : "";
  const rows = await input.db
    .prepare(`
    SELECT s.space_id, s.space_name, s.space_created_at_ms
    FROM space_index_spaces s
    WHERE s.organization_id = ? AND s.direct_message_pair_key = ?
      AND s.space_purpose = ? AND s.direct_message_converted_at_ms IS NULL
      AND s.status = 'active'
      ${beforeClause}
    ORDER BY COALESCE(s.space_created_at_ms, 0) DESC, s.space_id DESC
    LIMIT ?
  `)
    .bind(
      input.organizationId,
      input.pairKey,
      OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
      ...(input.before
        ? [
            input.before.createdAtMs,
            input.before.createdAtMs,
            input.before.spaceId,
          ]
        : []),
      input.limit
    )
    .all<{
      space_id: string;
      space_name: string | null;
      space_created_at_ms: number | null;
    }>();
  return rows.results.map((row) => ({
    spaceId: row.space_id,
    name: row.space_name,
    createdAtMs: row.space_created_at_ms,
  }));
}

export async function readSpaceIndexOrganizationJoinTarget(input: {
  db: D1Database;
  spaceId: string;
}): Promise<SpaceIndexOrganizationJoinTarget | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          creator_profile_id,
          creator_profile_name,
          space_id,
          organization_id,
          organization_visibility,
          space_name
        FROM space_index_spaces
        WHERE space_id = ?
          AND status = 'active'
        LIMIT 1
      `
    )
    .bind(input.spaceId)
    .first<SpaceIndexOrganizationJoinTargetRow>();

  if (!row) {
    return null;
  }
  return {
    creatorProfileId: row.creator_profile_id,
    creatorProfileName: row.creator_profile_name,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    spaceName: row.space_name,
    visibility: row.organization_visibility,
  };
}

export async function readReusableDirectMessageSpaceIndexCandidate(input: {
  db: D1Database;
  organizationId: string;
  pairKey: string;
}): Promise<SpaceIndexDirectMessageCandidate | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          s.space_id,
          s.organization_id,
          s.organization_visibility,
          COALESCE(
            s.active_member_count,
            (
              SELECT COUNT(*)
              FROM space_index_memberships m
              WHERE m.space_id = s.space_id
                AND m.status = 'active'
            )
          ) AS active_member_count,
          COALESCE(
            s.active_human_count,
            (
              SELECT COUNT(*)
              FROM space_index_memberships m
              WHERE m.space_id = s.space_id
                AND m.status = 'active'
                AND m.profile_kind_snapshot = 'human'
            )
          ) AS active_human_count,
          COALESCE(
            s.active_agent_count,
            (
              SELECT COUNT(*)
              FROM space_index_memberships m
              WHERE m.space_id = s.space_id
                AND m.status = 'active'
                AND m.profile_kind_snapshot = 'agent'
            )
          ) AS active_agent_count
        FROM space_index_spaces s
        WHERE s.organization_id = ?
          AND s.direct_message_pair_key = ?
          AND s.space_purpose = ?
          AND s.status = 'active'
          AND s.direct_message_converted_at_ms IS NULL
          AND COALESCE(
            s.active_member_count,
            (
              SELECT COUNT(*)
              FROM space_index_memberships m
              WHERE m.space_id = s.space_id
                AND m.status = 'active'
            )
          ) <= 2
        ORDER BY s.space_created_at_ms DESC, s.space_id DESC
        LIMIT 1
      `
    )
    .bind(
      normalizeRequiredText(input.organizationId, "organizationId"),
      normalizeRequiredText(input.pairKey, "pairKey"),
      OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE
    )
    .first<SpaceIndexDirectMessageCandidateRow>();

  return row ? toDirectMessageCandidate(row) : null;
}

export async function readDirectMessageSpaceIndexCandidateBySpaceId(input: {
  db: D1Database;
  spaceId: string;
}): Promise<SpaceIndexDirectMessageCandidate | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          s.space_id,
          s.organization_id,
          s.organization_visibility,
          COALESCE(
            s.active_member_count,
            (
              SELECT COUNT(*)
              FROM space_index_memberships m
              WHERE m.space_id = s.space_id
                AND m.status = 'active'
            )
          ) AS active_member_count,
          COALESCE(
            s.active_human_count,
            (
              SELECT COUNT(*)
              FROM space_index_memberships m
              WHERE m.space_id = s.space_id
                AND m.status = 'active'
                AND m.profile_kind_snapshot = 'human'
            )
          ) AS active_human_count,
          COALESCE(
            s.active_agent_count,
            (
              SELECT COUNT(*)
              FROM space_index_memberships m
              WHERE m.space_id = s.space_id
                AND m.status = 'active'
                AND m.profile_kind_snapshot = 'agent'
            )
          ) AS active_agent_count
        FROM space_index_spaces s
        WHERE s.space_id = ?
          AND s.status = 'active'
          AND s.direct_message_converted_at_ms IS NULL
        LIMIT 1
      `
    )
    .bind(normalizeRequiredText(input.spaceId, "spaceId"))
    .first<SpaceIndexDirectMessageCandidateRow>();

  return row ? toDirectMessageCandidate(row) : null;
}

export async function countDirectMessageSpacesForPair(input: {
  db: D1Database;
  organizationId: string;
  pairKey: string;
}): Promise<number> {
  const row = await input.db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM space_index_spaces
        WHERE organization_id = ?
          AND direct_message_pair_key = ?
          AND space_purpose = ?
      `
    )
    .bind(
      normalizeRequiredText(input.organizationId, "organizationId"),
      normalizeRequiredText(input.pairKey, "pairKey"),
      OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE
    )
    .first<{ count: number | null }>();
  return Math.max(0, Number(row?.count ?? 0));
}

function toDirectMessageCandidate(
  row: SpaceIndexDirectMessageCandidateRow
): SpaceIndexDirectMessageCandidate {
  return {
    activeAgentCount: row.active_agent_count,
    activeHumanCount: row.active_human_count,
    activeMemberCount: row.active_member_count,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    visibility: row.organization_visibility,
  };
}

function toCenterAgentDirectMessageProjectionCandidate(
  row: SpaceIndexCenterAgentDirectMessageProjectionCandidateRow
): SpaceIndexCenterAgentDirectMessageProjectionCandidate {
  return {
    directMessagePairKey: row.direct_message_pair_key,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    spacePurpose: row.space_purpose,
  };
}

function isCenterAgentDirectMessageSpaceIndexRow(row: {
  center_agent_profile_id: string | null;
  direct_message_pair_key: string | null;
  space_purpose: string | null;
}): boolean {
  return isCenterAgentDirectMessageSpaceProjection({
    centerAgentProfileId: row.center_agent_profile_id,
    directMessagePairKey: row.direct_message_pair_key,
    spacePurpose: row.space_purpose,
  });
}

function isHiddenCurrentSpaceIndexRow(row: {
  center_agent_profile_id: string | null;
  direct_message_pair_key: string | null;
  space_purpose: string | null;
}): boolean {
  return (
    isCenterAgentDirectMessageSpaceIndexRow(row) ||
    row.space_purpose === LEGACY_WELCOMING_SPACE_PURPOSE
  );
}

// Bounded window for surfacing a whole-space deletion to its former members as a
// one-time client notice. The per-Space signal channel dies with the deleted DO,
// so the durable Space Index projection (deletedAt/deletedBy) is the only place a
// former member can learn the Space is gone. The client tracks which it has shown;
// this bound just keeps the read from carrying long-gone deletions forever (the
// Space Index is a rebuildable projection by charter).
const RECENTLY_DELETED_SPACE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

async function listRecentlyDeletedSpacesForAccount(
  input: ListAccountSpacesFromSpaceIndexInput
): Promise<AccountSpaceIndexDeletedItem[]> {
  const cutoffMs = Date.now() - RECENTLY_DELETED_SPACE_WINDOW_MS;
  // Fixed, code-chosen column (never user input); the scope value is bound below.
  const scopeColumn =
    input.scope === "profile" ? "m.profile_id" : "m.owner_user_id_snapshot";
  const scopeValue =
    input.scope === "profile" ? input.selectedProfileId : input.ownerUserId;
  const { results } = await input.db
    .prepare(
      `
        SELECT
          s.space_id,
          s.space_name,
          s.deleted_by_profile_name,
          s.deleted_at_ms
        FROM space_index_spaces s
        INNER JOIN space_index_memberships m ON m.space_id = s.space_id
        WHERE s.status = 'deleted'
          AND s.deleted_at_ms IS NOT NULL
          AND s.deleted_at_ms >= ?
          AND ${scopeColumn} = ?
          AND m.removal_reason = 'space_deleted'
        GROUP BY s.space_id
        ORDER BY s.deleted_at_ms DESC
        LIMIT ?
      `
    )
    .bind(cutoffMs, scopeValue, input.limit)
    .all<{
      deleted_at_ms: number;
      deleted_by_profile_name: string | null;
      space_id: string;
      space_name: string | null;
    }>();
  return (results ?? []).map((row) => ({
    deletedAt: timestampMsToIso(row.deleted_at_ms),
    deletedByProfileName: row.deleted_by_profile_name,
    spaceId: row.space_id,
    spaceName: row.space_name,
  }));
}

export async function diagnoseSpaceIndexProjectionDrift(input: {
  db: D1Database;
  spaceId: string;
}): Promise<SpaceIndexProjectionDriftDiagnostic> {
  const issues: SpaceIndexProjectionDriftIssue[] = [];
  const spaceRow = await input.db
    .prepare(
      `
        SELECT
          s.space_id,
          s.source_updated_at_ms,
          s.projection_event_id,
          e.projection_event_id AS completed_projection_event_id
        FROM space_index_spaces s
        LEFT JOIN space_index_projection_events e
          ON e.projection_event_id = s.projection_event_id
        WHERE s.space_id = ?
        LIMIT 1
      `
    )
    .bind(input.spaceId)
    .first<{
      completed_projection_event_id: string | null;
      projection_event_id: string;
      source_updated_at_ms: number;
      space_id: string;
    }>();

  if (spaceRow && !spaceRow.completed_projection_event_id) {
    issues.push({
      code: "space_index_space_missing_completed_event",
      message:
        "SpaceIndex space row points to a projection event that is not completed.",
      projectionEventId: spaceRow.projection_event_id,
      spaceId: input.spaceId,
    });
  }

  const { results: membershipRows } = await input.db
    .prepare(
      `
        SELECT
          m.profile_id,
          m.projection_event_id,
          e.projection_event_id AS completed_projection_event_id
        FROM space_index_memberships m
        LEFT JOIN space_index_projection_events e
          ON e.projection_event_id = m.projection_event_id
        WHERE m.space_id = ?
          AND e.projection_event_id IS NULL
        ORDER BY m.profile_id ASC
      `
    )
    .bind(input.spaceId)
    .all<{
      completed_projection_event_id: string | null;
      profile_id: string;
      projection_event_id: string;
    }>();

  for (const row of membershipRows ?? []) {
    issues.push({
      code: "space_index_membership_missing_completed_event",
      message:
        "SpaceIndex membership row points to a projection event that is not completed.",
      profileId: row.profile_id,
      projectionEventId: row.projection_event_id,
      spaceId: input.spaceId,
    });
  }

  const latestEvent = await input.db
    .prepare(
      `
        SELECT
          projection_event_id,
          source_updated_at_ms,
          payload_json
        FROM space_index_projection_events
        WHERE space_id = ?
        ORDER BY source_updated_at_ms DESC, projected_at_ms DESC
        LIMIT 1
      `
    )
    .bind(input.spaceId)
    .first<{
      payload_json: string;
      projection_event_id: string;
      source_updated_at_ms: number;
    }>();

  if (latestEvent && spaceRow) {
    if (spaceRow.source_updated_at_ms < latestEvent.source_updated_at_ms) {
      issues.push({
        code: "space_index_space_behind_completed_event",
        message:
          "Latest completed projection event is newer than the SpaceIndex space row.",
        projectionEventId: latestEvent.projection_event_id,
        spaceId: input.spaceId,
      });
    }

    const expectedMemberCount = readProjectionEventMemberCount(
      latestEvent.payload_json
    );
    if (typeof expectedMemberCount === "number") {
      const projectedMemberCount = await input.db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM space_index_memberships
            WHERE space_id = ?
              AND projection_event_id = ?
          `
        )
        .bind(input.spaceId, latestEvent.projection_event_id)
        .first<number>("count");
      if (Number(projectedMemberCount ?? 0) !== expectedMemberCount) {
        issues.push({
          code: "space_index_projection_event_membership_count_mismatch",
          message:
            "Latest completed projection event member count does not match membership rows written by that event.",
          projectionEventId: latestEvent.projection_event_id,
          spaceId: input.spaceId,
        });
      }
    }
  }

  return {
    issues,
    ok: issues.length === 0,
    spaceId: input.spaceId,
  };
}

async function listAccountScopedRows(
  input: ListAccountSpacesFromSpaceIndexInput
): Promise<SpaceIndexJoinedRow[]> {
  const { results } = await input.db
    .prepare(
      `
        WITH host_scope AS (SELECT ? AS gateway_host),
        ${ACCOUNT_SCOPED_CANDIDATE_SPACES_CTE}
        SELECT
          cad.agent_profile_id AS center_agent_profile_id,
          s.space_id,
          s.organization_id,
          s.organization_visibility,
          s.space_name,
          s.space_purpose,
          s.direct_message_pair_key,
          s.direct_message_converted_at_ms,
          s.active_member_count,
          s.active_human_count,
          s.active_agent_count,
          s.creator_profile_id,
          s.creator_kind,
          s.creator_owner_user_id,
          s.creator_profile_name,
          s.space_created_at_ms,
          s.space_updated_at_ms,
          m.profile_id AS membership_profile_id,
          m.profile_kind_snapshot,
          m.profile_name_snapshot,
          m.owner_user_id_snapshot,
          m.added_at_ms,
          m.last_entered_at_ms,
          CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_last_joined_at_ms END AS overlay_last_joined_at_ms,
          CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_last_seen_ts END AS overlay_last_seen_ts,
          CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_pinned_at_ms END AS overlay_pinned_at_ms,
          CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_updated_at_ms END AS overlay_updated_at_ms,
          m.source_updated_at_ms,
          m.projected_at_ms
        FROM candidate_spaces c
        CROSS JOIN host_scope hs
        INNER JOIN space_index_spaces s ON s.space_id = c.space_id
        LEFT JOIN center_agent_designations cad
          ON cad.organization_id = s.organization_id
        INNER JOIN space_index_memberships m ON m.space_id = c.space_id
        WHERE m.owner_user_id_snapshot = ?
          AND m.status = 'active'
          AND s.status = 'active'
        ORDER BY
          c.latest_pinned_at_ms DESC,
          c.latest_joined_at_ms DESC,
          COALESCE(s.space_name, 'Untitled space') ASC,
          s.space_id ASC,
          COALESCE(CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_pinned_at_ms END, 0) DESC,
          COALESCE(CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_last_joined_at_ms END, m.added_at_ms) DESC,
          m.profile_name_snapshot ASC,
          m.profile_id ASC
      `
    )
    .bind(input.gatewayHost, input.ownerUserId, input.limit, input.ownerUserId)
    .all<SpaceIndexJoinedRow>();
  return results ?? [];
}

async function listProfileScopedRows(
  input: ListAccountSpacesFromSpaceIndexInput
): Promise<SpaceIndexJoinedRow[]> {
  const { results } = await input.db
    .prepare(
      `
        WITH host_scope AS (SELECT ? AS gateway_host),
        candidate_spaces AS (
          SELECT
            s.space_id,
            MAX(COALESCE(CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_pinned_at_ms END, 0)) AS latest_pinned_at_ms,
            MAX(COALESCE(CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_last_joined_at_ms END, m.added_at_ms)) AS latest_joined_at_ms
          FROM space_index_memberships m
          CROSS JOIN host_scope hs
          INNER JOIN space_index_spaces s ON s.space_id = m.space_id
          WHERE m.profile_id = ?
            AND m.status = 'active'
            AND s.status = 'active'
          GROUP BY s.space_id
          ORDER BY
            latest_pinned_at_ms DESC,
            latest_joined_at_ms DESC,
            COALESCE(s.space_name, 'Untitled space') ASC,
            s.space_id ASC
          LIMIT ?
        )
        SELECT
          cad.agent_profile_id AS center_agent_profile_id,
          s.space_id,
          s.organization_id,
          s.organization_visibility,
          s.space_name,
          s.space_purpose,
          s.direct_message_pair_key,
          s.direct_message_converted_at_ms,
          s.active_member_count,
          s.active_human_count,
          s.active_agent_count,
          s.creator_profile_id,
          s.creator_kind,
          s.creator_owner_user_id,
          s.creator_profile_name,
          s.space_created_at_ms,
          s.space_updated_at_ms,
          m.profile_id AS membership_profile_id,
          m.profile_kind_snapshot,
          m.profile_name_snapshot,
          m.owner_user_id_snapshot,
          m.added_at_ms,
          m.last_entered_at_ms,
          CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_last_joined_at_ms END AS overlay_last_joined_at_ms,
          CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_last_seen_ts END AS overlay_last_seen_ts,
          CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_pinned_at_ms END AS overlay_pinned_at_ms,
          CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_updated_at_ms END AS overlay_updated_at_ms,
          m.source_updated_at_ms,
          m.projected_at_ms
        FROM candidate_spaces c
        CROSS JOIN host_scope hs
        INNER JOIN space_index_spaces s ON s.space_id = c.space_id
        LEFT JOIN center_agent_designations cad
          ON cad.organization_id = s.organization_id
        INNER JOIN space_index_memberships m ON m.space_id = c.space_id
        WHERE m.profile_id = ?
          AND m.status = 'active'
          AND s.status = 'active'
        ORDER BY
          c.latest_pinned_at_ms DESC,
          c.latest_joined_at_ms DESC,
          COALESCE(s.space_name, 'Untitled space') ASC,
          s.space_id ASC,
          COALESCE(CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_pinned_at_ms END, 0) DESC,
          COALESCE(CASE WHEN m.overlay_gateway_host = hs.gateway_host THEN m.overlay_last_joined_at_ms END, m.added_at_ms) DESC,
          m.profile_name_snapshot ASC,
          m.profile_id ASC
      `
    )
    .bind(
      input.gatewayHost,
      input.selectedProfileId,
      input.limit,
      input.selectedProfileId
    )
    .all<SpaceIndexJoinedRow>();
  return results ?? [];
}

function buildAccountSpaceItems(
  input: ListAccountSpacesFromSpaceIndexInput,
  rows: readonly SpaceIndexJoinedRow[]
): AccountSpaceIndexItem[] {
  const bySpaceId = new Map<string, AccountSpaceIndexItemDraft>();

  for (const row of rows) {
    if (isHiddenCurrentSpaceIndexRow(row)) {
      continue;
    }

    const joinedAtMs = row.overlay_last_joined_at_ms ?? row.added_at_ms;
    const openProfileRankMs = resolveOpenProfileRankMs(row, joinedAtMs);
    const updatedAtMs = Math.max(
      row.source_updated_at_ms,
      row.overlay_updated_at_ms ?? 0
    );
    const joinedProfile: AccountSpaceIndexJoinedProfile = {
      lastJoinedAt: timestampMsToIso(joinedAtMs),
      pinnedAt: timestampMsToIsoOrNull(row.overlay_pinned_at_ms),
      profileId: row.membership_profile_id,
      profileName: row.profile_name_snapshot,
    };
    const existing = bySpaceId.get(row.space_id);
    if (!existing) {
      bySpaceId.set(
        row.space_id,
        createAccountSpaceItemDraft({
          gatewayHost: input.gatewayHost,
          includeDirectMessageProfileIds:
            input.includeDirectMessageProfileIds === true,
          includePurposes: input.includePurposes === true,
          joinedProfile,
          openProfileRankMs,
          row,
          updatedAtMs,
        })
      );
      continue;
    }

    bySpaceId.set(
      row.space_id,
      mergeAccountSpaceItemDraft({
        existing,
        joinedProfile,
        openProfileRankMs,
        row,
        updatedAtMs,
      })
    );
  }

  return Array.from(bySpaceId.values())
    .map(
      ({
        directMessagePairKey: _directMessagePairKey,
        openProfileRankMs: _openProfileRankMs,
        spaceNameSnapshot: _spaceNameSnapshot,
        ...item
      }) => item
    )
    .sort(compareAccountSpaceIndexItems)
    .slice(0, input.limit);
}

function createAccountSpaceItemDraft(input: {
  gatewayHost: string;
  includeDirectMessageProfileIds: boolean;
  includePurposes: boolean;
  joinedProfile: AccountSpaceIndexJoinedProfile;
  openProfileRankMs: number;
  row: SpaceIndexJoinedRow;
  updatedAtMs: number;
}): AccountSpaceIndexItemDraft {
  return {
    creatorKind: input.row.creator_kind ?? null,
    creatorOwnerUserId: input.row.creator_owner_user_id ?? null,
    creatorProfileId: input.row.creator_profile_id ?? null,
    creatorProfileName: input.row.creator_profile_name ?? null,
    gatewayHost: input.gatewayHost,
    joinedProfiles: [input.joinedProfile],
    directMessagePairKey: input.row.direct_message_pair_key,
    lastJoinedAt: input.joinedProfile.lastJoinedAt,
    lastSeenTs: input.row.overlay_last_seen_ts ?? input.row.last_entered_at_ms,
    openProfileRankMs: input.openProfileRankMs,
    openProfileId: input.row.membership_profile_id,
    openProfileName: input.row.profile_name_snapshot,
    organizationId: input.row.organization_id,
    pinnedAt: input.joinedProfile.pinnedAt,
    pinnedProfileIds:
      input.joinedProfile.pinnedAt === null
        ? []
        : [input.row.membership_profile_id],
    spaceCreatedAt: timestampMsToIsoOrNull(input.row.space_created_at_ms),
    spaceId: input.row.space_id,
    spaceName: input.row.space_name ?? "Untitled space",
    spaceNameSnapshot: input.row.space_name,
    ...(input.includePurposes
      ? {
          activeAgentCount: input.row.active_agent_count ?? null,
          activeHumanCount: input.row.active_human_count ?? null,
          activeMemberCount: input.row.active_member_count ?? null,
          directMessageConvertedAt: timestampMsToIsoOrNull(
            input.row.direct_message_converted_at_ms
          ),
          spacePurpose: input.row.space_purpose ?? null,
        }
      : {}),
    ...(input.includeDirectMessageProfileIds
      ? {
          directMessageProfileIds: resolveDirectMessageProfileIds({
            directMessagePairKey: input.row.direct_message_pair_key,
            spacePurpose: input.row.space_purpose,
          }),
        }
      : {}),
    spaceUpdatedAt: timestampMsToIsoOrNull(input.row.space_updated_at_ms),
    status: "active",
    updatedAt: timestampMsToIso(input.updatedAtMs),
    visibility: input.row.organization_visibility,
  };
}

function mergeAccountSpaceItemDraft(input: {
  existing: AccountSpaceIndexItemDraft;
  joinedProfile: AccountSpaceIndexJoinedProfile;
  openProfileRankMs: number;
  row: SpaceIndexJoinedRow;
  updatedAtMs: number;
}): AccountSpaceIndexItemDraft {
  // The request's selected profile is a caller/authentication input, not a
  // global "open every Space as this profile" preference. Account-scoped
  // rows keep each Space's own profile choice isolated. `lastSeenTs` is the
  // per-Space "opened as" signal; `lastJoinedAt` remains the list recency.
  const shouldUseCandidateProfile =
    input.openProfileRankMs > input.existing.openProfileRankMs;
  return {
    ...input.existing,
    joinedProfiles: mergeJoinedProfiles([
      ...input.existing.joinedProfiles,
      input.joinedProfile,
    ]),
    lastJoinedAt: resolveLatestIso(
      input.existing.lastJoinedAt,
      input.joinedProfile.lastJoinedAt
    ),
    lastSeenTs: resolveLatestNullableTimestamp(
      input.existing.lastSeenTs,
      input.row.overlay_last_seen_ts ?? input.row.last_entered_at_ms
    ),
    openProfileRankMs: Math.max(
      input.existing.openProfileRankMs,
      input.openProfileRankMs
    ),
    openProfileId: shouldUseCandidateProfile
      ? input.joinedProfile.profileId
      : input.existing.openProfileId,
    openProfileName: shouldUseCandidateProfile
      ? input.joinedProfile.profileName
      : input.existing.openProfileName,
    pinnedAt: resolveLatestNullableIso(
      input.existing.pinnedAt,
      input.joinedProfile.pinnedAt
    ),
    pinnedProfileIds:
      input.joinedProfile.pinnedAt === null
        ? input.existing.pinnedProfileIds
        : uniqueStrings([
            ...input.existing.pinnedProfileIds,
            input.row.membership_profile_id,
          ]),
    updatedAt: resolveLatestIso(
      input.existing.updatedAt,
      timestampMsToIso(input.updatedAtMs)
    ),
  };
}

function resolveDirectMessageProfileIds(input: {
  directMessagePairKey: string | null;
  spacePurpose: string | null;
}): [string, string] | null {
  if (
    input.spacePurpose !== OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE ||
    input.directMessagePairKey === null
  ) {
    return null;
  }
  const pair = input.directMessagePairKey.split(":");
  if (!(pair[0] && pair[1]) || pair.length !== 2 || pair[0] === pair[1]) {
    return null;
  }
  return [pair[0], pair[1]];
}

function resolveLatestNullableTimestamp(
  left: number | null,
  right: number | null
): number | null {
  if (left === null || right === null) {
    return left ?? right;
  }
  return Math.max(left, right);
}

function partitionAccountSpaceIndexItems(
  items: readonly AccountSpaceIndexItem[]
): Omit<AccountSpaceIndexResponse, "recentlyDeletedItems"> {
  return {
    pinnedItems: items.filter((item) => item.pinnedAt !== null),
    spaceItems: items.filter((item) => item.pinnedAt === null),
  };
}

function resolveOpenProfileRankMs(
  row: SpaceIndexJoinedRow,
  joinedAtMs: number
): number {
  return row.overlay_last_seen_ts ?? row.last_entered_at_ms ?? joinedAtMs;
}

function mergeJoinedProfiles(
  profiles: readonly AccountSpaceIndexJoinedProfile[]
): AccountSpaceIndexJoinedProfile[] {
  const byProfileId = new Map<string, AccountSpaceIndexJoinedProfile>();
  for (const profile of profiles) {
    const existing = byProfileId.get(profile.profileId);
    if (!existing || compareJoinedProfiles(profile, existing) < 0) {
      byProfileId.set(profile.profileId, profile);
    }
  }
  return Array.from(byProfileId.values()).sort(compareJoinedProfiles);
}

function compareJoinedProfiles(
  left: AccountSpaceIndexJoinedProfile,
  right: AccountSpaceIndexJoinedProfile
): number {
  const joinedDelta =
    Date.parse(right.lastJoinedAt) - Date.parse(left.lastJoinedAt);
  if (joinedDelta !== 0) {
    return joinedDelta;
  }
  const nameDelta = left.profileName.localeCompare(right.profileName, "en-US");
  if (nameDelta !== 0) {
    return nameDelta;
  }
  return left.profileId.localeCompare(right.profileId, "en-US");
}

function compareAccountSpaceIndexItems(
  left: AccountSpaceIndexItem,
  right: AccountSpaceIndexItem
): number {
  const pinnedDelta =
    resolveTimestampOrZero(right.pinnedAt) -
    resolveTimestampOrZero(left.pinnedAt);
  if (pinnedDelta !== 0) {
    return pinnedDelta;
  }
  const joinedDelta =
    Date.parse(right.lastJoinedAt) - Date.parse(left.lastJoinedAt);
  if (joinedDelta !== 0) {
    return joinedDelta;
  }
  const nameDelta = left.spaceName.localeCompare(right.spaceName, "en-US");
  if (nameDelta !== 0) {
    return nameDelta;
  }
  return left.spaceId.localeCompare(right.spaceId, "en-US");
}

function resolveLatestNullableIso(
  left: string | null,
  right: string | null
): string | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return resolveLatestIso(left, right);
}

function resolveTimestampOrZero(value: string | null): number {
  if (value === null) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function readProjectionEventMemberCount(payloadJson: string): number | null {
  try {
    const payload = JSON.parse(payloadJson) as { memberCount?: unknown };
    return typeof payload.memberCount === "number" &&
      Number.isFinite(payload.memberCount)
      ? payload.memberCount
      : null;
  } catch {
    return null;
  }
}

function parseIsoTimestampMs(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`invalid ${field}`);
  }
  return Math.trunc(timestamp);
}

function parseOptionalIsoTimestampMs(
  value: string | null | undefined
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return parseIsoTimestampMs(value, "timestamp");
}

function timestampMsToIso(value: number): string {
  return new Date(value).toISOString();
}

function timestampMsToIsoOrNull(value: number | null): string | null {
  return typeof value === "number" ? timestampMsToIso(value) : null;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized =
    typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSpaceName(value: unknown): string {
  return normalizeOptionalText(value) ?? "Untitled space";
}

function normalizeOptionalNonNegativeInteger(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("expected non-negative integer");
  }
  return value;
}

function normalizeRequiredText(value: unknown, field: string): string {
  const normalized =
    typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (normalized.length === 0) {
    throw new Error(`${field} required`);
  }
  return normalized;
}

function normalizeOrganizationVisibility(
  value: unknown
): SpaceOrganizationVisibility {
  if (value === "public" || value === "private") {
    return value;
  }
  throw new Error("organizationVisibility invalid");
}

function resolveLatestIso(left: string, right: string): string {
  return Date.parse(right) > Date.parse(left) ? right : left;
}

export type WriteSpaceIndexMembershipOverlayInput = {
  db: D1Database;
  spaceId: string;
  profileId: string;
  gatewayHost: string;
  // false mirrors the old JOIN's `status = 'active'` filter: a non-active
  // history row contributes no overlay, so the projected columns are cleared.
  active: boolean;
  pinnedAtMs: number | null;
  lastJoinedAtMs: number | null;
  lastSeenTs: number | null;
  updatedAtMs: number | null;
};

// Projects one profile-history overlay change onto its membership row
// (physical-db-split.md P0.3). The overlay is projection data: when the
// membership row does not exist yet (projection lag on first join), the
// write is dropped and the next overlay event or index rebuild converges it.
export async function writeSpaceIndexMembershipOverlay(
  input: WriteSpaceIndexMembershipOverlayInput
): Promise<{ updated: boolean }> {
  const result = input.active
    ? await input.db
        .prepare(
          `
            UPDATE space_index_memberships SET
              overlay_gateway_host = ?,
              overlay_pinned_at_ms = ?,
              overlay_last_joined_at_ms = ?,
              overlay_last_seen_ts = ?,
              overlay_updated_at_ms = ?
            WHERE space_id = ? AND profile_id = ?
          `
        )
        .bind(
          input.gatewayHost,
          input.pinnedAtMs,
          input.lastJoinedAtMs,
          input.lastSeenTs,
          input.updatedAtMs,
          input.spaceId,
          input.profileId
        )
        .run()
    : await input.db
        .prepare(
          `
            UPDATE space_index_memberships SET
              overlay_gateway_host = NULL,
              overlay_pinned_at_ms = NULL,
              overlay_last_joined_at_ms = NULL,
              overlay_last_seen_ts = NULL,
              overlay_updated_at_ms = NULL
            WHERE space_id = ? AND profile_id = ?
          `
        )
        .bind(input.spaceId, input.profileId)
        .run();
  return { updated: Number(result.meta?.changes ?? 0) > 0 };
}
