import type {
  PoolClient,
  PostgresDatabase,
  QueryConfig,
  QueryResult,
  QueryResultRow,
} from "@openmeld/db/postgresql";
import type {
  AgentAccessGranteeKind,
  AgentAccessRequestKind,
  AgentAccessRequestStatus,
} from "@openmeld/schemas";

/** The database or the client of an open transaction. */
export type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    query: QueryConfig
  ): Promise<QueryResult<T>>;
};

/** A personal Agent Profile whose owner decides who may use it. */
export type AgentAccessTarget = {
  profileId: string;
  profileName: string;
  // Null for a personal Profile not assigned to a MemberAgent yet.
  memberAgentId: string | null;
  organizationId: string;
  ownerUserId: string;
  ownerName: string;
};

export type AgentAccessRoot = {
  profileId: string;
  userId: string;
  name: string;
  kind: AgentAccessGranteeKind;
};

export type AgentAccessRequestRecord = {
  id: string;
  organizationId: string;
  kind: AgentAccessRequestKind;
  spaceId: string;
  sourceSignalId: string | null;
  agentProfileId: string;
  memberAgentId: string | null;
  ownerUserId: string;
  requesterUserId: string;
  requesterProfileId: string;
  requesterKind: AgentAccessGranteeKind;
  status: AgentAccessRequestStatus;
  createdAtMs: number;
  decidedAtMs: number | null;
  decidedByUserId: string | null;
  appliedAtMs: number | null;
};

export type AgentAccessRequestNames = {
  agentProfileName: string;
  ownerName: string;
  requesterName: string;
};

export type AgentProfileAccessGrantRecord = {
  id: string;
  organizationId: string;
  profileId: string;
  granteeUserId: string;
  granteeName: string;
  granteeKind: AgentAccessGranteeKind;
  scope: "always" | "once";
  requestId: string | null;
  spaceId: string | null;
  grantedAtMs: number;
  revokedAtMs: number | null;
};

const REQUEST_COLUMNS = `id, organization_id, kind, space_id, source_signal_id,
  agent_profile_id, member_agent_id, owner_user_id, requester_user_id,
  requester_profile_id, requester_kind, status, created_at_ms, decided_at_ms,
  decided_by_user_id, applied_at_ms`;

type RequestRow = {
  id: string;
  organization_id: string;
  kind: AgentAccessRequestKind;
  space_id: string;
  source_signal_id: string | null;
  agent_profile_id: string;
  member_agent_id: string | null;
  owner_user_id: string;
  requester_user_id: string;
  requester_profile_id: string;
  requester_kind: AgentAccessGranteeKind;
  status: AgentAccessRequestStatus;
  created_at_ms: string | number;
  decided_at_ms: string | number | null;
  decided_by_user_id: string | null;
  applied_at_ms: string | number | null;
};

function toRequestRecord(row: RequestRow): AgentAccessRequestRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    kind: row.kind,
    spaceId: row.space_id,
    sourceSignalId: row.source_signal_id,
    agentProfileId: row.agent_profile_id,
    memberAgentId: row.member_agent_id,
    ownerUserId: row.owner_user_id,
    requesterUserId: row.requester_user_id,
    requesterProfileId: row.requester_profile_id,
    requesterKind: row.requester_kind,
    status: row.status,
    createdAtMs: Number(row.created_at_ms),
    decidedAtMs: row.decided_at_ms === null ? null : Number(row.decided_at_ms),
    decidedByUserId: row.decided_by_user_id,
    appliedAtMs: row.applied_at_ms === null ? null : Number(row.applied_at_ms),
  };
}

/**
 * The personal Agents among `profileIds`: active Agent Profiles with an
 * owner, assigned to a MemberAgent or not, never a managed or Center Agent.
 */
export async function readAgentAccessTargets(input: {
  db: Queryable;
  organizationId: string;
  profileIds: readonly string[];
}): Promise<Map<string, AgentAccessTarget>> {
  const targets = new Map<string, AgentAccessTarget>();
  if (input.profileIds.length === 0) {
    return targets;
  }
  const result = await input.db.query<{
    profile_id: string;
    profile_name: string;
    member_agent_id: string | null;
    organization_id: string;
    owner_user_id: string;
    owner_name: string | null;
  }>({
    text: `SELECT profile.profile_id, profile.profile_name,
        member_agent.id AS member_agent_id, profile.organization_id,
        profile.owner_user_id, owner.name AS owner_name
      FROM "openmeld"."openmeld_profiles" AS profile
      LEFT JOIN "openmeld"."member_agents" AS member_agent
        ON member_agent.id = profile.member_agent_id
        AND member_agent.organization_id = profile.organization_id
        AND member_agent.owner_user_id = profile.owner_user_id
      INNER JOIN "openmeld"."users" AS owner ON owner.id = profile.owner_user_id
      LEFT JOIN "openmeld"."center_agent_designations" AS designation
        ON designation.organization_id = profile.organization_id
        AND designation.agent_profile_id = profile.profile_id
      WHERE profile.profile_id = ANY($2::text[])
        AND profile.organization_id = $1
        AND profile.profile_kind = 'agent'
        AND profile.status = 'active'
        AND profile.managed_role IS NULL
        AND designation.agent_profile_id IS NULL`,
    values: [input.organizationId, [...new Set(input.profileIds)]],
  });
  for (const row of result.rows) {
    targets.set(row.profile_id, {
      profileId: row.profile_id,
      profileName: row.profile_name,
      memberAgentId: row.member_agent_id,
      organizationId: row.organization_id,
      ownerUserId: row.owner_user_id,
      ownerName: row.owner_name?.trim() || "the owner",
    });
  }
  return targets;
}

/**
 * The human behind a root Profile and whether they belong to the
 * Organization. Null: not a human with an account (no root).
 */
export async function readAgentAccessRoot(input: {
  db: Queryable;
  organizationId: string;
  profileId: string;
}): Promise<AgentAccessRoot | null> {
  const result = await input.db.query<{
    user_id: string;
    name: string | null;
    member: boolean;
  }>({
    text: `SELECT profile.owner_user_id AS user_id, account.name,
        EXISTS (
          SELECT 1 FROM "openmeld"."members" AS membership
          WHERE membership.organization_id = $1
            AND membership.user_id = profile.owner_user_id
        ) AS member
      FROM "openmeld"."openmeld_profiles" AS profile
      INNER JOIN "openmeld"."users" AS account ON account.id = profile.owner_user_id
      WHERE profile.profile_id = $2 AND profile.profile_kind = 'human'
        AND profile.status = 'active'`,
    values: [input.organizationId, input.profileId],
  });
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    profileId: input.profileId,
    userId: row.user_id,
    name: row.name?.trim() || "Someone",
    kind: row.member ? "member" : "external",
  };
}

/** Active consent of one grantee for one Profile: standing, or for this Session. */
export async function readActiveAgentAccessGrants(input: {
  db: Queryable;
  granteeUserId: string;
  profileId: string;
  spaceId: string;
}): Promise<{ always: boolean; session: boolean }> {
  const result = await input.db.query<{ scope: "always" | "once" }>({
    text: `SELECT scope FROM "openmeld"."agent_profile_access_grants"
      WHERE profile_id = $1 AND grantee_user_id = $2 AND revoked_at_ms IS NULL
        AND (scope = 'always' OR (scope = 'once' AND grantee_kind = 'member'
          AND space_id = $3 AND source_signal_id IS NULL))`,
    values: [input.profileId, input.granteeUserId, input.spaceId],
  });
  return {
    always: result.rows.some((row) => row.scope === "always"),
    session: result.rows.some((row) => row.scope === "once"),
  };
}

/** Idempotent: the Space retries the same request id until it is stored. */
export async function insertAgentAccessRequest(input: {
  db: Queryable;
  request: Omit<
    AgentAccessRequestRecord,
    "status" | "decidedAtMs" | "decidedByUserId" | "appliedAtMs"
  >;
}): Promise<AgentAccessRequestRecord> {
  const { request } = input;
  await input.db.query({
    text: `INSERT INTO "openmeld"."agent_access_requests" (
        id, organization_id, kind, space_id, source_signal_id, agent_profile_id,
        member_agent_id, owner_user_id, requester_user_id, requester_profile_id,
        requester_kind, status, created_at_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)
      ON CONFLICT (id) DO NOTHING`,
    values: [
      request.id,
      request.organizationId,
      request.kind,
      request.spaceId,
      request.sourceSignalId,
      request.agentProfileId,
      request.memberAgentId,
      request.ownerUserId,
      request.requesterUserId,
      request.requesterProfileId,
      request.requesterKind,
      request.createdAtMs,
    ],
  });
  const stored = await readAgentAccessRequest({
    db: input.db,
    requestId: request.id,
  });
  if (
    !stored ||
    stored.spaceId !== request.spaceId ||
    stored.agentProfileId !== request.agentProfileId ||
    stored.requesterUserId !== request.requesterUserId
  ) {
    throw new Error("agent_access.request_identity_conflict");
  }
  return stored;
}

export async function readAgentAccessRequest(input: {
  db: Queryable;
  requestId: string;
  forUpdate?: boolean;
}): Promise<AgentAccessRequestRecord | null> {
  const result = await input.db.query<RequestRow>({
    text: `SELECT ${REQUEST_COLUMNS} FROM "openmeld"."agent_access_requests"
      WHERE id = $1${input.forUpdate ? " FOR UPDATE" : ""}`,
    values: [input.requestId],
  });
  const row = result.rows[0];
  return row ? toRequestRecord(row) : null;
}

export async function readAgentAccessRequestNames(input: {
  db: Queryable;
  requests: readonly AgentAccessRequestRecord[];
}): Promise<Map<string, AgentAccessRequestNames>> {
  const names = new Map<string, AgentAccessRequestNames>();
  if (input.requests.length === 0) {
    return names;
  }
  const result = await input.db.query<{
    id: string;
    agent_profile_name: string | null;
    owner_name: string | null;
    requester_name: string | null;
  }>({
    text: `SELECT request.id, agent.profile_name AS agent_profile_name,
        owner.name AS owner_name, requester.name AS requester_name
      FROM "openmeld"."agent_access_requests" AS request
      LEFT JOIN "openmeld"."openmeld_profiles" AS agent ON agent.profile_id = request.agent_profile_id
      LEFT JOIN "openmeld"."users" AS owner ON owner.id = request.owner_user_id
      LEFT JOIN "openmeld"."users" AS requester ON requester.id = request.requester_user_id
      WHERE request.id = ANY($1::text[])`,
    values: [input.requests.map((request) => request.id)],
  });
  for (const row of result.rows) {
    names.set(row.id, {
      agentProfileName: row.agent_profile_name?.trim() || "Agent",
      ownerName: row.owner_name?.trim() || "the owner",
      requesterName: row.requester_name?.trim() || "Someone",
    });
  }
  return names;
}

export async function listAgentAccessRequests(input: {
  db: Queryable;
  organizationId: string;
  viewerUserId: string;
  role?: "owner" | "requester";
  spaceId?: string;
  pendingOnly?: boolean;
  limit: number;
}): Promise<AgentAccessRequestRecord[]> {
  const values: unknown[] = [input.organizationId, input.viewerUserId];
  const roleClause = {
    owner: "owner_user_id = $2",
    requester: "requester_user_id = $2",
    any: "(owner_user_id = $2 OR requester_user_id = $2)",
  }[input.role ?? "any"];
  let spaceClause = "";
  if (input.spaceId) {
    values.push(input.spaceId);
    spaceClause = ` AND space_id = $${values.length}`;
  }
  values.push(input.limit);
  const result = await input.db.query<RequestRow>({
    text: `SELECT ${REQUEST_COLUMNS} FROM "openmeld"."agent_access_requests"
      WHERE organization_id = $1 AND ${roleClause}${spaceClause}
        ${input.pendingOnly ? "AND status = 'pending'" : ""}
      ORDER BY created_at_ms DESC, id DESC LIMIT $${values.length}`,
    values,
  });
  return result.rows.map(toRequestRecord);
}

/** Moves a request out of `pending` once. Null: it was no longer pending. */
export async function transitionPendingAgentAccessRequest(input: {
  db: Queryable;
  requestId: string;
  status: Exclude<AgentAccessRequestStatus, "pending">;
  decidedByUserId: string | null;
  nowMs: number;
}): Promise<AgentAccessRequestRecord | null> {
  const result = await input.db.query<RequestRow>({
    text: `UPDATE "openmeld"."agent_access_requests"
      SET status = $2, decided_at_ms = $3, decided_by_user_id = $4
      WHERE id = $1 AND status = 'pending'
      RETURNING ${REQUEST_COLUMNS}`,
    values: [input.requestId, input.status, input.nowMs, input.decidedByUserId],
  });
  const row = result.rows[0];
  return row ? toRequestRecord(row) : null;
}

/**
 * The Space could not apply an owner's decision because its bound message
 * changed or is gone; the request is void instead.
 */
export async function voidUnappliedAgentAccessRequest(input: {
  db: Queryable;
  requestId: string;
  nowMs: number;
}): Promise<AgentAccessRequestRecord | null> {
  const result = await input.db.query<RequestRow>({
    text: `UPDATE "openmeld"."agent_access_requests"
      SET status = 'voided', decided_at_ms = COALESCE(decided_at_ms, $2)
      WHERE id = $1 AND applied_at_ms IS NULL
        AND status IN ('pending', 'allowed', 'joined')
      RETURNING ${REQUEST_COLUMNS}`,
    values: [input.requestId, input.nowMs],
  });
  const row = result.rows[0];
  return row ? toRequestRecord(row) : null;
}

/**
 * A void request was never applied, so the one-time consent given for it
 * must not cover the next message. A standing grant is about the person,
 * not the message, and stays.
 */
export async function revokeVoidedRequestOnceGrants(input: {
  db: Queryable;
  requestId: string;
  nowMs: number;
}): Promise<void> {
  await input.db.query({
    text: `UPDATE "openmeld"."agent_profile_access_grants" AS grant_row
      SET revoked_at_ms = GREATEST($2, grant_row.granted_at_ms)
      FROM "openmeld"."agent_access_requests" AS request
      WHERE grant_row.request_id = $1 AND request.id = grant_row.request_id
        AND request.status = 'voided' AND grant_row.scope = 'once'
        AND grant_row.revoked_at_ms IS NULL`,
    values: [input.requestId, input.nowMs],
  });
}

export async function markAgentAccessRequestApplied(input: {
  db: Queryable;
  requestId: string;
  nowMs: number;
}): Promise<void> {
  await input.db.query({
    text: `UPDATE "openmeld"."agent_access_requests"
      SET applied_at_ms = COALESCE(applied_at_ms, $2)
      WHERE id = $1 AND status <> 'pending'`,
    values: [input.requestId, input.nowMs],
  });
}

export async function insertAgentProfileAccessGrant(input: {
  db: Queryable;
  grant: {
    id: string;
    organizationId: string;
    profileId: string;
    granteeUserId: string;
    granteeKind: AgentAccessGranteeKind;
    scope: "always" | "once";
    requestId: string;
    spaceId: string | null;
    sourceSignalId: string | null;
    grantedByUserId: string;
    grantedAtMs: number;
  };
}): Promise<void> {
  const { grant } = input;
  await input.db.query({
    text: `INSERT INTO "openmeld"."agent_profile_access_grants" (
        id, organization_id, profile_id, grantee_user_id, grantee_kind, scope,
        request_id, space_id, source_signal_id, granted_by_user_id, granted_at_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT DO NOTHING`,
    values: [
      grant.id,
      grant.organizationId,
      grant.profileId,
      grant.granteeUserId,
      grant.granteeKind,
      grant.scope,
      grant.requestId,
      grant.spaceId,
      grant.sourceSignalId,
      grant.grantedByUserId,
      grant.grantedAtMs,
    ],
  });
}

/** The grantee's own standing grants on active Agent profiles, newest first. */
export async function listActiveAlwaysAgentAccessGrantsForGrantee(input: {
  db: Queryable;
  organizationId: string;
  granteeUserId: string;
  limit: number;
}): Promise<{ profileId: string; grantedAtMs: number }[]> {
  const result = await input.db.query<{
    profile_id: string;
    granted_at_ms: string | number;
  }>({
    text: `SELECT grant_row.profile_id, MAX(grant_row.granted_at_ms) AS granted_at_ms
      FROM "openmeld"."agent_profile_access_grants" AS grant_row
      INNER JOIN "openmeld"."openmeld_profiles" AS profile
        ON profile.profile_id = grant_row.profile_id
        AND profile.organization_id = grant_row.organization_id
        AND profile.profile_kind = 'agent' AND profile.status = 'active'
      WHERE grant_row.organization_id = $1 AND grant_row.grantee_user_id = $2
        AND grant_row.scope = 'always' AND grant_row.revoked_at_ms IS NULL
      GROUP BY grant_row.profile_id
      ORDER BY MAX(grant_row.granted_at_ms) DESC, grant_row.profile_id
      LIMIT $3`,
    values: [input.organizationId, input.granteeUserId, input.limit],
  });
  return result.rows.map((row) => ({
    profileId: row.profile_id,
    grantedAtMs: Number(row.granted_at_ms),
  }));
}

export async function listActiveAgentProfileAccessGrants(input: {
  db: Queryable;
  profileId: string;
  limit: number;
}): Promise<AgentProfileAccessGrantRecord[]> {
  const result = await input.db.query<{
    id: string;
    organization_id: string;
    profile_id: string;
    grantee_user_id: string;
    grantee_name: string | null;
    grantee_kind: AgentAccessGranteeKind;
    scope: "always" | "once";
    request_id: string | null;
    space_id: string | null;
    granted_at_ms: string | number;
    revoked_at_ms: string | number | null;
  }>({
    text: `SELECT grant_row.id, grant_row.organization_id, grant_row.profile_id,
        grant_row.grantee_user_id, grantee.name AS grantee_name,
        grant_row.grantee_kind, grant_row.scope, grant_row.request_id,
        grant_row.space_id, grant_row.granted_at_ms, grant_row.revoked_at_ms
      FROM "openmeld"."agent_profile_access_grants" AS grant_row
      INNER JOIN "openmeld"."users" AS grantee ON grantee.id = grant_row.grantee_user_id
      WHERE grant_row.profile_id = $1 AND grant_row.revoked_at_ms IS NULL
      ORDER BY grant_row.granted_at_ms DESC, grant_row.id DESC
      LIMIT $2`,
    values: [input.profileId, input.limit],
  });
  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    profileId: row.profile_id,
    granteeUserId: row.grantee_user_id,
    granteeName: row.grantee_name?.trim() || "Someone",
    granteeKind: row.grantee_kind,
    scope: row.scope,
    requestId: row.request_id,
    spaceId: row.space_id,
    grantedAtMs: Number(row.granted_at_ms),
    revokedAtMs: row.revoked_at_ms === null ? null : Number(row.revoked_at_ms),
  }));
}

/** Revokes one active grant of `profileId`. Null: none such. */
export async function revokeAgentProfileAccessGrant(input: {
  db: Queryable;
  grantId: string;
  profileId: string;
  revokedByUserId: string;
  nowMs: number;
}): Promise<{ id: string; revokedAtMs: number } | null> {
  const result = await input.db.query<{ id: string; revoked_at_ms: string }>({
    text: `UPDATE "openmeld"."agent_profile_access_grants"
      SET revoked_at_ms = GREATEST($3, granted_at_ms), revoked_by_user_id = $4
      WHERE id = $1 AND profile_id = $2 AND revoked_at_ms IS NULL
      RETURNING id, revoked_at_ms`,
    values: [
      input.grantId,
      input.profileId,
      input.nowMs,
      input.revokedByUserId,
    ],
  });
  const row = result.rows[0];
  return row ? { id: row.id, revokedAtMs: Number(row.revoked_at_ms) } : null;
}

export function asQueryable(db: PostgresDatabase | PoolClient): Queryable {
  return db as Queryable;
}
