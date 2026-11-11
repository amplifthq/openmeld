import { remoteAgentWorkerRuntimeDiagnosticsResponseSchema } from "@openmeld/schemas";
import type { RemoteAgentWorkerRuntimeDiagnosticsResponse } from "@openmeld/schemas/types";
import type { Schedule } from "agents";
import { REMOTE_AGENT_CALLBACK_CONTEXT_KEY_PREFIX } from "../agent-core/callback-context";
import {
  projectStoredRemoteAgentTurnObservability,
  REMOTE_AGENT_TURN_OBSERVABILITY_KEY_PREFIX,
} from "../agent-core/turn-observability";

const RUNTIME_DIAGNOSTIC_ROW_LIMIT = 50;

type SqlResult = {
  toArray(): Record<string, unknown>[];
};

type SqlStorage = {
  exec(query: string, ...bindings: unknown[]): SqlResult;
};

export async function readRemoteAgentRuntimeDiagnostics(input: {
  getAlarmAtMs: () => Promise<number | null>;
  listSchedules: () => Promise<Schedule<unknown>[]>;
  nowMs?: number;
  spaceId: string;
  sql: SqlStorage;
}): Promise<RemoteAgentWorkerRuntimeDiagnosticsResponse> {
  const nowMs = input.nowMs ?? Date.now();
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
          joined_into,
          abort_requested_at,
          started_at,
          settled_at,
          attempt_count,
          max_attempts,
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
      maxAttempts: requiredNumber(row.max_attempts),
      ownerId: nullableString(row.owner_id),
      joinedInto: nullableString(row.joined_into),
      sequence: requiredNumber(row.sequence),
      settledAtMs: nullableNumber(row.settled_at),
      startedAtMs: nullableNumber(row.started_at),
      status: requiredString(row.status),
      submissionId: requiredString(row.submission_id),
      timeoutAtMs: requiredNumber(row.timeout_at),
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
  const schedules = (await input.listSchedules())
    .toSorted((a, b) => b.time - a.time || a.id.localeCompare(b.id))
    .slice(0, RUNTIME_DIAGNOSTIC_ROW_LIMIT)
    .map((schedule) => ({
      callback: schedule.callback,
      delayInSeconds:
        schedule.type === "delayed" ? schedule.delayInSeconds : null,
      id: schedule.id,
      timeMs: schedule.time * 1000,
      type: schedule.type,
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
        ...(context.conversationCompaction
          ? { conversationCompaction: context.conversationCompaction }
          : {}),
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
  const turnObservability = input.sql
    .exec(
      `
        SELECT key, value_json
        FROM openmeld_remote_agent_adapter_kv AS turn_observability
        WHERE key >= ? AND key < ?
        ORDER BY updated_at_ms DESC
        LIMIT ${RUNTIME_DIAGNOSTIC_ROW_LIMIT}
      `,
      REMOTE_AGENT_TURN_OBSERVABILITY_KEY_PREFIX,
      `${REMOTE_AGENT_TURN_OBSERVABILITY_KEY_PREFIX}\uffff`
    )
    .toArray()
    .flatMap((row) => {
      const key = requiredString(row.key);
      const submissionId = decodeURIComponent(
        key.slice(REMOTE_AGENT_TURN_OBSERVABILITY_KEY_PREFIX.length)
      );
      const evidence = projectStoredRemoteAgentTurnObservability({
        nowMs,
        submissionId,
        value: JSON.parse(requiredString(row.value_json)),
      });
      return evidence ? [evidence] : [];
    });

  return remoteAgentWorkerRuntimeDiagnosticsResponseSchema.parse({
    activeRuns,
    callbackContexts,
    collectedAt: new Date(nowMs).toISOString(),
    durableObjectAlarmAtMs: await input.getAlarmAtMs(),
    fibers,
    schedules,
    spaceId: input.spaceId,
    submissions,
    turnObservability,
    v: 3,
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
