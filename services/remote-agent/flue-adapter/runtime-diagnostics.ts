import { remoteAgentWorkerRuntimeDiagnosticsResponseSchema } from "@openmeld/schemas";
import type { RemoteAgentWorkerRuntimeDiagnosticsResponse } from "@openmeld/schemas/types";
import { REMOTE_AGENT_CALLBACK_CONTEXT_KEY_PREFIX } from "../agent-core/callback-context";

const RUNTIME_DIAGNOSTIC_ROW_LIMIT = 50;

type SqlResult = {
  toArray(): Record<string, unknown>[];
};

type SqlStorage = {
  exec(query: string, ...bindings: unknown[]): SqlResult;
};

export async function readRemoteAgentRuntimeDiagnostics(input: {
  getAlarmAtMs: () => Promise<number | null>;
  nowMs?: number;
  spaceId: string;
  sql: SqlStorage;
}): Promise<RemoteAgentWorkerRuntimeDiagnosticsResponse> {
  const submissions = input.sql
    .exec(
      `
        SELECT
          sequence,
          submission_id,
          kind,
          status,
          accepted_at,
          canonical_ready_at,
          attempt_id,
          input_applied_at,
          recovery_requested_at,
          abort_requested_at,
          started_at,
          settled_at,
          attempt_count,
          max_retry,
          timeout_at,
          owner_id,
          lease_expires_at
        FROM flue_agent_submissions
        ORDER BY sequence DESC
        LIMIT ${RUNTIME_DIAGNOSTIC_ROW_LIMIT}
      `
    )
    .toArray()
    .map((row) => ({
      abortRequestedAtMs: nullableNumber(row.abort_requested_at),
      acceptedAtMs: requiredNumber(row.accepted_at),
      attemptCount: requiredNumber(row.attempt_count),
      attemptId: nullableString(row.attempt_id),
      canonicalReadyAtMs: nullableNumber(row.canonical_ready_at),
      inputAppliedAtMs: nullableNumber(row.input_applied_at),
      kind: requiredString(row.kind),
      leaseExpiresAtMs: requiredNumber(row.lease_expires_at),
      maxRetry: requiredNumber(row.max_retry),
      ownerId: nullableString(row.owner_id),
      recoveryRequestedAtMs: nullableNumber(row.recovery_requested_at),
      sequence: requiredNumber(row.sequence),
      settledAtMs: nullableNumber(row.settled_at),
      startedAtMs: nullableNumber(row.started_at),
      status: requiredString(row.status),
      submissionId: requiredString(row.submission_id),
      timeoutAtMs: requiredNumber(row.timeout_at),
    }));
  const attemptMarkers = input.sql
    .exec(
      `
        SELECT submission_id, attempt_id, created_at
        FROM flue_agent_attempt_markers
        ORDER BY created_at DESC
        LIMIT ${RUNTIME_DIAGNOSTIC_ROW_LIMIT}
      `
    )
    .toArray()
    .map((row) => ({
      attemptId: requiredString(row.attempt_id),
      createdAtMs: requiredNumber(row.created_at),
      submissionId: requiredString(row.submission_id),
    }));
  const activeRuns = input.sql
    .exec(
      `
        SELECT id, name, created_at
        FROM cf_agents_runs
        ORDER BY created_at DESC
        LIMIT ${RUNTIME_DIAGNOSTIC_ROW_LIMIT}
      `
    )
    .toArray()
    .map((row) => ({
      createdAtMs: requiredNumber(row.created_at),
      id: requiredString(row.id),
      name: requiredString(row.name),
    }));
  const fibers = input.sql
    .exec(
      `
        SELECT
          fiber_id,
          idempotency_key,
          name,
          status,
          created_at,
          started_at,
          completed_at
        FROM cf_agents_fibers
        ORDER BY created_at DESC
        LIMIT ${RUNTIME_DIAGNOSTIC_ROW_LIMIT}
      `
    )
    .toArray()
    .map((row) => ({
      completedAtMs: nullableNumber(row.completed_at),
      createdAtMs: requiredNumber(row.created_at),
      fiberId: requiredString(row.fiber_id),
      idempotencyKey: nullableString(row.idempotency_key),
      name: requiredString(row.name),
      startedAtMs: nullableNumber(row.started_at),
      status: requiredString(row.status),
    }));
  const schedules = input.sql
    .exec(
      `
        SELECT
          id,
          callback,
          type,
          time,
          delayInSeconds,
          running,
          created_at,
          execution_started_at
        FROM cf_agents_schedules
        ORDER BY created_at DESC
        LIMIT ${RUNTIME_DIAGNOSTIC_ROW_LIMIT}
      `
    )
    .toArray()
    .map((row) => ({
      callback: nullableString(row.callback),
      createdAtSeconds: requiredNumber(row.created_at),
      delayInSeconds: nullableNumber(row.delayInSeconds),
      executionStartedAtMs: nullableNumber(row.execution_started_at),
      id: requiredString(row.id),
      running: requiredNumber(row.running) !== 0,
      timeMs: nullableNumber(row.time),
      type: requiredString(row.type),
    }));
  const callbackContexts = input.sql
    .exec(
      `
        SELECT value_json, updated_at_ms
        FROM openmeld_remote_agent_adapter_kv
        WHERE key >= ? AND key < ?
        ORDER BY updated_at_ms DESC
        LIMIT ${RUNTIME_DIAGNOSTIC_ROW_LIMIT}
      `,
      REMOTE_AGENT_CALLBACK_CONTEXT_KEY_PREFIX,
      `${REMOTE_AGENT_CALLBACK_CONTEXT_KEY_PREFIX}\uffff`
    )
    .toArray()
    .map((row) => {
      const context = requiredRecord(
        JSON.parse(requiredString(row.value_json))
      );
      const lastCoreResponse = nullableRecord(context.lastCoreResponse);
      const lastFailure =
        nullableRecord(context.lastFailureFact) ??
        nullableRecord(context.terminalFailureFact);
      return {
        callbackAttempts: requiredNumber(context.callbackAttempts),
        callbackCompletedAt: nullableString(context.callbackCompletedAt),
        callbackNextAttemptAt: nullableString(context.callbackNextAttemptAt),
        callbackStatus: requiredString(context.callbackStatus),
        dispatchId: requiredString(context.dispatchId),
        hasCompletedText:
          typeof context.completedText === "string" &&
          context.completedText.length > 0,
        lastCoreResponseReasonCode: nullableString(
          lastCoreResponse?.reasonCode
        ),
        lastCoreResponseStatus: nullableString(lastCoreResponse?.status),
        lastFailureCode: nullableString(lastFailure?.code),
        submissionId: requiredString(context.submissionId),
        updatedAtMs: requiredNumber(row.updated_at_ms),
      };
    });

  return remoteAgentWorkerRuntimeDiagnosticsResponseSchema.parse({
    activeRuns,
    attemptMarkers,
    callbackContexts,
    collectedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
    durableObjectAlarmAtMs: await input.getAlarmAtMs(),
    fibers,
    schedules,
    spaceId: input.spaceId,
    submissions,
    v: 1,
  });
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function requiredNumber(value: unknown): number {
  return Number(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function requiredString(value: unknown): string {
  return String(value);
}

function nullableRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new Error("Remote Agent callback diagnostic record is invalid.");
  }
  return value as Record<string, unknown>;
}
