import {
  agentProfileCreationApprovalPolicySchema,
  agentProfileCreationRequestSourceSchema,
  agentProfileCreationRequestStatusReasonSchema,
  agentProfileCreationRequestStatusSchema,
  agentProfileCreationSessionStrategySchema,
} from "@openmeld/schemas";
import type {
  AgentProfileCreationApprovalPreferenceRecord,
  AgentProfileCreationRequestRecord,
  AgentProfileCreationRequestRepository,
} from "./agent-profile-creation-request-service";

type RequestRow = {
  actor_profile_id: string;
  completed_at: number | null;
  created_agent_profile_id: string | null;
  created_at: number;
  decided_at: number | null;
  id: string;
  idempotency_key: string;
  native_session_id: string | null;
  organization_id: string;
  profile_name: string;
  requested_space_id: string | null;
  requester_user_id: string;
  session_strategy: string;
  source: string;
  status: string;
  status_reason: string;
  target_owner_user_id: string;
  updated_at: number;
};

type PreferenceRow = {
  existing_session_policy: string;
  new_session_policy: string;
  organization_id: string;
  updated_at: number;
  user_id: string;
};

const REQUEST_COLUMNS = `
  id,
  organization_id,
  requester_user_id,
  actor_profile_id,
  target_owner_user_id,
  source,
  profile_name,
  session_strategy,
  native_session_id,
  requested_space_id,
  idempotency_key,
  status,
  status_reason,
  created_agent_profile_id,
  decided_at,
  completed_at,
  created_at,
  updated_at
`;

export function createD1AgentProfileCreationRequestRepository(
  db: D1Database
): AgentProfileCreationRequestRepository {
  const getById = async (input: {
    organizationId: string;
    requestId: string;
  }): Promise<AgentProfileCreationRequestRecord | null> => {
    const row = await db
      .prepare(
        `
          SELECT ${REQUEST_COLUMNS}
          FROM agent_profile_creation_requests
          WHERE organization_id = ?
            AND id = ?
          LIMIT 1
        `
      )
      .bind(input.organizationId, input.requestId)
      .first<RequestRow>();
    return row ? toRequestRecord(row) : null;
  };

  return {
    findByIdempotencyKey: async (input) => {
      const row = await db
        .prepare(
          `
            SELECT ${REQUEST_COLUMNS}
            FROM agent_profile_creation_requests
            WHERE organization_id = ?
              AND requester_user_id = ?
              AND idempotency_key = ?
            LIMIT 1
          `
        )
        .bind(input.organizationId, input.requesterUserId, input.idempotencyKey)
        .first<RequestRow>();
      return row ? toRequestRecord(row) : null;
    },

    getById,

    getPreference: async (input) => {
      const row = await db
        .prepare(
          `
            SELECT
              organization_id,
              user_id,
              new_session_policy,
              existing_session_policy,
              updated_at
            FROM agent_profile_creation_approval_preferences
            WHERE organization_id = ?
              AND user_id = ?
            LIMIT 1
          `
        )
        .bind(input.organizationId, input.userId)
        .first<PreferenceRow>();
      return row ? toPreferenceRecord(row) : null;
    },

    insert: async (record) => {
      await db
        .prepare(
          `
            INSERT INTO agent_profile_creation_requests (
              ${REQUEST_COLUMNS}
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .bind(
          record.id,
          record.organizationId,
          record.requesterUserId,
          record.actorProfileId,
          record.targetOwnerUserId,
          record.source,
          record.profileName,
          record.sessionStrategy,
          record.nativeSessionId,
          record.requestedSpaceId,
          record.idempotencyKey,
          record.status,
          record.statusReason,
          record.createdAgentProfileId,
          record.decidedAtMs,
          record.completedAtMs,
          record.createdAtMs,
          record.updatedAtMs
        )
        .run();
      return record;
    },

    listForParticipant: async (input) => {
      const result = await db
        .prepare(
          `
            SELECT ${REQUEST_COLUMNS}
            FROM agent_profile_creation_requests
            WHERE organization_id = ?
              AND (requester_user_id = ? OR target_owner_user_id = ?)
            ORDER BY updated_at DESC, id DESC
            LIMIT 200
          `
        )
        .bind(input.organizationId, input.userId, input.userId)
        .all<RequestRow>();
      return result.results.map(toRequestRecord);
    },

    transition: async (input) => {
      if (input.expectedStatuses.length === 0) {
        return null;
      }
      const current = await db
        .prepare(
          `
            SELECT ${REQUEST_COLUMNS}
            FROM agent_profile_creation_requests
            WHERE id = ?
            LIMIT 1
          `
        )
        .bind(input.requestId)
        .first<RequestRow>();
      if (!current) {
        return null;
      }
      const record = { ...toRequestRecord(current), ...input.update };
      const placeholders = input.expectedStatuses.map(() => "?").join(", ");
      const result = await db
        .prepare(
          `
            UPDATE agent_profile_creation_requests
            SET
              status = ?,
              status_reason = ?,
              created_agent_profile_id = ?,
              decided_at = ?,
              completed_at = ?,
              updated_at = ?
            WHERE id = ?
              AND status IN (${placeholders})
          `
        )
        .bind(
          record.status,
          record.statusReason,
          record.createdAgentProfileId,
          record.decidedAtMs,
          record.completedAtMs,
          record.updatedAtMs,
          input.requestId,
          ...input.expectedStatuses
        )
        .run();
      if (Number(result.meta.changes ?? 0) !== 1) {
        return null;
      }
      return await getById({
        organizationId: record.organizationId,
        requestId: record.id,
      });
    },

    upsertPreference: async (input) => {
      const id = `apcp_${crypto.randomUUID()}`;
      await db
        .prepare(
          `
            INSERT INTO agent_profile_creation_approval_preferences (
              id,
              organization_id,
              user_id,
              new_session_policy,
              existing_session_policy,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, user_id) DO UPDATE SET
              new_session_policy = excluded.new_session_policy,
              existing_session_policy = excluded.existing_session_policy,
              updated_at = excluded.updated_at
          `
        )
        .bind(
          id,
          input.organizationId,
          input.userId,
          input.newSessionPolicy,
          input.existingSessionPolicy,
          input.nowMs,
          input.nowMs
        )
        .run();
      const row = await db
        .prepare(
          `
            SELECT
              organization_id,
              user_id,
              new_session_policy,
              existing_session_policy,
              updated_at
            FROM agent_profile_creation_approval_preferences
            WHERE organization_id = ?
              AND user_id = ?
            LIMIT 1
          `
        )
        .bind(input.organizationId, input.userId)
        .first<PreferenceRow>();
      if (!row) {
        throw new Error(
          "Agent Profile creation approval preference write did not produce a row."
        );
      }
      return toPreferenceRecord(row);
    },
  };
}

function toRequestRecord(row: RequestRow): AgentProfileCreationRequestRecord {
  return {
    actorProfileId: requireText(row.actor_profile_id, "actor_profile_id"),
    completedAtMs: toNullableTimestamp(row.completed_at, "completed_at"),
    createdAgentProfileId: toNullableText(row.created_agent_profile_id),
    createdAtMs: requireTimestamp(row.created_at, "created_at"),
    decidedAtMs: toNullableTimestamp(row.decided_at, "decided_at"),
    id: requireText(row.id, "id"),
    idempotencyKey: requireText(row.idempotency_key, "idempotency_key"),
    nativeSessionId: toNullableText(row.native_session_id),
    organizationId: requireText(row.organization_id, "organization_id"),
    profileName: requireText(row.profile_name, "profile_name"),
    requestedSpaceId: toNullableText(row.requested_space_id),
    requesterUserId: requireText(row.requester_user_id, "requester_user_id"),
    sessionStrategy: agentProfileCreationSessionStrategySchema.parse(
      row.session_strategy
    ),
    source: agentProfileCreationRequestSourceSchema.parse(row.source),
    status: agentProfileCreationRequestStatusSchema.parse(row.status),
    statusReason: agentProfileCreationRequestStatusReasonSchema.parse(
      row.status_reason
    ),
    targetOwnerUserId: requireText(
      row.target_owner_user_id,
      "target_owner_user_id"
    ),
    updatedAtMs: requireTimestamp(row.updated_at, "updated_at"),
  };
}

function toPreferenceRecord(
  row: PreferenceRow
): AgentProfileCreationApprovalPreferenceRecord {
  return {
    existingSessionPolicy: agentProfileCreationApprovalPolicySchema.parse(
      row.existing_session_policy
    ),
    newSessionPolicy: agentProfileCreationApprovalPolicySchema.parse(
      row.new_session_policy
    ),
    organizationId: requireText(row.organization_id, "organization_id"),
    updatedAtMs: requireTimestamp(row.updated_at, "updated_at"),
    userId: requireText(row.user_id, "user_id"),
  };
}

function requireText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new Error(`Invalid Agent Profile creation request ${field}.`);
  }
  return text;
}

function toNullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function requireTimestamp(value: unknown, field: string): number {
  const timestamp = Number(value);
  if (!(Number.isSafeInteger(timestamp) && timestamp >= 0)) {
    throw new Error(`Invalid Agent Profile creation request ${field}.`);
  }
  return timestamp;
}

function toNullableTimestamp(value: unknown, field: string): number | null {
  return value === null || value === undefined
    ? null
    : requireTimestamp(value, field);
}
