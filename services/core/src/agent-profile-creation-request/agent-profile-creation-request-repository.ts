import {
  agentProfileCreationApprovalPolicySchema,
  agentProfileCreationConfigurationSchema,
  agentProfileCreationRequestSourceSchema,
  agentProfileCreationRequestStatusReasonSchema,
  agentProfileCreationRequestStatusSchema,
  agentProfileCreationSessionStrategySchema,
} from "@openmeld/schemas";
import type {
  AgentProfileCreationApprovalPreferenceRecord,
  AgentProfileCreationRequestInboxProjectionRecord,
  AgentProfileCreationRequestRecord,
  AgentProfileCreationRequestRepository,
} from "./agent-profile-creation-request-service";

type RequestRow = {
  actor_profile_id: string;
  completed_at: number | null;
  configuration_json: string;
  created_agent_profile_id: string | null;
  created_at: number;
  decided_at: number | null;
  id: string;
  idempotency_key: string;
  failure_message: string | null;
  native_session_id: string | null;
  organization_id: string;
  profile_creation_attempt: number;
  profile_creation_started_at: number | null;
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

type InboxProjectionRow = RequestRow & {
  inbox_projection_attempt_count: number;
  inbox_projection_generation: number;
  inbox_projection_last_error: string | null;
  inbox_projection_next_retry_at: number | null;
  inbox_projection_operation: string;
  inbox_projection_status: string;
};

const REQUEST_COLUMNS = `
  id,
  organization_id,
  requester_user_id,
  actor_profile_id,
  target_owner_user_id,
  source,
  profile_name,
  configuration_json,
  session_strategy,
  native_session_id,
  requested_space_id,
  idempotency_key,
  status,
  status_reason,
  created_agent_profile_id,
  failure_message,
  decided_at,
  completed_at,
  profile_creation_attempt,
  profile_creation_started_at,
  created_at,
  updated_at
`;

const INBOX_PROJECTION_COLUMNS = `
  inbox_projection_operation,
  inbox_projection_generation,
  inbox_projection_status,
  inbox_projection_attempt_count,
  inbox_projection_last_error,
  inbox_projection_next_retry_at
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

  const reopenNewerCompletedInboxProjection = async (input: {
    generation: number;
    requestId: string;
  }): Promise<void> => {
    await db
      .prepare(
        `
          UPDATE agent_profile_creation_requests
          SET
            inbox_projection_status = 'pending',
            inbox_projection_last_error = NULL,
            inbox_projection_next_retry_at = NULL,
            inbox_projection_completed_at = NULL
          WHERE id = ?
            AND inbox_projection_generation > ?
            AND inbox_projection_status = 'completed'
        `
      )
      .bind(input.requestId, input.generation)
      .run();
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

    getInboxProjectionByRequestId: async (requestId) => {
      const row = await db
        .prepare(
          `
            SELECT ${REQUEST_COLUMNS}, ${INBOX_PROJECTION_COLUMNS}
            FROM agent_profile_creation_requests
            WHERE id = ?
              AND inbox_projection_operation IS NOT NULL
            LIMIT 1
          `
        )
        .bind(requestId)
        .first<InboxProjectionRow>();
      return row ? toInboxProjectionRecord(row) : null;
    },

    listDueInboxProjections: async (input) => {
      const result = await db
        .prepare(
          `
            SELECT ${REQUEST_COLUMNS}, ${INBOX_PROJECTION_COLUMNS}
            FROM agent_profile_creation_requests
            WHERE inbox_projection_status IN ('pending', 'failed')
              AND (
                inbox_projection_next_retry_at IS NULL
                OR inbox_projection_next_retry_at <= ?
              )
            ORDER BY updated_at ASC, id ASC
            LIMIT ?
          `
        )
        .bind(input.nowMs, Math.max(1, input.limit))
        .all<InboxProjectionRow>();
      return result.results.map(toInboxProjectionRecord);
    },

    listStaleProfileCreations: async (input) => {
      const result = await db
        .prepare(
          `
            SELECT ${REQUEST_COLUMNS}
            FROM agent_profile_creation_requests
            WHERE status = 'approved'
              AND (
                profile_creation_started_at <= ?
                OR (
                  profile_creation_started_at IS NULL
                  AND updated_at <= ?
                )
              )
            ORDER BY COALESCE(profile_creation_started_at, updated_at) ASC, id ASC
            LIMIT ?
          `
        )
        .bind(
          input.staleBeforeMs,
          input.staleBeforeMs,
          Math.max(1, input.limit)
        )
        .all<RequestRow>();
      return result.results.map(toRequestRecord);
    },

    claimProfileCreation: async (input) => {
      const result = await db
        .prepare(
          `
            UPDATE agent_profile_creation_requests
            SET
              profile_creation_attempt = profile_creation_attempt + 1,
              profile_creation_started_at = ?,
              updated_at = ?
            WHERE id = ?
              AND status = 'approved'
              AND updated_at = ?
              AND (
                (? IS NULL AND profile_creation_started_at IS NULL)
                OR profile_creation_started_at = ?
              )
          `
        )
        .bind(
          input.startedAtMs,
          input.startedAtMs,
          input.requestId,
          input.expectedUpdatedAtMs,
          input.expectedProfileCreationStartedAtMs,
          input.expectedProfileCreationStartedAtMs
        )
        .run();
      if (Number(result.meta.changes ?? 0) !== 1) {
        return null;
      }
      const row = await db
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
      return row ? toRequestRecord(row) : null;
    },

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

    insert: async (record, input) => {
      const inboxProjection = input?.inboxProjection ?? null;
      await db
        .prepare(
          `
            INSERT INTO agent_profile_creation_requests (
              ${REQUEST_COLUMNS},
              ${INBOX_PROJECTION_COLUMNS},
              inbox_projection_completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL)
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
          JSON.stringify(record.configuration),
          record.sessionStrategy,
          record.nativeSessionId,
          record.requestedSpaceId,
          record.idempotencyKey,
          record.status,
          record.statusReason,
          record.createdAgentProfileId,
          record.failureMessage,
          record.decidedAtMs,
          record.completedAtMs,
          record.profileCreationAttempt,
          record.profileCreationStartedAtMs,
          record.createdAtMs,
          record.updatedAtMs,
          inboxProjection,
          inboxProjection === null ? 0 : 1,
          inboxProjection === null ? null : "pending"
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

    markInboxProjectionCompleted: async (input) => {
      const result = await db
        .prepare(
          `
            UPDATE agent_profile_creation_requests
            SET
              inbox_projection_status = 'completed',
              inbox_projection_last_error = NULL,
              inbox_projection_next_retry_at = NULL,
              inbox_projection_completed_at = ?
            WHERE id = ?
              AND inbox_projection_generation = ?
              AND inbox_projection_status IN ('pending', 'failed')
          `
        )
        .bind(input.completedAtMs, input.requestId, input.generation)
        .run();
      if (Number(result.meta.changes ?? 0) === 1) {
        return true;
      }
      await reopenNewerCompletedInboxProjection(input);
      return false;
    },

    markInboxProjectionFailed: async (input) => {
      const result = await db
        .prepare(
          `
            UPDATE agent_profile_creation_requests
            SET
              inbox_projection_status = 'failed',
              inbox_projection_attempt_count = inbox_projection_attempt_count + 1,
              inbox_projection_last_error = ?,
              inbox_projection_next_retry_at = ?
            WHERE id = ?
              AND inbox_projection_generation = ?
              AND inbox_projection_status IN ('pending', 'failed')
          `
        )
        .bind(
          input.lastError,
          input.nextRetryAtMs,
          input.requestId,
          input.generation
        )
        .run();
      if (Number(result.meta.changes ?? 0) === 1) {
        return true;
      }
      await reopenNewerCompletedInboxProjection(input);
      return false;
    },

    synchronizeInboxProjectionIntents: async (input) => {
      const requestCondition = input?.requestId ? "AND id = ?" : "";
      const statement = db.prepare(
        `
            UPDATE agent_profile_creation_requests
            SET
              inbox_projection_operation = CASE
                WHEN status = 'pending' THEN 'project'
                ELSE 'resolve'
              END,
              inbox_projection_generation = inbox_projection_generation + 1,
              inbox_projection_status = 'pending',
              inbox_projection_attempt_count = 0,
              inbox_projection_last_error = NULL,
              inbox_projection_next_retry_at = NULL,
              inbox_projection_completed_at = NULL
            WHERE (
              inbox_projection_operation IS NULL
              OR (status = 'pending' AND inbox_projection_operation != 'project')
              OR (status != 'pending' AND inbox_projection_operation != 'resolve')
            )
            ${requestCondition}
          `
      );
      const result = await (input?.requestId
        ? statement.bind(input.requestId)
        : statement
      ).run();
      return Number(result.meta.changes ?? 0);
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
      const profileCreationAttemptCondition =
        input.expectedProfileCreationAttempt === undefined
          ? ""
          : "AND profile_creation_attempt = ?";
      const inboxProjectionUpdate = input.inboxProjection
        ? `,
              inbox_projection_operation = ?,
              inbox_projection_generation = inbox_projection_generation + 1,
              inbox_projection_status = 'pending',
              inbox_projection_attempt_count = 0,
              inbox_projection_last_error = NULL,
              inbox_projection_next_retry_at = NULL,
              inbox_projection_completed_at = NULL`
        : "";
      const result = await db
        .prepare(
          `
            UPDATE agent_profile_creation_requests
            SET
              status = ?,
              status_reason = ?,
              created_agent_profile_id = ?,
              failure_message = ?,
              decided_at = ?,
              completed_at = ?,
              profile_creation_started_at = ?,
              updated_at = ?
              ${inboxProjectionUpdate}
            WHERE id = ?
              AND status IN (${placeholders})
              AND updated_at = ?
              ${profileCreationAttemptCondition}
          `
        )
        .bind(
          record.status,
          record.statusReason,
          record.createdAgentProfileId,
          record.failureMessage,
          record.decidedAtMs,
          record.completedAtMs,
          record.profileCreationStartedAtMs,
          record.updatedAtMs,
          ...(input.inboxProjection ? [input.inboxProjection] : []),
          input.requestId,
          ...input.expectedStatuses,
          input.expectedUpdatedAtMs,
          ...(input.expectedProfileCreationAttempt === undefined
            ? []
            : [input.expectedProfileCreationAttempt])
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
    configuration: parseConfiguration(row.configuration_json),
    createdAgentProfileId: toNullableText(row.created_agent_profile_id),
    createdAtMs: requireTimestamp(row.created_at, "created_at"),
    decidedAtMs: toNullableTimestamp(row.decided_at, "decided_at"),
    id: requireText(row.id, "id"),
    idempotencyKey: requireText(row.idempotency_key, "idempotency_key"),
    failureMessage: toNullableText(row.failure_message),
    nativeSessionId: toNullableText(row.native_session_id),
    organizationId: requireText(row.organization_id, "organization_id"),
    profileCreationAttempt: requireNonNegativeInteger(
      row.profile_creation_attempt,
      "profile_creation_attempt"
    ),
    profileCreationStartedAtMs: toNullableTimestamp(
      row.profile_creation_started_at,
      "profile_creation_started_at"
    ),
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

function toInboxProjectionRecord(
  row: InboxProjectionRow
): AgentProfileCreationRequestInboxProjectionRecord {
  const operation = row.inbox_projection_operation;
  if (operation !== "project" && operation !== "resolve") {
    throw new Error(
      `Invalid Agent Profile creation request inbox_projection_operation '${operation}'.`
    );
  }
  const status = row.inbox_projection_status;
  if (status !== "pending" && status !== "failed" && status !== "completed") {
    throw new Error(
      `Invalid Agent Profile creation request inbox_projection_status '${status}'.`
    );
  }
  return {
    attemptCount: requireNonNegativeInteger(
      row.inbox_projection_attempt_count,
      "inbox_projection_attempt_count"
    ),
    generation: requireNonNegativeInteger(
      row.inbox_projection_generation,
      "inbox_projection_generation"
    ),
    lastError: toNullableText(row.inbox_projection_last_error),
    nextRetryAtMs: toNullableTimestamp(
      row.inbox_projection_next_retry_at,
      "inbox_projection_next_retry_at"
    ),
    operation,
    request: toRequestRecord(row),
    status,
  };
}

function parseConfiguration(value: unknown) {
  const raw = requireText(value, "configuration_json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      "Invalid Agent Profile creation request configuration_json.",
      {
        cause,
      }
    );
  }
  return agentProfileCreationConfigurationSchema.parse(parsed);
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
  return requireNonNegativeInteger(value, field);
}

function requireNonNegativeInteger(value: unknown, field: string): number {
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
