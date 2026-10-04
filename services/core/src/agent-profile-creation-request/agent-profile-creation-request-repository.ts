import type { PostgresDatabase } from "@openmeld/db/postgresql";
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
export function createPostgresAgentProfileCreationRequestRepository(
  db: PostgresDatabase
): AgentProfileCreationRequestRepository {
  const getById = async (input: {
    organizationId: string;
    requestId: string;
  }): Promise<AgentProfileCreationRequestRecord | null> => {
    const row = await db
      .query<RequestRow>({
        text: `
          SELECT ${REQUEST_COLUMNS}
          FROM "openmeld"."agent_profile_creation_requests"
          WHERE organization_id = $1
            AND id = $2
          LIMIT 1
        `,
        values: [input.organizationId, input.requestId],
      })
      .then((result) => result.rows[0] ?? null);
    return row ? toRequestRecord(row) : null;
  };
  const reopenNewerCompletedInboxProjection = async (input: {
    generation: number;
    requestId: string;
  }): Promise<void> => {
    await db.query({
      text: `
          UPDATE "openmeld"."agent_profile_creation_requests"
          SET
            inbox_projection_status = 'pending',
            inbox_projection_last_error = NULL,
            inbox_projection_next_retry_at = NULL,
            inbox_projection_completed_at = NULL
          WHERE id = $1
            AND inbox_projection_generation > $2
            AND inbox_projection_status = 'completed'
        `,
      values: [input.requestId, input.generation],
    });
  };
  return {
    findByIdempotencyKey: async (input) => {
      const row = await db
        .query<RequestRow>({
          text: `
            SELECT ${REQUEST_COLUMNS}
            FROM "openmeld"."agent_profile_creation_requests"
            WHERE organization_id = $1
              AND requester_user_id = $2
              AND idempotency_key = $3
            LIMIT 1
          `,
          values: [
            input.organizationId,
            input.requesterUserId,
            input.idempotencyKey,
          ],
        })
        .then((result) => result.rows[0] ?? null);
      return row ? toRequestRecord(row) : null;
    },
    getById,
    getInboxProjectionByRequestId: async (requestId) => {
      const row = await db
        .query<InboxProjectionRow>({
          text: `
            SELECT ${REQUEST_COLUMNS}, ${INBOX_PROJECTION_COLUMNS}
            FROM "openmeld"."agent_profile_creation_requests"
            WHERE id = $1
              AND inbox_projection_operation IS NOT NULL
            LIMIT 1
          `,
          values: [requestId],
        })
        .then((result) => result.rows[0] ?? null);
      return row ? toInboxProjectionRecord(row) : null;
    },
    listDueInboxProjections: async (input) => {
      const result = await db.query<InboxProjectionRow>({
        text: `
            SELECT ${REQUEST_COLUMNS}, ${INBOX_PROJECTION_COLUMNS}
            FROM "openmeld"."agent_profile_creation_requests"
            WHERE inbox_projection_status IN ('pending', 'failed')
              AND (
                inbox_projection_next_retry_at IS NULL
                OR inbox_projection_next_retry_at <= $1
              )
            ORDER BY updated_at ASC NULLS FIRST, id ASC NULLS FIRST
            LIMIT $2
          `,
        values: [input.nowMs, Math.max(1, input.limit)],
      });
      return result.rows.map(toInboxProjectionRecord);
    },
    listUnclaimedProfileCreations: async (input) => {
      const result = await db.query<RequestRow>({
        text: `
        SELECT ${REQUEST_COLUMNS}
        FROM "openmeld"."agent_profile_creation_requests"
        WHERE status = 'approved' AND profile_creation_started_at IS NULL
        ORDER BY updated_at ASC NULLS FIRST, id ASC NULLS FIRST
        LIMIT $1
      `,
        values: [Math.max(1, input.limit)],
      });
      return result.rows.map(toRequestRecord);
    },
    listStaleProfileCreations: async (input) => {
      const result = await db.query<RequestRow>({
        text: `
            SELECT ${REQUEST_COLUMNS}
            FROM "openmeld"."agent_profile_creation_requests"
            WHERE status = 'approved'
              AND (
                profile_creation_started_at <= $1
                OR (
                  profile_creation_started_at IS NULL
                  AND updated_at <= $2
                )
              )
            ORDER BY COALESCE(profile_creation_started_at, updated_at) ASC NULLS FIRST, id ASC NULLS FIRST
            LIMIT $3
          `,
        values: [
          input.staleBeforeMs,
          input.staleBeforeMs,
          Math.max(1, input.limit),
        ],
      });
      return result.rows.map(toRequestRecord);
    },
    claimProfileCreation: async (input) => {
      const result = await db.query({
        text: `
            UPDATE "openmeld"."agent_profile_creation_requests"
            SET
              profile_creation_attempt = profile_creation_attempt + 1,
              profile_creation_started_at = $1,
              updated_at = $2
            WHERE id = $3
              AND status = 'approved'
              AND updated_at = $4
              AND (
                ($5::text IS NULL AND profile_creation_started_at IS NULL)
                OR profile_creation_started_at = $6
              )
          `,
        values: [
          input.startedAtMs,
          input.startedAtMs,
          input.requestId,
          input.expectedUpdatedAtMs,
          input.expectedProfileCreationStartedAtMs,
          input.expectedProfileCreationStartedAtMs,
        ],
      });
      if (Number(result.rowCount ?? 0) !== 1) {
        return null;
      }
      const row = await db
        .query<RequestRow>({
          text: `
            SELECT ${REQUEST_COLUMNS}
            FROM "openmeld"."agent_profile_creation_requests"
            WHERE id = $1
            LIMIT 1
          `,
          values: [input.requestId],
        })
        .then((result) => result.rows[0] ?? null);
      return row ? toRequestRecord(row) : null;
    },
    getPreference: async (input) => {
      const row = await db
        .query<PreferenceRow>({
          text: `
            SELECT
              organization_id,
              user_id,
              new_session_policy,
              existing_session_policy,
              updated_at
            FROM "openmeld"."agent_profile_creation_approval_preferences"
            WHERE organization_id = $1
              AND user_id = $2
            LIMIT 1
          `,
          values: [input.organizationId, input.userId],
        })
        .then((result) => result.rows[0] ?? null);
      return row ? toPreferenceRecord(row) : null;
    },
    insert: async (record, input) => {
      const inboxProjection = input?.inboxProjection ?? null;
      await db.query({
        text: `
            INSERT INTO "openmeld"."agent_profile_creation_requests" (
              ${REQUEST_COLUMNS},
              ${INBOX_PROJECTION_COLUMNS},
              inbox_projection_completed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, 0, NULL, NULL, NULL)
          `,
        values: [
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
          inboxProjection === null ? null : "pending",
        ],
      });
      return record;
    },
    listForParticipant: async (input) => {
      const result = await db.query<RequestRow>({
        text: `
            SELECT ${REQUEST_COLUMNS}
            FROM "openmeld"."agent_profile_creation_requests"
            WHERE organization_id = $1
              AND (requester_user_id = $2 OR target_owner_user_id = $3)
            ORDER BY updated_at DESC NULLS LAST, id DESC NULLS LAST
            LIMIT 200
          `,
        values: [input.organizationId, input.userId, input.userId],
      });
      return result.rows.map(toRequestRecord);
    },
    markInboxProjectionCompleted: async (input) => {
      const result = await db.query({
        text: `
            UPDATE "openmeld"."agent_profile_creation_requests"
            SET
              inbox_projection_status = 'completed',
              inbox_projection_last_error = NULL,
              inbox_projection_next_retry_at = NULL,
              inbox_projection_completed_at = $1
            WHERE id = $2
              AND inbox_projection_generation = $3
              AND inbox_projection_status IN ('pending', 'failed')
          `,
        values: [input.completedAtMs, input.requestId, input.generation],
      });
      if (Number(result.rowCount ?? 0) === 1) {
        return true;
      }
      await reopenNewerCompletedInboxProjection(input);
      return false;
    },
    markInboxProjectionFailed: async (input) => {
      const result = await db.query({
        text: `
            UPDATE "openmeld"."agent_profile_creation_requests"
            SET
              inbox_projection_status = 'failed',
              inbox_projection_attempt_count = inbox_projection_attempt_count + 1,
              inbox_projection_last_error = $1,
              inbox_projection_next_retry_at = $2
            WHERE id = $3
              AND inbox_projection_generation = $4
              AND inbox_projection_status IN ('pending', 'failed')
          `,
        values: [
          input.lastError,
          input.nextRetryAtMs,
          input.requestId,
          input.generation,
        ],
      });
      if (Number(result.rowCount ?? 0) === 1) {
        return true;
      }
      await reopenNewerCompletedInboxProjection(input);
      return false;
    },
    synchronizeInboxProjectionIntents: async (input) => {
      const requestCondition = input?.requestId ? "AND id = $1" : "";
      const statement = {
        text: `
            UPDATE "openmeld"."agent_profile_creation_requests"
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
          `,
        values: [],
      };
      const result = await db.query(
        input?.requestId
          ? {
              ...statement,
              values: [input.requestId],
            }
          : statement
      );
      return Number(result.rowCount ?? 0);
    },
    transition: async (input) => {
      if (input.expectedStatuses.length === 0) {
        return null;
      }
      const current = await db
        .query<RequestRow>({
          text: `
            SELECT ${REQUEST_COLUMNS}
            FROM "openmeld"."agent_profile_creation_requests"
            WHERE id = $1
            LIMIT 1
          `,
          values: [input.requestId],
        })
        .then((result) => result.rows[0] ?? null);
      if (!current) {
        return null;
      }
      const record = { ...toRequestRecord(current), ...input.update };
      const profileCreationAttemptCondition =
        input.expectedProfileCreationAttempt === undefined
          ? ""
          : `AND profile_creation_attempt = $${input.inboxProjection ? 13 : 12}`;
      const inboxProjectionUpdate = input.inboxProjection
        ? `,
              inbox_projection_operation = $12,
              inbox_projection_generation = inbox_projection_generation + 1,
              inbox_projection_status = 'pending',
              inbox_projection_attempt_count = 0,
              inbox_projection_last_error = NULL,
              inbox_projection_next_retry_at = NULL,
              inbox_projection_completed_at = NULL`
        : "";
      const result = await db.query({
        text: `
            UPDATE "openmeld"."agent_profile_creation_requests"
            SET
              status = $1,
              status_reason = $2,
              created_agent_profile_id = $3,
              failure_message = $4,
              decided_at = $5,
              completed_at = $6,
              profile_creation_started_at = $7,
              updated_at = $8
              ${inboxProjectionUpdate}
            WHERE id = $9
              AND status = ANY($10::text[])
              AND updated_at = $11
              ${profileCreationAttemptCondition}
          `,
        values: [
          record.status,
          record.statusReason,
          record.createdAgentProfileId,
          record.failureMessage,
          record.decidedAtMs,
          record.completedAtMs,
          record.profileCreationStartedAtMs,
          record.updatedAtMs,
          input.requestId,
          input.expectedStatuses,
          input.expectedUpdatedAtMs,
          ...(input.inboxProjection ? [input.inboxProjection] : []),
          ...(input.expectedProfileCreationAttempt === undefined
            ? []
            : [input.expectedProfileCreationAttempt]),
        ],
      });
      if (Number(result.rowCount ?? 0) !== 1) {
        return null;
      }
      return await getById({
        organizationId: record.organizationId,
        requestId: record.id,
      });
    },
    upsertPreference: async (input) => {
      const id = `apcp_${crypto.randomUUID()}`;
      await db.query({
        text: `
            INSERT INTO "openmeld"."agent_profile_creation_approval_preferences" (
              id,
              organization_id,
              user_id,
              new_session_policy,
              existing_session_policy,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT(organization_id, user_id) DO UPDATE SET
              new_session_policy = excluded.new_session_policy,
              existing_session_policy = excluded.existing_session_policy,
              updated_at = excluded.updated_at
          `,
        values: [
          id,
          input.organizationId,
          input.userId,
          input.newSessionPolicy,
          input.existingSessionPolicy,
          input.nowMs,
          input.nowMs,
        ],
      });
      const row = await db
        .query<PreferenceRow>({
          text: `
            SELECT
              organization_id,
              user_id,
              new_session_policy,
              existing_session_policy,
              updated_at
            FROM "openmeld"."agent_profile_creation_approval_preferences"
            WHERE organization_id = $1
              AND user_id = $2
            LIMIT 1
          `,
          values: [input.organizationId, input.userId],
        })
        .then((result) => result.rows[0] ?? null);
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
