import {
  buildRuntimeCoordinatorExecutionEventId,
  RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION,
  runtimeCoordinatorExecutionCreationDiagnosticSchema,
  runtimeCoordinatorExecutionEventSchema,
  runtimeCoordinatorExecutionRecordSchema,
} from "@openmeld/schemas";
import type {
  RuntimeCoordinatorExecutionCreationDiagnostic,
  RuntimeCoordinatorExecutionEvent,
  RuntimeCoordinatorExecutionEventType,
  RuntimeCoordinatorExecutionRecord,
  RuntimeCoordinatorExecutionStatus,
} from "@openmeld/schemas/types";
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
  dispatchId: string;
  latestDispatchAttemptStatus: string | null;
  runtimeCoordinatorExecutionId: string;
  sourceClientMessageId: string | null;
  sourceEventId: string | null;
  status: RuntimeCoordinatorExecutionStatus;
  targetProfileId: string;
  updatedAtMs: number;
  openMeldServiceRuntimeId: RuntimeCoordinatorExecutionRecord["openMeldServiceRuntimeId"];
};

type RuntimeCoordinatorExecutionWakeProgressSelectorRow = {
  created_at_ms?: unknown;
  dispatch_id?: unknown;
  latest_dispatch_attempt_status?: unknown;
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
  db: D1Database;
  record: RuntimeCoordinatorExecutionRecord;
}): Promise<"created" | "skipped_stale" | "updated"> => {
  const parsed = runtimeCoordinatorExecutionRecordSchema.safeParse(
    input.record
  );
  if (!parsed.success) {
    throw new Error("invalid runtime coordinator execution projection");
  }
  const record = parsed.data;
  const existing = await readRuntimeCoordinatorExecutionRow({
    db: input.db,
    runtimeCoordinatorExecutionId: record.runtimeCoordinatorExecutionId,
  });

  if (existing) {
    const existingRank = STATUS_RANK[existing.status];
    const nextRank = STATUS_RANK[record.status];
    if (
      LOCKED_TERMINAL_STATUSES.has(existing.status) &&
      (!LOCKED_TERMINAL_STATUSES.has(record.status) ||
        existing.status !== record.status)
    ) {
      return "skipped_stale";
    }
    if (
      nextRank < existingRank ||
      (nextRank === existingRank && record.updatedAtMs < existing.updated_at_ms)
    ) {
      return "skipped_stale";
    }

    const updateResult = await input.db
      .prepare(
        `
          UPDATE openMeldDaemon_runtime_coordinator_executions
          SET
            model_version = ?,
            space_id = ?,
            dispatch_id = ?,
            target_profile_id = ?,
            source_client_message_id = ?,
            openmeld_service_runtime_id_source = ?,
            openmeld_service_runtime_id = ?,
            binding_id = ?,
            agent_controller_ref = ?,
            status = ?,
            terminal_outcome_json = ?,
            attempt_id = ?,
            claim_lease_id = ?,
            daemon_session_id = ?,
            connection_generation = ?,
            lease_epoch = ?,
            updated_at_ms = ?
          WHERE runtime_coordinator_execution_id = ?
            AND status = ?
            AND updated_at_ms = ?
        `
      )
      .bind(
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
        record.updatedAtMs,
        record.runtimeCoordinatorExecutionId,
        existing.status,
        existing.updated_at_ms
      )
      .run();
    return updateResult.meta.changes === 0 ? "skipped_stale" : "updated";
  }

  await input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_runtime_coordinator_executions (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
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
      record.updatedAtMs
    )
    .run();
  return "created";
};

export const writeRuntimeCoordinatorTerminalExecutionProjectionWithoutRead =
  async (input: {
    db: D1Database;
    record: RuntimeCoordinatorExecutionRecord;
  }): Promise<void> => {
    const parsed = runtimeCoordinatorExecutionRecordSchema.safeParse(
      input.record
    );
    if (!parsed.success) {
      throw new Error("invalid runtime coordinator execution projection");
    }
    const record = parsed.data;
    await input.db
      .prepare(
        `
          INSERT INTO openMeldDaemon_runtime_coordinator_executions (
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            openMeldDaemon_runtime_coordinator_executions.status IN ('cancelled', 'failed_terminal', 'reply_published')
            AND openMeldDaemon_runtime_coordinator_executions.status <> excluded.status
          )
        `
      )
      .bind(
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
        record.updatedAtMs
      )
      .run();
  };

export const writeRuntimeCoordinatorExecutionEvent = async (input: {
  db: D1Database;
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
        INSERT INTO openMeldDaemon_runtime_coordinator_execution_events (
          event_id,
          runtime_coordinator_execution_id,
          event_type,
          status_after,
          reason_code,
          observed_at_ms,
          idempotency_key,
          payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
          status_after = excluded.status_after,
          reason_code = excluded.reason_code,
          observed_at_ms = excluded.observed_at_ms,
          payload_json = excluded.payload_json
      `
    : `
        INSERT OR IGNORE INTO openMeldDaemon_runtime_coordinator_execution_events (
          event_id,
          runtime_coordinator_execution_id,
          event_type,
          status_after,
          reason_code,
          observed_at_ms,
          idempotency_key,
          payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
  await input.db
    .prepare(insertMode)
    .bind(
      event.eventId,
      event.runtimeCoordinatorExecutionId,
      event.eventType,
      event.statusAfter,
      event.reasonCode,
      event.observedAtMs,
      event.idempotencyKey,
      event.payloadJson
    )
    .run();
};

export const writeRuntimeCoordinatorExecutionEventFromParts = async (input: {
  db: D1Database;
  eventType: RuntimeCoordinatorExecutionEventType;
  idempotencyKey: string;
  observedAtMs: number;
  payload: Record<string, unknown>;
  reasonCode?: string | null;
  replaceCurrentState?: boolean;
  runtimeCoordinatorExecutionId: string;
  statusAfter?: RuntimeCoordinatorExecutionStatus | null;
}): Promise<void> => {
  await writeRuntimeCoordinatorExecutionEvent({
    db: input.db,
    event: {
      eventId: buildRuntimeCoordinatorExecutionEventId({
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      }),
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
  db: D1Database;
  diagnostic: RuntimeCoordinatorExecutionCreationDiagnostic;
}): Promise<void> => {
  const parsed = runtimeCoordinatorExecutionCreationDiagnosticSchema.safeParse(
    input.diagnostic
  );
  if (!parsed.success) {
    throw new Error("invalid runtime coordinator creation diagnostic");
  }
  const diagnostic = parsed.data;
  await input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_runtime_coordinator_creation_diagnostics (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(diagnostic_id) DO UPDATE SET
          observed_at_ms = excluded.observed_at_ms
      `
    )
    .bind(
      buildRuntimeCoordinatorCreationDiagnosticId(diagnostic),
      diagnostic.modelVersion,
      diagnostic.spaceId,
      diagnostic.dispatchId,
      diagnostic.targetProfileId,
      diagnostic.sourceClientMessageId,
      diagnostic.creationStatus,
      diagnostic.reasonCode,
      diagnostic.observedAtMs,
      diagnostic.legacyAttemptId
    )
    .run();
};

export const readRuntimeCoordinatorExecutionProjectionByDispatch =
  async (input: {
    db: D1Database;
    dispatchId: string;
    spaceId: string;
    targetProfileId: string;
  }): Promise<RuntimeCoordinatorExecutionRecord | null> => {
    const row = await input.db
      .prepare(
        `
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
        FROM openMeldDaemon_runtime_coordinator_executions
        WHERE space_id = ? AND dispatch_id = ? AND target_profile_id = ?
        ORDER BY updated_at_ms DESC
        LIMIT 1
      `
      )
      .bind(input.spaceId, input.dispatchId, input.targetProfileId)
      .first<RuntimeCoordinatorExecutionRow>();
    return row ? mapRuntimeCoordinatorExecutionRow(row) : null;
  };

export const listActiveRuntimeCoordinatorExecutionProjectionsBySpace =
  async (input: {
    db: D1Database;
    limit?: number;
    spaceId: string;
    targetProfileId?: string;
  }): Promise<RuntimeCoordinatorExecutionRecord[]> => {
    const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 25)));
    const targetProfileId = input.targetProfileId?.trim() || null;
    const statusPlaceholders = ACTIVE_WAKE_PROGRESS_STATUSES.map(
      () => "?"
    ).join(", ");
    const whereTargetSql = targetProfileId ? "AND target_profile_id = ?" : "";
    const statement = input.db.prepare(
      `
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
        FROM openMeldDaemon_runtime_coordinator_executions
        WHERE space_id = ?
          AND status IN (${statusPlaceholders})
          ${whereTargetSql}
        ORDER BY updated_at_ms DESC, runtime_coordinator_execution_id DESC
        LIMIT ?
      `
    );
    const bindings = targetProfileId
      ? [
          input.spaceId,
          ...ACTIVE_WAKE_PROGRESS_STATUSES,
          targetProfileId,
          limit,
        ]
      : [input.spaceId, ...ACTIVE_WAKE_PROGRESS_STATUSES, limit];
    const rows = await statement
      .bind(...bindings)
      .all<RuntimeCoordinatorExecutionRow>();

    return rows.results.map(mapRuntimeCoordinatorExecutionRow);
  };

export const listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace =
  async (input: {
    db: D1Database;
    limit?: number;
    spaceId: string;
    targetProfileId?: string;
  }): Promise<RuntimeCoordinatorExecutionWakeProgressSelector[]> => {
    const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 25)));
    const targetProfileId = input.targetProfileId?.trim() || null;
    const statusPlaceholders = ACTIVE_WAKE_PROGRESS_STATUSES.map(
      () => "?"
    ).join(", ");
    const whereTargetSql = targetProfileId
      ? "AND executions.target_profile_id = ?"
      : "";
    const statement = input.db.prepare(
      `
        SELECT
          executions.runtime_coordinator_execution_id,
          executions.openmeld_service_runtime_id,
          executions.dispatch_id,
          executions.target_profile_id,
          executions.source_client_message_id,
          executions.status,
          executions.created_at_ms,
          executions.updated_at_ms,
          ledger.source_event_id,
          latest_attempt.status AS latest_dispatch_attempt_status
        FROM openMeldDaemon_runtime_coordinator_executions AS executions
        LEFT JOIN openMeldDaemon_dispatch_ledger AS ledger
          ON ledger.space_id = executions.space_id
          AND ledger.dispatch_id = executions.dispatch_id
          AND ledger.target_profile_id = executions.target_profile_id
        LEFT JOIN openMeldDaemon_dispatch_attempts AS latest_attempt
          ON latest_attempt.attempt_id = ledger.latest_attempt_id
        WHERE executions.space_id = ?
          AND executions.status IN (${statusPlaceholders})
          ${whereTargetSql}
        ORDER BY executions.updated_at_ms DESC,
          executions.runtime_coordinator_execution_id DESC
        LIMIT ?
      `
    );
    const bindings = targetProfileId
      ? [
          input.spaceId,
          ...ACTIVE_WAKE_PROGRESS_STATUSES,
          targetProfileId,
          limit,
        ]
      : [input.spaceId, ...ACTIVE_WAKE_PROGRESS_STATUSES, limit];
    const rows = await statement
      .bind(...bindings)
      .all<RuntimeCoordinatorExecutionWakeProgressSelectorRow>();

    return rows.results.flatMap((row) =>
      mapRuntimeCoordinatorExecutionWakeProgressSelectorRow(row)
    );
  };

// Keeps every chunked statement within D1's bound-parameter limit (100):
// chunk spaceIds + ACTIVE_WAKE_PROGRESS_STATUSES + freshAfterMs.
const ACTIVE_COUNT_SPACE_ID_CHUNK_SIZE = 80;

export type ActiveRuntimeCoordinatorExecutionTargetCount = {
  activeWakeCount: number;
  spaceId: string;
  targetProfileId: string;
};

export const listActiveRuntimeCoordinatorExecutionTargetsBySpaceIds =
  async (input: {
    db: D1Database;
    freshAfterMs: number;
    spaceIds: readonly string[];
  }): Promise<ActiveRuntimeCoordinatorExecutionTargetCount[]> => {
    const targets: ActiveRuntimeCoordinatorExecutionTargetCount[] = [];
    const statusPlaceholders = ACTIVE_WAKE_PROGRESS_STATUSES.map(
      () => "?"
    ).join(", ");
    for (
      let offset = 0;
      offset < input.spaceIds.length;
      offset += ACTIVE_COUNT_SPACE_ID_CHUNK_SIZE
    ) {
      const chunk = input.spaceIds.slice(
        offset,
        offset + ACTIVE_COUNT_SPACE_ID_CHUNK_SIZE
      );
      const spacePlaceholders = chunk.map(() => "?").join(", ");
      const rows = await input.db
        .prepare(
          `
          SELECT space_id, target_profile_id, COUNT(*) AS active_count
          FROM openMeldDaemon_runtime_coordinator_executions
          WHERE space_id IN (${spacePlaceholders})
            AND status IN (${statusPlaceholders})
            AND updated_at_ms >= ?
          GROUP BY space_id, target_profile_id
        `
        )
        .bind(...chunk, ...ACTIVE_WAKE_PROGRESS_STATUSES, input.freshAfterMs)
        .all<{
          active_count?: unknown;
          space_id?: unknown;
          target_profile_id?: unknown;
        }>();
      for (const row of rows.results ?? []) {
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
  db: D1Database;
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
    db: D1Database;
    dispatchId: string;
    limit?: number;
    spaceId: string;
    targetProfileId: string;
  }): Promise<RuntimeCoordinatorExecutionCreationDiagnostic[]> => {
    const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20)));
    const rows = await input.db
      .prepare(
        `
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
        FROM openMeldDaemon_runtime_coordinator_creation_diagnostics
        WHERE space_id = ? AND dispatch_id = ? AND target_profile_id = ?
        ORDER BY observed_at_ms DESC
        LIMIT ?
      `
      )
      .bind(input.spaceId, input.dispatchId, input.targetProfileId, limit)
      .all<RuntimeCoordinatorCreationDiagnosticRow>();

    return rows.results.map(mapRuntimeCoordinatorCreationDiagnosticRow);
  };

export const listRuntimeCoordinatorExecutionEventsByExecutionId =
  async (input: {
    db: D1Database;
    limit?: number;
    runtimeCoordinatorExecutionId: string;
  }): Promise<RuntimeCoordinatorExecutionEvent[]> => {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 50)));
    const rows = await input.db
      .prepare(
        `
        SELECT
          event_id,
          runtime_coordinator_execution_id,
          event_type,
          status_after,
          reason_code,
          observed_at_ms,
          idempotency_key,
          payload_json
        FROM openMeldDaemon_runtime_coordinator_execution_events
        WHERE runtime_coordinator_execution_id = ?
        ORDER BY observed_at_ms ASC, event_id ASC
        LIMIT ?
      `
      )
      .bind(input.runtimeCoordinatorExecutionId, limit)
      .all<RuntimeCoordinatorExecutionEventRow>();

    return rows.results.map(mapRuntimeCoordinatorExecutionEventRow);
  };

export const hasRuntimeCoordinatorWakeStopRequestedEvent = async (input: {
  db: D1Database;
  reasonCode: string;
  runtimeCoordinatorExecutionId: string;
}): Promise<boolean> => {
  const row = await input.db
    .prepare(
      `
        SELECT event_id
        FROM openMeldDaemon_runtime_coordinator_execution_events
        WHERE runtime_coordinator_execution_id = ?
          AND event_type = ?
          AND reason_code = ?
        LIMIT 1
      `
    )
    .bind(
      input.runtimeCoordinatorExecutionId,
      "cancellation_requested",
      input.reasonCode
    )
    .first<{ event_id: string }>();

  return row !== null;
};

const readRuntimeCoordinatorExecutionRow = async (input: {
  db: D1Database;
  runtimeCoordinatorExecutionId: string;
}): Promise<RuntimeCoordinatorExecutionRow | null> => {
  return await input.db
    .prepare(
      `
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
        FROM openMeldDaemon_runtime_coordinator_executions
        WHERE runtime_coordinator_execution_id = ?
        LIMIT 1
      `
    )
    .bind(input.runtimeCoordinatorExecutionId)
    .first<RuntimeCoordinatorExecutionRow>();
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
      dispatchId,
      latestDispatchAttemptStatus:
        typeof row.latest_dispatch_attempt_status === "string" &&
        row.latest_dispatch_attempt_status.trim().length > 0
          ? row.latest_dispatch_attempt_status.trim()
          : null,
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
      openMeldServiceRuntimeId,
    },
  ];
};

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
