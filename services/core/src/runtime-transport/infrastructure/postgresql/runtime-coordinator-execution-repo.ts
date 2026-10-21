import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  buildRuntimeCoordinatorExecutionEventId,
  RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
  runtimeCoordinatorExecutionCreationDiagnosticSchema,
  runtimeCoordinatorExecutionEventSchema,
  runtimeCoordinatorExecutionRecordSchema,
  WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE,
} from "@openmeld/schemas";
import type {
  RuntimeCoordinatorExecutionCreationDiagnostic,
  RuntimeCoordinatorExecutionEvent,
  RuntimeCoordinatorExecutionEventType,
  RuntimeCoordinatorExecutionRecord,
  RuntimeCoordinatorExecutionStatus,
  WakeProgressWaitReasonCode,
} from "@openmeld/schemas/types";
import { resolveWakeProgressLocalQueueWaitReasonCode } from "../../application/local-queue-wait-reason";
import { stringifyRuntimeCoordinatorEventPayload } from "../../application/runtime-coordinator-execution-token";

type RuntimeCoordinatorExecutionRow = {
  binding_id: string;
  agent_controller_ref: string;
  claim_lease_id: string | null;
  connection_generation: number | null;
  created_at_ms: number;
  daemon_session_id: string | null;
  dispatch_id: string;
  lease_epoch: number | null;
  model_version: string;
  runtime_coordinator_execution_id: string;
  openmeld_service_runtime_id: string;
  openmeld_service_runtime_id_source: string;
  source_client_message_id: string | null;
  space_id: string;
  status: RuntimeCoordinatorExecutionStatus;
  target_profile_id: string;
  terminal_outcome_json: string | null;
  attempt_id: string | null;
  updated_at_ms: number;
};
export type RuntimeCoordinatorExecutionWakeProgressSelector = {
  createdAtMs: number;
  runningAtMs: number | null;
  dispatchId: string;
  latestDispatchAttemptStatus: string | null;
  /** The Service holds this accepted execution in its local queue. */
  locallyQueued: boolean;
  runtimeCoordinatorExecutionId: string;
  sourceClientMessageId: string | null;
  sourceEventId: string | null;
  status: RuntimeCoordinatorExecutionStatus;
  targetProfileId: string;
  updatedAtMs: number;
  waitReasonCode: WakeProgressWaitReasonCode | null;
  openMeldServiceRuntimeId: RuntimeCoordinatorExecutionRecord["openMeldServiceRuntimeId"];
};
type RuntimeCoordinatorExecutionWakeProgressSelectorRow = {
  created_at_ms?: unknown;
  running_at_ms?: unknown;
  dispatch_id?: unknown;
  latest_dispatch_attempt_status?: unknown;
  latest_local_queue_payload_json?: unknown;
  latest_occupancy_payload_json?: unknown;
  runtime_coordinator_execution_id?: unknown;
  source_client_message_id?: unknown;
  source_event_id?: unknown;
  status?: unknown;
  target_profile_id?: unknown;
  updated_at_ms?: unknown;
  openmeld_service_runtime_id?: unknown;
};
type RuntimeCoordinatorCreationDiagnosticRow = {
  creation_status: RuntimeCoordinatorExecutionCreationDiagnostic["creationStatus"];
  dispatch_id: string;
  legacy_attempt_id: string | null;
  model_version: string;
  observed_at_ms: number;
  reason_code: string;
  source_client_message_id: string | null;
  space_id: string;
  target_profile_id: string;
};
type RuntimeCoordinatorExecutionEventRow = {
  event_id: string;
  event_type: RuntimeCoordinatorExecutionEventType;
  idempotency_key: string;
  observed_at_ms: number;
  payload_json: string;
  reason_code: string | null;
  runtime_coordinator_execution_id: string;
  status_after: RuntimeCoordinatorExecutionStatus | null;
};
const STATUS_RANK: Record<RuntimeCoordinatorExecutionStatus, number> = {
  created: 0,
  delivery_pending: 1,
  delivery_accepted: 2,
  delivery_rejected: 2,
  accepted_local: 3,
  running: 4,
  cancellation_requested: 5,
  completed_local: 5,
  result_received: 6,
  result_accepted: 7,
  reply_published: 8,
  cancelled: 8,
  failed_retryable: 8,
  failed_terminal: 8,
  state_unknown: 0,
};
const LOCKED_TERMINAL_STATUSES = new Set<RuntimeCoordinatorExecutionStatus>([
  "cancelled",
  "failed_terminal",
  "reply_published",
]);
// Historical discovery only. Delivery retries and token/connection diagnostics
// do not advance activity; these rows never determine current execution state.
export async function readRuntimeCoordinatorTaskActivity(input: {
  db: PostgresDatabase;
  authorizedProfileIds: readonly string[];
  sinceMs: number;
}): Promise<Map<string, number>> {
  const activity = new Map<string, number>();
  for (
    let offset = 0;
    offset < input.authorizedProfileIds.length;
    offset += 80
  ) {
    const ids = input.authorizedProfileIds.slice(offset, offset + 80);
    const rows = await input.db.query<{
      profileId: string;
      lastTaskActivityAtMs: number;
    }>({
      text: `
      SELECT target_profile_id AS "profileId",
        MAX(GREATEST(created_at_ms, CASE WHEN status IN (
          'accepted_local', 'running', 'completed_local', 'result_received',
          'result_accepted', 'reply_published', 'cancelled', 'failed_terminal'
        ) THEN updated_at_ms ELSE created_at_ms END)) AS "lastTaskActivityAtMs"
      FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions"
      WHERE target_profile_id = ANY($1::text[])
        AND updated_at_ms >= $2
      GROUP BY target_profile_id
      HAVING MAX(GREATEST(created_at_ms, CASE WHEN status IN (
          'accepted_local', 'running', 'completed_local', 'result_received',
          'result_accepted', 'reply_published', 'cancelled', 'failed_terminal'
        ) THEN updated_at_ms ELSE created_at_ms END)) >= $2
    `,
      values: [ids, input.sinceMs],
    });
    for (const row of rows.rows) {
      activity.set(row.profileId, row.lastTaskActivityAtMs);
    }
  }
  return activity;
}
const ACTIVE_WAKE_PROGRESS_STATUSES: readonly RuntimeCoordinatorExecutionStatus[] =
  [
    "created",
    "delivery_pending",
    "delivery_accepted",
    "cancellation_requested",
    "accepted_local",
    "running",
    "completed_local",
    "result_received",
    "result_accepted",
    "failed_retryable",
  ];
export const writeRuntimeCoordinatorExecutionProjection = async (input: {
  db: PostgresDatabase;
  record: RuntimeCoordinatorExecutionRecord;
}): Promise<"skipped_stale" | "written"> => {
  const parsed = runtimeCoordinatorExecutionRecordSchema.safeParse(
    input.record
  );
  if (!parsed.success) {
    throw new Error("invalid runtime coordinator execution projection");
  }
  const record = parsed.data;
  // Let PostgreSQL serialize the row and evaluate progress against its current
  // value. A failed optimistic comparison must not discard newer evidence.
  const nextRank = STATUS_RANK[record.status];
  const allowedStatuses = (
    Object.keys(STATUS_RANK) as RuntimeCoordinatorExecutionStatus[]
  ).filter(
    (status) =>
      STATUS_RANK[status] <= nextRank &&
      (!LOCKED_TERMINAL_STATUSES.has(status) || status === record.status)
  );
  const sameRankStatuses = allowedStatuses.filter(
    (status) => STATUS_RANK[status] === nextRank
  );
  const result = await input.db.query({
    text: `
          INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_executions" AS current_projection (
            runtime_coordinator_execution_id,
            model_version,
            space_id,
            dispatch_id,
            target_profile_id,
            source_client_message_id,
            openmeld_service_runtime_id_source,
            openmeld_service_runtime_id,
            binding_id,
            agent_controller_ref,
            status,
            terminal_outcome_json,
            attempt_id,
            claim_lease_id,
            daemon_session_id,
            connection_generation,
            lease_epoch,
            created_at_ms,
            updated_at_ms
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT(runtime_coordinator_execution_id) DO UPDATE SET
            model_version = excluded.model_version,
            space_id = excluded.space_id,
            dispatch_id = excluded.dispatch_id,
            target_profile_id = excluded.target_profile_id,
            source_client_message_id = excluded.source_client_message_id,
            openmeld_service_runtime_id_source = excluded.openmeld_service_runtime_id_source,
            openmeld_service_runtime_id = excluded.openmeld_service_runtime_id,
            binding_id = excluded.binding_id,
            agent_controller_ref = excluded.agent_controller_ref,
            status = excluded.status,
            terminal_outcome_json = excluded.terminal_outcome_json,
            attempt_id = excluded.attempt_id,
            claim_lease_id = excluded.claim_lease_id,
            daemon_session_id = excluded.daemon_session_id,
            connection_generation = excluded.connection_generation,
            lease_epoch = excluded.lease_epoch,
            updated_at_ms = excluded.updated_at_ms
          WHERE current_projection.status = ANY($20::text[])
            AND (
              NOT (current_projection.status = ANY($21::text[]))
              OR current_projection.updated_at_ms <= excluded.updated_at_ms
            )

        `,
    values: [
      record.runtimeCoordinatorExecutionId,
      record.modelVersion,
      record.spaceId,
      record.dispatchId,
      record.targetProfileId,
      record.sourceClientMessageId,
      record.openMeldServiceRuntimeId.source,
      record.openMeldServiceRuntimeId.value,
      record.bindingId,
      record.agentControllerRef,
      record.status,
      stringifyNullableJson(record.terminalOutcome),
      record.legacyPointers.attemptId,
      record.legacyPointers.claimLeaseId,
      record.legacyPointers.daemonSessionId,
      record.legacyPointers.connectionGeneration,
      record.legacyPointers.leaseEpoch,
      record.createdAtMs,
      record.updatedAtMs,
      allowedStatuses,
      sameRankStatuses,
    ],
  });
  return result.rowCount === 0 ? "skipped_stale" : "written";
};
export const writeRuntimeCoordinatorTerminalExecutionProjectionWithoutRead =
  async (input: {
    db: PostgresDatabase;
    record: RuntimeCoordinatorExecutionRecord;
  }): Promise<void> => {
    const parsed = runtimeCoordinatorExecutionRecordSchema.safeParse(
      input.record
    );
    if (!parsed.success) {
      throw new Error("invalid runtime coordinator execution projection");
    }
    const record = parsed.data;
    await input.db.query({
      text: `
          INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_executions" (
            runtime_coordinator_execution_id,
            model_version,
            space_id,
            dispatch_id,
            target_profile_id,
            source_client_message_id,
            openmeld_service_runtime_id_source,
            openmeld_service_runtime_id,
            binding_id,
            agent_controller_ref,
            status,
            terminal_outcome_json,
            attempt_id,
            claim_lease_id,
            daemon_session_id,
            connection_generation,
            lease_epoch,
            created_at_ms,
            updated_at_ms
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT(runtime_coordinator_execution_id) DO UPDATE SET
            model_version = excluded.model_version,
            space_id = excluded.space_id,
            dispatch_id = excluded.dispatch_id,
            target_profile_id = excluded.target_profile_id,
            source_client_message_id = excluded.source_client_message_id,
            openmeld_service_runtime_id_source = excluded.openmeld_service_runtime_id_source,
            openmeld_service_runtime_id = excluded.openmeld_service_runtime_id,
            binding_id = excluded.binding_id,
            agent_controller_ref = excluded.agent_controller_ref,
            status = excluded.status,
            terminal_outcome_json = excluded.terminal_outcome_json,
            attempt_id = excluded.attempt_id,
            claim_lease_id = excluded.claim_lease_id,
            daemon_session_id = excluded.daemon_session_id,
            connection_generation = excluded.connection_generation,
            lease_epoch = excluded.lease_epoch,
            updated_at_ms = excluded.updated_at_ms
          WHERE NOT (
            "openMeldDaemon_runtime_coordinator_executions".status IN ('cancelled', 'failed_terminal', 'reply_published')
            AND "openMeldDaemon_runtime_coordinator_executions".status <> excluded.status
          )
        `,
      values: [
        record.runtimeCoordinatorExecutionId,
        record.modelVersion,
        record.spaceId,
        record.dispatchId,
        record.targetProfileId,
        record.sourceClientMessageId,
        record.openMeldServiceRuntimeId.source,
        record.openMeldServiceRuntimeId.value,
        record.bindingId,
        record.agentControllerRef,
        record.status,
        stringifyNullableJson(record.terminalOutcome),
        record.legacyPointers.attemptId,
        record.legacyPointers.claimLeaseId,
        record.legacyPointers.daemonSessionId,
        record.legacyPointers.connectionGeneration,
        record.legacyPointers.leaseEpoch,
        record.createdAtMs,
        record.updatedAtMs,
      ],
    });
  };
export const writeRuntimeCoordinatorExecutionEvent = async (input: {
  db: PostgresDatabase;
  event: RuntimeCoordinatorExecutionEvent;
  replaceCurrentState?: boolean;
}): Promise<void> => {
  const parsed = runtimeCoordinatorExecutionEventSchema.safeParse(input.event);
  if (!parsed.success) {
    throw new Error("invalid runtime coordinator execution event");
  }
  const event = parsed.data;
  const insertMode = input.replaceCurrentState
    ? `
        INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_execution_events" (
          event_id,
          runtime_coordinator_execution_id,
          event_type,
          status_after,
          reason_code,
          observed_at_ms,
          idempotency_key,
          payload_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT(event_id) DO UPDATE SET
          status_after = excluded.status_after,
          reason_code = excluded.reason_code,
          observed_at_ms = excluded.observed_at_ms,
          payload_json = excluded.payload_json
      `
    : `
        INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_execution_events" (
          event_id,
          runtime_coordinator_execution_id,
          event_type,
          status_after,
          reason_code,
          observed_at_ms,
          idempotency_key,
          payload_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`;
  await input.db.query({
    text: insertMode,
    values: [
      event.eventId,
      event.runtimeCoordinatorExecutionId,
      event.eventType,
      event.statusAfter,
      event.reasonCode,
      event.observedAtMs,
      event.idempotencyKey,
      event.payloadJson,
    ],
  });
};
export const writeRuntimeCoordinatorExecutionEventFromParts = async (input: {
  db: PostgresDatabase;
  eventType: RuntimeCoordinatorExecutionEventType;
  idempotencyKey: string;
  observedAtMs: number;
  payload: Record<string, unknown>;
  reasonCode?: string | null;
  replaceCurrentState?: boolean;
  runtimeCoordinatorExecutionId: string;
  statusAfter?: RuntimeCoordinatorExecutionStatus | null;
}): Promise<void> => {
  const legacyEventId = buildRuntimeCoordinatorExecutionEventId(input);
  // Preserve every previously valid identity across replay and rolling deploys.
  // Oversized identities never passed the event schema and cannot exist in D1.
  const eventId =
    legacyEventId.length <= 512
      ? legacyEventId
      : `rce_event_sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(legacyEventId))), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  await writeRuntimeCoordinatorExecutionEvent({
    db: input.db,
    event: {
      eventId,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      observedAtMs: input.observedAtMs,
      payloadJson: stringifyRuntimeCoordinatorEventPayload(input.payload),
      reasonCode: input.reasonCode ?? null,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      statusAfter: input.statusAfter ?? null,
    },
    replaceCurrentState: input.replaceCurrentState,
  });
};
export const writeRuntimeCoordinatorCreationDiagnostic = async (input: {
  db: PostgresDatabase;
  diagnostic: RuntimeCoordinatorExecutionCreationDiagnostic;
}): Promise<void> => {
  const parsed = runtimeCoordinatorExecutionCreationDiagnosticSchema.safeParse(
    input.diagnostic
  );
  if (!parsed.success) {
    throw new Error("invalid runtime coordinator creation diagnostic");
  }
  const diagnostic = parsed.data;
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_creation_diagnostics" (
          diagnostic_id,
          model_version,
          space_id,
          dispatch_id,
          target_profile_id,
          source_client_message_id,
          creation_status,
          reason_code,
          observed_at_ms,
          legacy_attempt_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT(diagnostic_id) DO UPDATE SET
          observed_at_ms = excluded.observed_at_ms
      `,
    values: [
      buildRuntimeCoordinatorCreationDiagnosticId(diagnostic),
      diagnostic.modelVersion,
      diagnostic.spaceId,
      diagnostic.dispatchId,
      diagnostic.targetProfileId,
      diagnostic.sourceClientMessageId,
      diagnostic.creationStatus,
      diagnostic.reasonCode,
      diagnostic.observedAtMs,
      diagnostic.legacyAttemptId,
    ],
  });
};
export const readRuntimeCoordinatorExecutionProjectionByDispatch =
  async (input: {
    db: PostgresDatabase;
    dispatchId: string;
    spaceId: string;
    targetProfileId: string;
  }): Promise<RuntimeCoordinatorExecutionRecord | null> => {
    const row = await input.db
      .query<RuntimeCoordinatorExecutionRow>({
        text: `
        SELECT
          runtime_coordinator_execution_id,
          model_version,
          space_id,
          dispatch_id,
          target_profile_id,
          source_client_message_id,
          openmeld_service_runtime_id_source,
          openmeld_service_runtime_id,
          binding_id,
          agent_controller_ref,
          status,
          terminal_outcome_json,
          attempt_id,
          claim_lease_id,
          daemon_session_id,
          connection_generation,
          lease_epoch,
          created_at_ms,
          updated_at_ms
        FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions"
        WHERE space_id = $1 AND dispatch_id = $2 AND target_profile_id = $3
        ORDER BY updated_at_ms DESC NULLS LAST
        LIMIT 1
      `,
        values: [input.spaceId, input.dispatchId, input.targetProfileId],
      })
      .then((result) => result.rows[0] ?? null);
    return row ? mapRuntimeCoordinatorExecutionRow(row) : null;
  };
export const listActiveRuntimeCoordinatorExecutionProjectionsBySpace =
  async (input: {
    db: PostgresDatabase;
    limit?: number;
    spaceId: string;
    targetProfileId?: string;
  }): Promise<RuntimeCoordinatorExecutionRecord[]> => {
    const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 25)));
    const targetProfileId = input.targetProfileId?.trim() || null;
    const statement = {
      text: `
        SELECT
          runtime_coordinator_execution_id,
          model_version,
          space_id,
          dispatch_id,
          target_profile_id,
          source_client_message_id,
          openmeld_service_runtime_id_source,
          openmeld_service_runtime_id,
          binding_id,
          agent_controller_ref,
          status,
          terminal_outcome_json,
          attempt_id,
          claim_lease_id,
          daemon_session_id,
          connection_generation,
          lease_epoch,
          created_at_ms,
          updated_at_ms
        FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions"
        WHERE space_id = $1
          AND status = ANY($2::text[])
          AND ($4::text IS NULL OR target_profile_id = $4)
        ORDER BY updated_at_ms DESC NULLS LAST, runtime_coordinator_execution_id DESC NULLS LAST
        LIMIT $3
      `,
      values: [],
    };
    const bindings = [
      input.spaceId,
      ACTIVE_WAKE_PROGRESS_STATUSES,
      limit,
      targetProfileId,
    ];
    const rows = await input.db.query<RuntimeCoordinatorExecutionRow>({
      ...statement,
      values: [...bindings],
    });
    return rows.rows.map(mapRuntimeCoordinatorExecutionRow);
  };
// Read the coordinator's preserved phase start, not a heartbeat observation or
// execution creation time. Older evidence without this fact has no timer.
const RUNNING_AT_MS_SQL = `
  SELECT MIN((payload_json::jsonb ->> 'runningAtMs')::bigint)
  FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events"
  WHERE runtime_coordinator_execution_id = executions.runtime_coordinator_execution_id
    AND event_type = 'lifecycle_running'
    AND jsonb_typeof(payload_json::jsonb -> 'runningAtMs') = 'number'
    AND payload_json::jsonb ->> 'runningAtMs' ~ '^[0-9]+$'
`;
export const readRuntimeCoordinatorExecutionRunningAtMs = async (input: {
  db: PostgresDatabase;
  runtimeCoordinatorExecutionId: string;
}): Promise<number | null> => {
  const row = await input.db
    .query<{
      running_at_ms: number | null;
    }>({
      text: `
    SELECT (${RUNNING_AT_MS_SQL}) AS running_at_ms
    FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions" AS executions
    WHERE executions.runtime_coordinator_execution_id = $1
  `,
      values: [input.runtimeCoordinatorExecutionId],
    })
    .then((result) => result.rows[0] ?? null);
  return readRunningTimestamp(row?.running_at_ms);
};
const readRunningTimestamp = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
export const listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace =
  async (input: {
    db: Pick<PostgresDatabase, "query">;
    limit?: number;
    sourceDispatchIds?: readonly string[];
    sourceProfileId?: string;
    spaceId: string;
    targetProfileId?: string;
    includeTiming?: boolean;
  }): Promise<RuntimeCoordinatorExecutionWakeProgressSelector[]> => {
    const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 25)));
    const targetProfileId = input.targetProfileId?.trim() || null;
    const sourceDispatchIds = input.sourceDispatchIds?.filter(
      (dispatchId) => dispatchId.trim().length > 0
    );
    const sourceProfileId = input.sourceProfileId?.trim() || null;
    if (
      !sourceProfileId &&
      sourceDispatchIds &&
      sourceDispatchIds.length === 0
    ) {
      return [];
    }
    const statement = {
      text: `
        SELECT
          executions.runtime_coordinator_execution_id,
          executions.openmeld_service_runtime_id,
          executions.dispatch_id,
          executions.target_profile_id,
          executions.source_client_message_id,
          executions.status,
          executions.created_at_ms,
          ${input.includeTiming ? `(${RUNNING_AT_MS_SQL})` : "NULL"} AS running_at_ms,
          executions.updated_at_ms,
          ledger.source_event_id,
          latest_attempt.status AS latest_dispatch_attempt_status,
          (
            SELECT occupancy_event.payload_json
            FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events" AS occupancy_event
            WHERE occupancy_event.runtime_coordinator_execution_id =
              executions.runtime_coordinator_execution_id
              AND occupancy_event.event_type IN (
                'lifecycle_accepted_local',
                'lifecycle_running'
              )
              AND ((occupancy_event.payload_json)::jsonb #>> '{agentControllerConversationOccupancy,state}') IS NOT NULL
            ORDER BY occupancy_event.observed_at_ms DESC NULLS LAST,
              occupancy_event.event_id DESC NULLS LAST
            LIMIT 1
          ) AS latest_occupancy_payload_json,
          CASE WHEN executions.status = 'accepted_local' THEN (
            SELECT local_queue_event.payload_json
            FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events" AS local_queue_event
            WHERE local_queue_event.runtime_coordinator_execution_id =
              executions.runtime_coordinator_execution_id
              AND local_queue_event.event_type = 'lifecycle_accepted_local'
            ORDER BY local_queue_event.observed_at_ms DESC NULLS LAST,
              local_queue_event.event_id DESC NULLS LAST
            LIMIT 1
          ) END AS latest_local_queue_payload_json
        FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions" AS executions
        LEFT JOIN "openmeld"."openMeldDaemon_dispatch_ledger" AS ledger
          ON ledger.space_id = executions.space_id
          AND ledger.dispatch_id = executions.dispatch_id
          AND ledger.target_profile_id = executions.target_profile_id
        LEFT JOIN "openmeld"."openMeldDaemon_dispatch_attempts" AS latest_attempt
          ON latest_attempt.attempt_id = ledger.latest_attempt_id
        WHERE executions.space_id = $1
          AND executions.status = ANY($2::text[])
          AND ($6::text IS NULL OR executions.target_profile_id = $6)
          AND (
            ($4::text IS NULL AND ($5::text[] IS NULL OR executions.dispatch_id = ANY($5)))
            OR ledger.source_profile_id = $4
            OR (ledger.source_profile_id IS NULL AND executions.dispatch_id = ANY($5))
          )
        ORDER BY executions.updated_at_ms DESC NULLS LAST,
          executions.runtime_coordinator_execution_id DESC NULLS LAST
        LIMIT $3
      `,
      values: [],
    };
    const bindings = [
      input.spaceId,
      ACTIVE_WAKE_PROGRESS_STATUSES,
      limit,
      sourceProfileId,
      sourceDispatchIds ?? (sourceProfileId ? [] : null),
      targetProfileId,
    ];
    const rows =
      await input.db.query<RuntimeCoordinatorExecutionWakeProgressSelectorRow>({
        ...statement,
        values: [...bindings],
      });
    return rows.rows.flatMap((row) =>
      mapRuntimeCoordinatorExecutionWakeProgressSelectorRow(row)
    );
  };
// Bound each query's result work while using native array parameters.
const ACTIVE_COUNT_SPACE_ID_CHUNK_SIZE = 80;
export type ActiveRuntimeCoordinatorExecutionTargetCount = {
  activeWakeCount: number;
  spaceId: string;
  targetProfileId: string;
};
export const listActiveRuntimeCoordinatorExecutionTargetsBySpaceIds =
  async (input: {
    db: PostgresDatabase;
    freshAfterMs: number;
    spaceIds: readonly string[];
  }): Promise<ActiveRuntimeCoordinatorExecutionTargetCount[]> => {
    const targets: ActiveRuntimeCoordinatorExecutionTargetCount[] = [];
    for (
      let offset = 0;
      offset < input.spaceIds.length;
      offset += ACTIVE_COUNT_SPACE_ID_CHUNK_SIZE
    ) {
      const chunk = input.spaceIds.slice(
        offset,
        offset + ACTIVE_COUNT_SPACE_ID_CHUNK_SIZE
      );
      const rows = await input.db.query<{
        active_count?: unknown;
        space_id?: unknown;
        target_profile_id?: unknown;
      }>({
        text: `
          SELECT space_id, target_profile_id, COUNT(*) AS active_count
          FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions"
          WHERE space_id = ANY($1::text[])
            AND status = ANY($2::text[])
            AND updated_at_ms >= $3
          GROUP BY space_id, target_profile_id
        `,
        values: [chunk, ACTIVE_WAKE_PROGRESS_STATUSES, input.freshAfterMs],
      });
      for (const row of rows.rows ?? []) {
        const spaceId = typeof row.space_id === "string" ? row.space_id : "";
        const targetProfileId =
          typeof row.target_profile_id === "string"
            ? row.target_profile_id
            : "";
        const activeCount =
          typeof row.active_count === "number" &&
          Number.isFinite(row.active_count)
            ? Math.trunc(row.active_count)
            : 0;
        if (
          spaceId.length > 0 &&
          targetProfileId.length > 0 &&
          activeCount > 0
        ) {
          targets.push({
            activeWakeCount: activeCount,
            spaceId,
            targetProfileId,
          });
        }
      }
    }
    return targets;
  };
export const readRuntimeCoordinatorExecutionProjectionById = async (input: {
  db: PostgresDatabase;
  runtimeCoordinatorExecutionId: string;
}): Promise<RuntimeCoordinatorExecutionRecord | null> => {
  const row = await readRuntimeCoordinatorExecutionRow({
    db: input.db,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
  });
  return row ? mapRuntimeCoordinatorExecutionRow(row) : null;
};
export const listRuntimeCoordinatorCreationDiagnosticsByDispatch =
  async (input: {
    db: PostgresDatabase;
    dispatchId: string;
    limit?: number;
    spaceId: string;
    targetProfileId: string;
  }): Promise<RuntimeCoordinatorExecutionCreationDiagnostic[]> => {
    const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20)));
    const rows = await input.db.query<RuntimeCoordinatorCreationDiagnosticRow>({
      text: `
        SELECT
          model_version,
          space_id,
          dispatch_id,
          target_profile_id,
          source_client_message_id,
          creation_status,
          reason_code,
          observed_at_ms,
          legacy_attempt_id
        FROM "openmeld"."openMeldDaemon_runtime_coordinator_creation_diagnostics"
        WHERE space_id = $1 AND dispatch_id = $2 AND target_profile_id = $3
        ORDER BY observed_at_ms DESC NULLS LAST
        LIMIT $4
      `,
      values: [input.spaceId, input.dispatchId, input.targetProfileId, limit],
    });
    return rows.rows.map(mapRuntimeCoordinatorCreationDiagnosticRow);
  };
export const listRuntimeCoordinatorExecutionEventsByExecutionId =
  async (input: {
    db: PostgresDatabase;
    limit?: number;
    runtimeCoordinatorExecutionId: string;
  }): Promise<RuntimeCoordinatorExecutionEvent[]> => {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 50)));
    const rows = await input.db.query<RuntimeCoordinatorExecutionEventRow>({
      text: `
        SELECT
          event_id,
          runtime_coordinator_execution_id,
          event_type,
          status_after,
          reason_code,
          observed_at_ms,
          idempotency_key,
          payload_json
        FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events"
        WHERE runtime_coordinator_execution_id = $1
        ORDER BY observed_at_ms ASC NULLS FIRST, event_id ASC NULLS FIRST
        LIMIT $2
      `,
      values: [input.runtimeCoordinatorExecutionId, limit],
    });
    return rows.rows.map(mapRuntimeCoordinatorExecutionEventRow);
  };
export const hasRuntimeCoordinatorWakeStopRequestedEvent = async (input: {
  db: PostgresDatabase;
  reasonCode: string;
  runtimeCoordinatorExecutionId: string;
}): Promise<boolean> => {
  const row = await input.db
    .query<{
      event_id: string;
    }>({
      text: `
        SELECT event_id
        FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events"
        WHERE runtime_coordinator_execution_id = $1
          AND event_type = $2
          AND reason_code = $3
        LIMIT 1
      `,
      values: [
        input.runtimeCoordinatorExecutionId,
        "cancellation_requested",
        input.reasonCode,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row !== null;
};
const readRuntimeCoordinatorExecutionRow = async (input: {
  db: PostgresDatabase;
  runtimeCoordinatorExecutionId: string;
}): Promise<RuntimeCoordinatorExecutionRow | null> => {
  return await input.db
    .query<RuntimeCoordinatorExecutionRow>({
      text: `
        SELECT
          runtime_coordinator_execution_id,
          model_version,
          space_id,
          dispatch_id,
          target_profile_id,
          source_client_message_id,
          openmeld_service_runtime_id_source,
          openmeld_service_runtime_id,
          binding_id,
          agent_controller_ref,
          status,
          terminal_outcome_json,
          attempt_id,
          claim_lease_id,
          daemon_session_id,
          connection_generation,
          lease_epoch,
          created_at_ms,
          updated_at_ms
        FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions"
        WHERE runtime_coordinator_execution_id = $1
        LIMIT 1
      `,
      values: [input.runtimeCoordinatorExecutionId],
    })
    .then((result) => result.rows[0] ?? null);
};
const mapRuntimeCoordinatorExecutionRow = (
  row: RuntimeCoordinatorExecutionRow
): RuntimeCoordinatorExecutionRecord => {
  const record = {
    bindingId: row.binding_id,
    agentControllerRef: row.agent_controller_ref,
    createdAtMs: row.created_at_ms,
    dispatchId: row.dispatch_id,
    legacyPointers: {
      attemptId: row.attempt_id,
      claimLeaseId: row.claim_lease_id,
      connectionGeneration: row.connection_generation,
      daemonSessionId: row.daemon_session_id,
      leaseEpoch: row.lease_epoch,
    },
    modelVersion: row.model_version,
    runtimeCoordinatorExecutionId: row.runtime_coordinator_execution_id,
    openMeldServiceRuntimeId: {
      source: row.openmeld_service_runtime_id_source,
      value: row.openmeld_service_runtime_id,
    },
    sourceClientMessageId: row.source_client_message_id,
    spaceId: row.space_id,
    status: row.status,
    targetProfileId: row.target_profile_id,
    terminalOutcome: parseNullableJson(row.terminal_outcome_json),
    updatedAtMs: row.updated_at_ms,
  };
  const parsed = runtimeCoordinatorExecutionRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new Error("runtime coordinator execution projection row is invalid");
  }
  return parsed.data;
};
const mapRuntimeCoordinatorExecutionWakeProgressSelectorRow = (
  row: RuntimeCoordinatorExecutionWakeProgressSelectorRow
): RuntimeCoordinatorExecutionWakeProgressSelector[] => {
  const createdAtMs =
    typeof row.created_at_ms === "number" && Number.isFinite(row.created_at_ms)
      ? row.created_at_ms
      : null;
  const dispatchId =
    typeof row.dispatch_id === "string" && row.dispatch_id.trim().length > 0
      ? row.dispatch_id.trim()
      : null;
  const runtimeCoordinatorExecutionId =
    typeof row.runtime_coordinator_execution_id === "string" &&
    row.runtime_coordinator_execution_id.trim().length > 0
      ? row.runtime_coordinator_execution_id.trim()
      : null;
  const targetProfileId =
    typeof row.target_profile_id === "string" &&
    row.target_profile_id.trim().length > 0
      ? row.target_profile_id.trim()
      : null;
  const updatedAtMs =
    typeof row.updated_at_ms === "number" && Number.isFinite(row.updated_at_ms)
      ? row.updated_at_ms
      : null;
  const openMeldServiceRuntimeId =
    typeof row.openmeld_service_runtime_id === "string" &&
    row.openmeld_service_runtime_id.trim().length > 0
      ? {
          source: "runtime_registry_authority" as const,
          value: row.openmeld_service_runtime_id.trim(),
        }
      : null;
  const status = runtimeCoordinatorExecutionStatusFromUnknown(row.status);
  if (
    !(
      dispatchId &&
      createdAtMs !== null &&
      runtimeCoordinatorExecutionId &&
      status &&
      targetProfileId &&
      updatedAtMs !== null &&
      openMeldServiceRuntimeId
    )
  ) {
    return [];
  }
  return [
    {
      createdAtMs,
      runningAtMs: readRunningTimestamp(row.running_at_ms),
      dispatchId,
      latestDispatchAttemptStatus:
        typeof row.latest_dispatch_attempt_status === "string" &&
        row.latest_dispatch_attempt_status.trim().length > 0
          ? row.latest_dispatch_attempt_status.trim()
          : null,
      locallyQueued: isLocallyQueuedSelectorRow(status, row),
      runtimeCoordinatorExecutionId,
      sourceClientMessageId:
        typeof row.source_client_message_id === "string" &&
        row.source_client_message_id.trim().length > 0
          ? row.source_client_message_id.trim()
          : null,
      sourceEventId:
        typeof row.source_event_id === "string" &&
        row.source_event_id.trim().length > 0
          ? row.source_event_id.trim()
          : null,
      status,
      targetProfileId,
      updatedAtMs,
      waitReasonCode: resolveWakeProgressSelectorWaitReasonCode(row),
      openMeldServiceRuntimeId,
    },
  ];
};
const isLocallyQueuedSelectorRow = (
  status: RuntimeCoordinatorExecutionStatus,
  row: RuntimeCoordinatorExecutionWakeProgressSelectorRow
): boolean =>
  status === "accepted_local" &&
  readLocalQueuePayload(row.latest_local_queue_payload_json)?.status ===
    "queued";
const resolveWakeProgressWaitReasonCodeFromOccupancyPayload = (
  value: unknown
): WakeProgressWaitReasonCode | null => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  try {
    const payload = JSON.parse(value) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const occupancy = (payload as Record<string, unknown>)
      .agentControllerConversationOccupancy;
    if (
      !occupancy ||
      typeof occupancy !== "object" ||
      Array.isArray(occupancy)
    ) {
      return null;
    }
    return (occupancy as Record<string, unknown>).state === "occupied"
      ? WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
      : null;
  } catch {
    return null;
  }
};
const resolveWakeProgressSelectorWaitReasonCode = (
  row: RuntimeCoordinatorExecutionWakeProgressSelectorRow
): WakeProgressWaitReasonCode | null =>
  resolveWakeProgressWaitReasonCodeFromOccupancyPayload(
    row.latest_occupancy_payload_json
  ) ??
  resolveWakeProgressWaitReasonCodeFromLocalQueuePayload(
    row.latest_local_queue_payload_json
  );
/** The Service `localQueue` of the latest accepted_local lifecycle event. */
const readLocalQueuePayload = (
  value: unknown
): { status?: unknown; waitReason?: unknown } | null => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  try {
    const localQueue = (JSON.parse(value) as { localQueue?: unknown } | null)
      ?.localQueue;
    return localQueue && typeof localQueue === "object"
      ? (localQueue as { status?: unknown; waitReason?: unknown })
      : null;
  } catch {
    return null;
  }
};
/** Only a task still queued on the computer carries its local wait reason. */
const resolveWakeProgressWaitReasonCodeFromLocalQueuePayload = (
  value: unknown
): WakeProgressWaitReasonCode | null =>
  resolveWakeProgressLocalQueueWaitReasonCode(readLocalQueuePayload(value));
const runtimeCoordinatorExecutionStatusFromUnknown = (
  value: unknown
): RuntimeCoordinatorExecutionStatus | null => {
  if (typeof value !== "string") {
    return null;
  }
  return ACTIVE_WAKE_PROGRESS_STATUSES.includes(
    value as RuntimeCoordinatorExecutionStatus
  )
    ? (value as RuntimeCoordinatorExecutionStatus)
    : null;
};
const mapRuntimeCoordinatorCreationDiagnosticRow = (
  row: RuntimeCoordinatorCreationDiagnosticRow
): RuntimeCoordinatorExecutionCreationDiagnostic => {
  const diagnostic = {
    creationStatus: row.creation_status,
    dispatchId: row.dispatch_id,
    legacyAttemptId: row.legacy_attempt_id,
    modelVersion: row.model_version,
    observedAtMs: row.observed_at_ms,
    reasonCode: row.reason_code,
    sourceClientMessageId: row.source_client_message_id,
    spaceId: row.space_id,
    targetProfileId: row.target_profile_id,
  };
  const parsed =
    runtimeCoordinatorExecutionCreationDiagnosticSchema.safeParse(diagnostic);
  if (!parsed.success) {
    throw new Error("runtime coordinator creation diagnostic row is invalid");
  }
  return parsed.data;
};
const mapRuntimeCoordinatorExecutionEventRow = (
  row: RuntimeCoordinatorExecutionEventRow
): RuntimeCoordinatorExecutionEvent => {
  const event = {
    eventId: row.event_id,
    eventType: row.event_type,
    idempotencyKey: row.idempotency_key,
    observedAtMs: row.observed_at_ms,
    payloadJson: row.payload_json,
    reasonCode: row.reason_code,
    runtimeCoordinatorExecutionId: row.runtime_coordinator_execution_id,
    statusAfter: row.status_after,
  };
  const parsed = runtimeCoordinatorExecutionEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new Error("runtime coordinator execution event row is invalid");
  }
  return parsed.data;
};
const buildRuntimeCoordinatorCreationDiagnosticId = (
  diagnostic: RuntimeCoordinatorExecutionCreationDiagnostic
): string => {
  return [
    "rce_diag_v1",
    encodeLengthPrefixedIdPart(diagnostic.spaceId),
    encodeLengthPrefixedIdPart(diagnostic.dispatchId),
    encodeLengthPrefixedIdPart(diagnostic.targetProfileId),
    encodeLengthPrefixedIdPart(diagnostic.reasonCode),
    encodeLengthPrefixedIdPart(diagnostic.legacyAttemptId ?? "none"),
  ].join("|");
};
export const buildRuntimeCoordinatorCreationDiagnostic = (input: {
  dispatchId: string;
  legacyAttemptId?: string | null;
  observedAtMs: number;
  reasonCode: string;
  sourceClientMessageId?: string | null;
  spaceId: string;
  targetProfileId: string;
}): RuntimeCoordinatorExecutionCreationDiagnostic => {
  return {
    creationStatus: "not_created",
    dispatchId: input.dispatchId,
    legacyAttemptId: input.legacyAttemptId ?? null,
    modelVersion: RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
    observedAtMs: input.observedAtMs,
    reasonCode: input.reasonCode,
    sourceClientMessageId: input.sourceClientMessageId ?? null,
    spaceId: input.spaceId,
    targetProfileId: input.targetProfileId,
  };
};
const stringifyNullableJson = (value: unknown): string | null => {
  return value === null || value === undefined ? null : JSON.stringify(value);
};
const parseNullableJson = (value: string | null): unknown => {
  if (value === null) {
    return null;
  }
  return JSON.parse(value) as unknown;
};
const encodeLengthPrefixedIdPart = (value: string): string => {
  return `${value.length}:${value}`;
};
