import {
  buildRuntimeCoordinatorExecutionId,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchQueueMessage,
  RuntimeTransportDeliveryExecutionIdentity,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  claimDispatchAttempt,
  claimFinalReplyEmission,
  claimReplyingHintEmission,
  correlateDuplicateDispatchDeliveryAttempt,
  markDispatchAttemptWaitingForResult,
  markDispatchStatus,
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
  readDeliveryStabilityDispatchMetrics,
  recordDispatchAttemptExecutionOwnership,
  rollbackFinalReplyEmissionClaim,
  rollbackReplyingHintEmissionClaim,
} from "../dispatch/infrastructure/d1/dispatch-ledger-d1";
import {
  DISPATCH_IDEMPOTENCY_WINDOW_MS,
  DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
} from "../dispatch/rules/dispatch-runtime-constants";

type LedgerRow = {
  idempotencyKey: string;
  dispatchId: string;
  spaceId: string;
  sourceEventId: string;
  sourceClientMessageId: string | null;
  dispatchOwnerKind?: string | null;
  dispatchOwnerId?: string | null;
  targetProfileId: string;
  status: string;
  firstSeenAtMs: number;
  lastAttemptAtMs: number;
  attemptCount: number;
  latestAttemptId: string | null;
  replyHintSentAtMs: number | null;
  finalReplySentAtMs: number | null;
};

type AttemptRow = {
  attemptId: string;
  dispatchId: string;
  idempotencyKey: string;
  attemptNo: number;
  status: string;
  daemonSessionId: string | null;
  connectionGeneration: number | null;
  leaseEpoch: number | null;
  executionBindingId: string | null;
  executionAgentControllerRef: string | null;
  executionIdentityModelVersion: string | null;
  executionRuntimeId: string | null;
  targetProfileId: string | null;
  taskId: string | null;
  createdAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type DlqRow = {
  dispatchId: string;
  idempotencyKey: string;
  sourceEventId: string;
  targetProfileId: string;
  errorCode: string;
  failedAtMs: number;
};

const buildExecutionIdentity = (input: {
  dispatchId: string;
  targetProfileId: string;
}): RuntimeTransportDeliveryExecutionIdentity => ({
  authority: "core_runtime_registry_binding_route",
  core: {
    modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
    spaceId: "space-1",
    dispatchId: input.dispatchId,
    targetProfileId: input.targetProfileId,
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority",
      value: "runtime-1",
    },
    bindingId: "binding-1",
    agentControllerRef: "builtin:codex",
  },
});

const buildExpectedRuntimeCoordinatorExecutionId = (
  message: OpenMeldDaemonDispatchQueueMessage
): string =>
  buildRuntimeCoordinatorExecutionId({
    dispatchId: message.dispatchId,
    spaceId: message.spaceId,
    targetProfileId: message.targetProfileId,
  });

const createInMemoryDispatchLedgerDb = (options?: {
  failNextAttemptInsert?: boolean;
}) => {
  const rows = new Map<string, LedgerRow>();
  const attempts = new Map<string, AttemptRow>();
  const runtimeCoordinatorRows = new Map<string, Record<string, unknown>>();
  const dlqRows: DlqRow[] = [];
  const opsDecisionRows: unknown[][] = [];
  let shouldFailNextAttemptInsert = options?.failNextAttemptInsert === true;
  const safeNumber = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const normalizeOptionalText = (value: unknown): string | null => {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  };
  const fillDispatchOwnerEvidenceOnce = (
    row: LedgerRow,
    kind: unknown,
    id: unknown
  ) => {
    if (row.dispatchOwnerKind != null || row.dispatchOwnerId != null) {
      return;
    }
    const normalizedKind = normalizeOptionalText(kind);
    const normalizedId = normalizeOptionalText(id);
    if (normalizedKind !== "owner_account" || !normalizedId) {
      return;
    }
    row.dispatchOwnerKind = normalizedKind;
    row.dispatchOwnerId = normalizedId;
  };

  const readDeliveryStabilitySummary = (input: {
    observeFromMs: number;
    dispatchingTimeoutAtMs: number;
  }) => {
    const summary = {
      failed_terminal_count: 0,
      completed_relevant_count: 0,
      deduped_count: 0,
      dispatching_timeout_count: 0,
    };
    for (const row of rows.values()) {
      if (row.lastAttemptAtMs < input.observeFromMs) {
        continue;
      }
      if (row.status === "failed_terminal") {
        summary.failed_terminal_count += 1;
      }
      if (
        row.status === "succeeded" ||
        row.status === "failed_retryable" ||
        row.status === "failed_terminal" ||
        row.status === "blocked"
      ) {
        summary.completed_relevant_count += 1;
      }
      if (row.status === "deduped") {
        summary.deduped_count += 1;
      }
      if (
        row.status === "dispatching" &&
        row.lastAttemptAtMs <= input.dispatchingTimeoutAtMs
      ) {
        summary.dispatching_timeout_count += 1;
      }
    }
    return summary;
  };

  const readDeliveryStabilityColdStartCount = (input: {
    observeFromMs: number;
  }) =>
    dlqRows.reduce(
      (count, row) =>
        row.errorCode === "daemon.delivery.timeout" &&
        row.failedAtMs >= input.observeFromMs
          ? count + 1
          : count,
      0
    );

  const seedDlqRow = (input: {
    dispatchId: string;
    idempotencyKey: string;
    sourceEventId: string;
    targetProfileId: string;
    errorCode: string;
    failedAtMs: number;
  }): void => {
    dlqRows.push({
      dispatchId: input.dispatchId,
      idempotencyKey: input.idempotencyKey,
      sourceEventId: input.sourceEventId,
      targetProfileId: input.targetProfileId,
      errorCode: input.errorCode,
      failedAtMs: input.failedAtMs,
    });
  };
  const seedRuntimeCoordinatorExecution = (input: {
    attemptId?: string | null;
    daemonSessionId?: string | null;
    dispatchId: string;
    leaseEpoch?: number | null;
    status?: string;
    targetProfileId: string;
  }): void => {
    const key = ["space-1", input.dispatchId, input.targetProfileId].join("\0");
    runtimeCoordinatorRows.set(key, {
      binding_id: "binding-1",
      agent_controller_ref: "builtin:codex",
      claim_lease_id: null,
      connection_generation: 1,
      created_at_ms: 1000,
      daemon_session_id: input.daemonSessionId ?? null,
      dispatch_id: input.dispatchId,
      lease_epoch: input.leaseEpoch ?? null,
      model_version: "openmeld.runtime_coordinator.execution.v1",
      runtime_coordinator_execution_id: `rce-${input.dispatchId}`,
      openmeld_service_runtime_id: "runtime-1",
      openmeld_service_runtime_id_source: "runtime_registry_authority",
      source_client_message_id: null,
      space_id: "space-1",
      status: input.status ?? "running",
      target_profile_id: input.targetProfileId,
      terminal_outcome_json: null,
      attempt_id: input.attemptId ?? null,
      updated_at_ms: 1000,
    });
  };
  const seedAttemptRow = (row: AttemptRow): void => {
    attempts.set(row.attemptId, row);
  };

  const db = {
    prepare: (query: string) => {
      const normalizedQuery = query.toLowerCase();
      const compactQuery = normalizedQuery.replace(/\s+/g, " ");
      const queryIncludes = (sql: string) =>
        compactQuery.includes(sql.toLowerCase());
      return {
        bind: (...args: unknown[]) => ({
          first: <T>() => {
            if (
              queryIncludes("from openMeldDaemon_dispatch_ledger") &&
              queryIncludes("where idempotency_key = ?")
            ) {
              const idempotencyKey = String(args[0] ?? "");
              const row = rows.get(idempotencyKey);
              if (!row) {
                return Promise.resolve(null as T | null);
              }
              return Promise.resolve({
                idempotency_key: row.idempotencyKey,
                dispatch_id: row.dispatchId,
                first_seen_at_ms: row.firstSeenAtMs,
                last_attempt_at_ms: row.lastAttemptAtMs,
                latest_attempt_id: row.latestAttemptId,
                attempt_count: row.attemptCount,
                reply_hint_sent_at_ms: row.replyHintSentAtMs,
                status: row.status,
              } as T);
            }
            if (
              queryIncludes("from openMeldDaemon_dispatch_attempts") &&
              queryIncludes("where attempt_id = ?")
            ) {
              const attemptId = String(args[0] ?? "");
              const row = attempts.get(attemptId);
              if (!row) {
                return Promise.resolve(null as T | null);
              }
              const selectedAttemptRow: Record<string, unknown> = {
                attemptId: row.attemptId,
                attemptNo: row.attemptNo,
                status: row.status,
                connectionGeneration: row.connectionGeneration,
                daemonSessionId: row.daemonSessionId,
                leaseEpoch: row.leaseEpoch,
              };
              if (queryIncludes("error_code as errorcode")) {
                selectedAttemptRow.errorCode = row.errorCode;
              }
              return Promise.resolve({
                ...selectedAttemptRow,
              } as T);
            }
            if (
              queryIncludes(
                "from openMeldDaemon_runtime_coordinator_executions"
              )
            ) {
              const [spaceId, dispatchId, targetProfileId] = args;
              const key = [
                String(spaceId ?? ""),
                String(dispatchId ?? ""),
                String(targetProfileId ?? ""),
              ].join("\0");
              return Promise.resolve(
                (runtimeCoordinatorRows.get(key) as T | undefined) ?? null
              );
            }
            if (
              queryIncludes("from openMeldDaemon_dispatch_ledger") &&
              queryIncludes("select")
            ) {
              const dispatchingTimeoutAtMs = safeNumber(args[0]);
              const observeFromMs = safeNumber(args[1]);
              return Promise.resolve(
                readDeliveryStabilitySummary({
                  dispatchingTimeoutAtMs,
                  observeFromMs,
                }) as T
              );
            }
            if (
              queryIncludes("from openMeldDaemon_dlq") &&
              queryIncludes("count(*)")
            ) {
              const observeFromMs = safeNumber(args[0]);
              return Promise.resolve({
                cold_start_timeout_count: readDeliveryStabilityColdStartCount({
                  observeFromMs,
                }),
              } as T);
            }
            return Promise.reject(
              new Error(`unsupported first() query: ${query}`)
            );
          },
          run: () => {
            if (queryIncludes("insert into openMeldDaemon_dispatch_ledger")) {
              const hasSourceClientMessageId = queryIncludes(
                "source_client_message_id"
              );
              const hasDispatchOwner = queryIncludes("dispatch_owner_kind");
              let argIndex = 0;
              const idempotencyKey = args[argIndex++];
              const dispatchId = args[argIndex++];
              const spaceId = args[argIndex++];
              const sourceEventId = args[argIndex++];
              const sourceClientMessageId = hasSourceClientMessageId
                ? normalizeOptionalText(args[argIndex++])
                : null;
              const dispatchOwnerKind = hasDispatchOwner
                ? normalizeOptionalText(args[argIndex++])
                : null;
              const dispatchOwnerId = hasDispatchOwner
                ? normalizeOptionalText(args[argIndex++])
                : null;
              const targetProfileId = args[argIndex++];
              const status = args[argIndex++];
              const firstSeenAtMs = args[argIndex++];
              const lastAttemptAtMs = args[argIndex++];
              const attemptCount = args[argIndex++];
              const latestAttemptId = args[argIndex++];
              if (rows.has(String(idempotencyKey))) {
                if (queryIncludes("on conflict(idempotency_key) do nothing")) {
                  return Promise.resolve({ meta: { changes: 0 } });
                }
                return Promise.reject(
                  new Error(
                    "D1_ERROR: UNIQUE constraint failed: openMeldDaemon_dispatch_ledger.idempotency_key"
                  )
                );
              }
              rows.set(String(idempotencyKey), {
                idempotencyKey: String(idempotencyKey),
                dispatchId: String(dispatchId),
                spaceId: String(spaceId),
                sourceEventId: String(sourceEventId),
                sourceClientMessageId,
                dispatchOwnerKind,
                dispatchOwnerId,
                targetProfileId: String(targetProfileId),
                status: String(status),
                firstSeenAtMs: Number(firstSeenAtMs),
                lastAttemptAtMs: Number(lastAttemptAtMs),
                attemptCount: Number(attemptCount),
                latestAttemptId: String(latestAttemptId ?? ""),
                replyHintSentAtMs: null,
                finalReplySentAtMs: null,
              });
              return Promise.resolve({ meta: { changes: 1 } });
            }

            if (queryIncludes("insert into openMeldDaemon_dispatch_attempts")) {
              if (shouldFailNextAttemptInsert) {
                shouldFailNextAttemptInsert = false;
                return Promise.reject(
                  new Error("injected dispatch attempt insert failure")
                );
              }
              if (queryIncludes("where exists")) {
                const idempotencyKey = String(args[9] ?? "");
                const latestAttemptId = String(args[10] ?? "");
                const attemptCount = Number(args[11]);
                const ledgerRow = rows.get(idempotencyKey);
                if (
                  !ledgerRow ||
                  ledgerRow.latestAttemptId !== latestAttemptId ||
                  ledgerRow.attemptCount !== attemptCount
                ) {
                  return Promise.resolve({ meta: { changes: 0 } });
                }
              }
              const [
                attemptId,
                dispatchId,
                idempotencyKey,
                attemptNo,
                status,
                taskId,
                targetProfileId,
                createdAtMs,
                startedAtMs,
              ] = args;
              attempts.set(String(attemptId), {
                attemptId: String(attemptId),
                dispatchId: String(dispatchId),
                idempotencyKey: String(idempotencyKey),
                attemptNo: Number(attemptNo),
                status: String(status),
                daemonSessionId: null,
                connectionGeneration: null,
                leaseEpoch: null,
                executionBindingId: null,
                executionAgentControllerRef: null,
                executionIdentityModelVersion: null,
                executionRuntimeId: null,
                targetProfileId: normalizeOptionalText(targetProfileId),
                taskId: normalizeOptionalText(taskId),
                createdAtMs: Number(createdAtMs),
                startedAtMs: Number(startedAtMs),
                finishedAtMs: null,
                errorCode: null,
                errorMessage: null,
              });
              return Promise.resolve({ meta: { changes: 1 } });
            }

            if (
              queryIncludes("update openMeldDaemon_dispatch_ledger") &&
              queryIncludes("set dispatch_owner_kind = ?") &&
              queryIncludes("and dispatch_owner_kind is null") &&
              queryIncludes("and dispatch_owner_id is null")
            ) {
              const [dispatchOwnerKind, dispatchOwnerId, idempotencyKey] = args;
              const row = rows.get(String(idempotencyKey ?? ""));
              if (!row) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              const beforeKind = row.dispatchOwnerKind ?? null;
              const beforeId = row.dispatchOwnerId ?? null;
              fillDispatchOwnerEvidenceOnce(
                row,
                dispatchOwnerKind,
                dispatchOwnerId
              );
              const changed =
                beforeKind !== (row.dispatchOwnerKind ?? null) ||
                beforeId !== (row.dispatchOwnerId ?? null);
              return Promise.resolve({ meta: { changes: changed ? 1 : 0 } });
            }

            if (
              queryIncludes("update openMeldDaemon_dispatch_ledger") &&
              queryIncludes("set reply_hint_sent_at_ms = ?") &&
              queryIncludes("reply_hint_sent_at_ms is null")
            ) {
              const [replyHintSentAtMs, key] = args;
              const row = rows.get(String(key ?? ""));
              if (!row || row.replyHintSentAtMs !== null) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              row.replyHintSentAtMs = Number(replyHintSentAtMs);
              return Promise.resolve({ meta: { changes: 1 } });
            }

            if (
              queryIncludes("update openMeldDaemon_dispatch_ledger") &&
              queryIncludes("set reply_hint_sent_at_ms = null") &&
              queryIncludes("reply_hint_sent_at_ms = ?")
            ) {
              const [key, replyHintSentAtMs] = args;
              const row = rows.get(String(key ?? ""));
              if (!row || row.replyHintSentAtMs !== Number(replyHintSentAtMs)) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              row.replyHintSentAtMs = null;
              return Promise.resolve({ meta: { changes: 1 } });
            }

            if (
              queryIncludes("update openMeldDaemon_dispatch_ledger") &&
              queryIncludes("set final_reply_sent_at_ms = ?") &&
              queryIncludes("final_reply_sent_at_ms is null")
            ) {
              const [finalReplySentAtMs, key] = args;
              const row = rows.get(String(key ?? ""));
              if (!row || row.finalReplySentAtMs !== null) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              row.finalReplySentAtMs = Number(finalReplySentAtMs);
              return Promise.resolve({ meta: { changes: 1 } });
            }

            if (
              queryIncludes("update openMeldDaemon_dispatch_ledger") &&
              queryIncludes("set final_reply_sent_at_ms = null") &&
              queryIncludes("final_reply_sent_at_ms = ?")
            ) {
              const [key, finalReplySentAtMs] = args;
              const row = rows.get(String(key ?? ""));
              if (
                !row ||
                row.finalReplySentAtMs !== Number(finalReplySentAtMs)
              ) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              row.finalReplySentAtMs = null;
              return Promise.resolve({ meta: { changes: 1 } });
            }

            if (
              queryIncludes("update openMeldDaemon_dispatch_ledger") &&
              queryIncludes(
                "set status = ?, last_attempt_at_ms = ?, latest_attempt_id = ?"
              ) &&
              queryIncludes("where idempotency_key = ?") &&
              !queryIncludes("set dispatch_id = ?")
            ) {
              const [status, lastAttemptAtMs, latestAttemptId, key] = args;
              const idempotencyKey = String(key ?? "");
              const row = rows.get(idempotencyKey);
              if (!row) {
                return Promise.reject(
                  new Error(`missing row for ${idempotencyKey}`)
                );
              }
              row.status = String(status);
              row.lastAttemptAtMs = Number(lastAttemptAtMs);
              row.latestAttemptId = String(latestAttemptId ?? "");
              return Promise.resolve({ meta: { changes: 1 } });
            }

            if (
              queryIncludes("update openMeldDaemon_dispatch_attempts") &&
              queryIncludes("set daemon_session_id = ?") &&
              queryIncludes("and dispatch_id = ?") &&
              queryIncludes("and status = ?")
            ) {
              const [
                daemonSessionId,
                connectionGeneration,
                leaseEpoch,
                taskId,
                targetProfileId,
                executionIdentityModelVersion,
                executionBindingId,
                executionRuntimeId,
                executionAgentControllerRef,
                startedAtMs,
                attemptId,
                dispatchId,
                expectedStatus,
              ] = args;
              const row = attempts.get(String(attemptId ?? ""));
              if (
                !row ||
                row.dispatchId !== String(dispatchId ?? "") ||
                row.status !== String(expectedStatus ?? "")
              ) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              row.daemonSessionId = String(daemonSessionId);
              row.connectionGeneration = Number(connectionGeneration);
              row.leaseEpoch = Number(leaseEpoch);
              row.taskId = normalizeOptionalText(taskId);
              row.targetProfileId = normalizeOptionalText(targetProfileId);
              row.executionIdentityModelVersion = normalizeOptionalText(
                executionIdentityModelVersion
              );
              row.executionBindingId =
                normalizeOptionalText(executionBindingId);
              row.executionRuntimeId =
                normalizeOptionalText(executionRuntimeId);
              row.executionAgentControllerRef = normalizeOptionalText(
                executionAgentControllerRef
              );
              row.startedAtMs =
                row.startedAtMs === null
                  ? Number(startedAtMs)
                  : row.startedAtMs;
              row.errorCode = null;
              row.errorMessage = null;
              return Promise.resolve({ meta: { changes: 1 } });
            }

            if (
              queryIncludes("update openMeldDaemon_dispatch_attempts") &&
              queryIncludes("finished_at_ms = null") &&
              queryIncludes("error_code = null") &&
              queryIncludes("where attempt_id = ?")
            ) {
              const [
                status,
                daemonSessionId,
                connectionGeneration,
                leaseEpoch,
                startedAtMs,
                attemptId,
              ] = args;
              const row = attempts.get(String(attemptId ?? ""));
              if (!row) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              row.status = String(status);
              row.daemonSessionId =
                daemonSessionId === null || daemonSessionId === undefined
                  ? row.daemonSessionId
                  : String(daemonSessionId);
              row.connectionGeneration =
                connectionGeneration === null ||
                connectionGeneration === undefined
                  ? row.connectionGeneration
                  : Number(connectionGeneration);
              row.leaseEpoch =
                leaseEpoch === null || leaseEpoch === undefined
                  ? row.leaseEpoch
                  : Number(leaseEpoch);
              row.startedAtMs =
                row.startedAtMs === null
                  ? Number(startedAtMs)
                  : row.startedAtMs;
              row.finishedAtMs = null;
              row.errorCode = null;
              row.errorMessage = null;
              return Promise.resolve({ meta: { changes: 1 } });
            }

            if (
              queryIncludes("update openMeldDaemon_dispatch_attempts") &&
              queryIncludes("where attempt_id = ?")
            ) {
              const [
                status,
                daemonSessionId,
                connectionGeneration,
                leaseEpoch,
                taskId,
                targetProfileId,
                startedAtMs,
                finishedAtMs,
                errorCode,
                errorMessage,
                attemptId,
              ] = args;
              const row = attempts.get(String(attemptId ?? ""));
              if (!row) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              row.status = String(status);
              row.daemonSessionId =
                daemonSessionId === null || daemonSessionId === undefined
                  ? row.daemonSessionId
                  : String(daemonSessionId);
              row.connectionGeneration =
                connectionGeneration === null ||
                connectionGeneration === undefined
                  ? row.connectionGeneration
                  : Number(connectionGeneration);
              row.leaseEpoch =
                leaseEpoch === null || leaseEpoch === undefined
                  ? row.leaseEpoch
                  : Number(leaseEpoch);
              row.taskId =
                taskId === null || taskId === undefined
                  ? row.taskId
                  : String(taskId);
              row.targetProfileId =
                targetProfileId === null || targetProfileId === undefined
                  ? row.targetProfileId
                  : String(targetProfileId);
              row.startedAtMs =
                startedAtMs === null || startedAtMs === undefined
                  ? row.startedAtMs
                  : Number(startedAtMs);
              row.finishedAtMs =
                finishedAtMs === null || finishedAtMs === undefined
                  ? row.finishedAtMs
                  : Number(finishedAtMs);
              row.errorCode =
                errorCode === null || errorCode === undefined
                  ? null
                  : String(errorCode);
              row.errorMessage =
                errorMessage === null || errorMessage === undefined
                  ? null
                  : String(errorMessage);
              return Promise.resolve({ meta: { changes: 1 } });
            }

            if (
              queryIncludes("update openMeldDaemon_dispatch_ledger") &&
              queryIncludes("set space_id = ?") &&
              queryIncludes("latest_attempt_id = ?") &&
              !queryIncludes("set dispatch_id = ?")
            ) {
              let argIndex = 0;
              const spaceId = args[argIndex++];
              const sourceEventId = args[argIndex++];
              const sourceClientMessageId = args[argIndex++];
              const dispatchOwnerKind = args[argIndex++];
              const dispatchOwnerId = args[argIndex++];
              const targetProfileId = args[argIndex++];
              const status = args[argIndex++];
              const lastAttemptAtMs = args[argIndex++];
              const latestAttemptId = args[argIndex++];
              const _maxAttempt = args[argIndex++];
              const attempt = args[argIndex++];
              const key = args[argIndex++];
              const expectedStatus = args[argIndex++];
              const expectedLastAttemptAtMs = args[argIndex++];
              const expectedLatestAttemptId = args[argIndex++];
              const idempotencyKey = String(key ?? "");
              const row = rows.get(idempotencyKey);
              if (!row) {
                return Promise.reject(
                  new Error(`missing row for ${idempotencyKey}`)
                );
              }
              if (
                queryIncludes("and status = ?") &&
                row.status !== expectedStatus
              ) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              if (
                queryIncludes("and last_attempt_at_ms = ?") &&
                row.lastAttemptAtMs !== Number(expectedLastAttemptAtMs ?? 0)
              ) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              if (
                queryIncludes("and latest_attempt_id is ?") &&
                row.latestAttemptId !==
                  (expectedLatestAttemptId === null ||
                  expectedLatestAttemptId === undefined
                    ? null
                    : String(expectedLatestAttemptId))
              ) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              row.spaceId = String(spaceId);
              row.sourceEventId = String(sourceEventId);
              row.sourceClientMessageId = normalizeOptionalText(
                sourceClientMessageId
              );
              fillDispatchOwnerEvidenceOnce(
                row,
                dispatchOwnerKind,
                dispatchOwnerId
              );
              row.targetProfileId = String(targetProfileId);
              row.status = String(status);
              row.lastAttemptAtMs = Number(lastAttemptAtMs);
              row.latestAttemptId = String(latestAttemptId ?? "");
              row.attemptCount = Math.max(row.attemptCount, Number(attempt));
              if (queryIncludes("reply_hint_sent_at_ms = null")) {
                row.replyHintSentAtMs = null;
              }
              return Promise.resolve({ meta: { changes: 1 } });
            }

            if (
              queryIncludes("update openMeldDaemon_dispatch_ledger") &&
              queryIncludes("set dispatch_id = ?")
            ) {
              const hasFirstSeenUpdate = queryIncludes("first_seen_at_ms = ?");
              const hasSourceClientMessageId = queryIncludes(
                "source_client_message_id = ?"
              );
              const hasDispatchOwner = queryIncludes("dispatch_owner_kind");
              if (hasFirstSeenUpdate) {
                let argIndex = 0;
                const dispatchId = args[argIndex++];
                const spaceId = args[argIndex++];
                const sourceEventId = args[argIndex++];
                const sourceClientMessageId = hasSourceClientMessageId
                  ? args[argIndex++]
                  : null;
                const dispatchOwnerKind = hasDispatchOwner
                  ? args[argIndex++]
                  : null;
                const dispatchOwnerId = hasDispatchOwner
                  ? args[argIndex++]
                  : null;
                const targetProfileId = args[argIndex++];
                const status = args[argIndex++];
                const firstSeenAtMs = args[argIndex++];
                const lastAttemptAtMs = args[argIndex++];
                const attemptCount = args[argIndex++];
                const latestAttemptId = args[argIndex++];
                const key = args[argIndex++];
                const expectedStatus = args[argIndex++];
                const expectedLastAttemptAtMs = args[argIndex++];
                const expectedLatestAttemptId = args[argIndex++];
                const idempotencyKey = String(key ?? "");
                const row = rows.get(idempotencyKey);
                if (!row) {
                  return Promise.reject(
                    new Error(`missing row for ${idempotencyKey}`)
                  );
                }
                if (
                  queryIncludes("and status is ?") &&
                  row.status !== expectedStatus
                ) {
                  return Promise.resolve({ meta: { changes: 0 } });
                }
                if (
                  queryIncludes("and last_attempt_at_ms = ?") &&
                  row.lastAttemptAtMs !== Number(expectedLastAttemptAtMs)
                ) {
                  return Promise.resolve({ meta: { changes: 0 } });
                }
                if (
                  queryIncludes("and latest_attempt_id is ?") &&
                  row.latestAttemptId !==
                    (expectedLatestAttemptId === null ||
                    expectedLatestAttemptId === undefined
                      ? null
                      : String(expectedLatestAttemptId))
                ) {
                  return Promise.resolve({ meta: { changes: 0 } });
                }
                row.dispatchId = String(dispatchId);
                row.spaceId = String(spaceId);
                row.sourceEventId = String(sourceEventId);
                row.sourceClientMessageId = normalizeOptionalText(
                  sourceClientMessageId
                );
                fillDispatchOwnerEvidenceOnce(
                  row,
                  dispatchOwnerKind,
                  dispatchOwnerId
                );
                row.targetProfileId = String(targetProfileId);
                row.status = String(status);
                row.firstSeenAtMs = Number(firstSeenAtMs);
                row.lastAttemptAtMs = Number(lastAttemptAtMs);
                row.attemptCount = Number(attemptCount);
                row.latestAttemptId = String(latestAttemptId ?? "");
                row.replyHintSentAtMs = null;
                row.finalReplySentAtMs = null;
                return Promise.resolve({ meta: { changes: 1 } });
              }

              let argIndex = 0;
              const dispatchId = args[argIndex++];
              const spaceId = args[argIndex++];
              const sourceEventId = args[argIndex++];
              const sourceClientMessageId = hasSourceClientMessageId
                ? args[argIndex++]
                : null;
              const dispatchOwnerKind = hasDispatchOwner
                ? args[argIndex++]
                : null;
              const dispatchOwnerId = hasDispatchOwner
                ? args[argIndex++]
                : null;
              const targetProfileId = args[argIndex++];
              const status = args[argIndex++];
              const lastAttemptAtMs = args[argIndex++];
              const latestAttemptId = args[argIndex++];
              const _maxAttempt = args[argIndex++];
              const attempt = args[argIndex++];
              const key = args[argIndex++];
              const expectedStatus = args[argIndex++];
              const expectedLastAttemptAtMs = args[argIndex++];
              const expectedLatestAttemptId = args[argIndex++];
              const idempotencyKey = String(key ?? "");
              const row = rows.get(idempotencyKey);
              if (!row) {
                return Promise.reject(
                  new Error(`missing row for ${idempotencyKey}`)
                );
              }
              if (
                queryIncludes("and status = ?") &&
                row.status !== expectedStatus
              ) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              if (
                queryIncludes("and last_attempt_at_ms = ?") &&
                row.lastAttemptAtMs !== expectedLastAttemptAtMs
              ) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              if (
                queryIncludes("and latest_attempt_id is ?") &&
                row.latestAttemptId !==
                  (expectedLatestAttemptId === null ||
                  expectedLatestAttemptId === undefined
                    ? null
                    : String(expectedLatestAttemptId))
              ) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              row.dispatchId = String(dispatchId);
              row.spaceId = String(spaceId);
              row.sourceEventId = String(sourceEventId);
              row.sourceClientMessageId = normalizeOptionalText(
                sourceClientMessageId
              );
              fillDispatchOwnerEvidenceOnce(
                row,
                dispatchOwnerKind,
                dispatchOwnerId
              );
              row.targetProfileId = String(targetProfileId);
              row.status = String(status);
              row.lastAttemptAtMs = Number(lastAttemptAtMs);
              row.latestAttemptId = String(latestAttemptId ?? "");
              row.attemptCount = Math.max(row.attemptCount, Number(attempt));
              if (queryIncludes("reply_hint_sent_at_ms = null")) {
                row.replyHintSentAtMs = null;
              }
              return Promise.resolve({ meta: { changes: 1 } });
            }
            if (queryIncludes("insert into openMeldDaemon_dlq")) {
              const [
                dispatchId,
                idempotencyKey,
                sourceEventId,
                targetProfileId,
                errorCode,
                _errorMessage,
                failedAtMs,
              ] = args;
              dlqRows.push({
                dispatchId: String(dispatchId),
                idempotencyKey: String(idempotencyKey),
                sourceEventId: String(sourceEventId),
                targetProfileId: String(targetProfileId),
                errorCode: String(errorCode),
                failedAtMs: safeNumber(failedAtMs),
              });
              return Promise.resolve({ meta: { changes: 1 } });
            }
            if (queryIncludes("insert into openMeldDaemon_ops_decisions")) {
              opsDecisionRows.push(args);
              return Promise.resolve({ meta: { changes: 1 } });
            }

            return Promise.reject(
              new Error(`unsupported run() query: ${query}`)
            );
          },
        }),
      };
    },
    batch: async (statements: D1PreparedStatement[]) => {
      const rowSnapshot = new Map(
        [...rows].map(([key, value]) => [key, { ...value }])
      );
      const attemptSnapshot = new Map(
        [...attempts].map(([key, value]) => [key, { ...value }])
      );
      try {
        const results: D1Result[] = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        return results;
      } catch (error) {
        rows.clear();
        attempts.clear();
        for (const [key, value] of rowSnapshot) {
          rows.set(key, value);
        }
        for (const [key, value] of attemptSnapshot) {
          attempts.set(key, value);
        }
        throw error;
      }
    },
  } as unknown as D1Database;

  return {
    db,
    injectNextAttemptInsertFailure: () => {
      shouldFailNextAttemptInsert = true;
    },
    readRow: (idempotencyKey: string) => rows.get(idempotencyKey),
    readAttempt: (attemptId: string) => attempts.get(attemptId),
    seedAttemptRow,
    seedDlqRow,
    seedRuntimeCoordinatorExecution,
    rows,
    opsDecisionRows,
  };
};

const buildDispatchMessage = (overrides?: {
  dispatchOwner?: OpenMeldDaemonDispatchQueueMessage["dispatchOwner"];
  dispatchId?: string;
  idempotencyKey?: string;
  sourceClientMessageId?: string;
  sourceEventId?: string;
  targetProfileId?: string;
}): OpenMeldDaemonDispatchQueueMessage => {
  const dispatchId = overrides?.dispatchId ?? "dispatch-1";
  const sourceEventId = overrides?.sourceEventId ?? "evt-1";
  const targetProfileId = overrides?.targetProfileId ?? "agt-1";
  return {
    v: 2,
    dispatchId,
    spaceId: "space-1",
    sourceEventId,
    ...(overrides?.sourceClientMessageId
      ? { sourceClientMessageId: overrides.sourceClientMessageId }
      : {}),
    ...(overrides?.dispatchOwner
      ? { dispatchOwner: overrides.dispatchOwner }
      : {}),
    targetProfileId,
    dispatchChainId: dispatchId,
    autoRelayDepth: 0,
    visitedProfileIds: [],
    visitedProfileIdsHash: "stable32:1234abcd",
    dispatchContractVersion: 2,
    dispatchPolicy: "mention_only",
    ruleSource: "space",
    ruleId: "space.default.all_members.v1",
    ruleReason: "default allow all members mention",
    taskId: `task-${dispatchId}`,
    transportMode: "local-cli",
    controllerSnapshot: {
      targetBindingState: "bound",
      targetBindingEnabled: true,
      agentControllerRef: "codex",
    },
    contextIdMappingSpec: null,
    dispatchRulesSnapshot: {
      dispatchPolicy: "mention_only",
      ruleSource: "space",
      ruleId: "space.default.all_members.v1",
      ruleReason: "default allow all members mention",
    },
    dispatchSnapshot: {
      dispatchPolicy: "mention_only",
      ruleSource: "space",
      ruleId: "space.default.all_members.v1",
      ruleReason: "default allow all members mention",
      targetBindingState: "bound",
      targetBindingEnabled: true,
    },
    idempotencyKey:
      overrides?.idempotencyKey ?? `5:${sourceEventId}|5:${targetProfileId}`,
    enqueuedAtMs: 1000,
  };
};

const createDispatchLedgerInsertCaptureDb = () => {
  let ledgerInsertQuery = "";
  let ledgerInsertBindings: unknown[] = [];
  const db = {
    prepare: (query: string) => {
      const compactQuery = query.toLowerCase().replace(/\s+/g, " ");
      const queryIncludes = (sql: string) =>
        compactQuery.includes(sql.toLowerCase());
      return {
        bind: (...args: unknown[]) => ({
          first: () => {
            if (
              queryIncludes("from openMeldDaemon_dispatch_ledger") &&
              queryIncludes("where idempotency_key = ?")
            ) {
              return Promise.resolve(null);
            }
            if (
              queryIncludes(
                "from openMeldDaemon_runtime_coordinator_executions"
              )
            ) {
              return Promise.resolve(null);
            }
            throw new Error(`unsupported first() query: ${query}`);
          },
          run: () => {
            if (queryIncludes("insert into openMeldDaemon_dispatch_ledger")) {
              ledgerInsertQuery = query;
              ledgerInsertBindings = args;
              return Promise.resolve({ meta: { changes: 1 } });
            }
            if (queryIncludes("insert into openMeldDaemon_dispatch_attempts")) {
              return Promise.resolve({ meta: { changes: 1 } });
            }
            throw new Error(`unsupported run() query: ${query}`);
          },
        }),
      };
    },
    batch: async (statements: D1PreparedStatement[]) => {
      const results: D1Result[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    },
  } as unknown as D1Database;

  return {
    db,
    readLedgerInsert: () => ({
      bindings: ledgerInsertBindings,
      query: ledgerInsertQuery,
    }),
  };
};

const seedStaleDispatchLedgerClaim = async (input: {
  db: D1Database;
  message: OpenMeldDaemonDispatchQueueMessage;
  readRow: (idempotencyKey: string) => LedgerRow | undefined;
  status: LedgerRow["status"];
}) => {
  const first = await claimDispatchAttempt({
    db: input.db,
    message: input.message,
    attempt: 1,
    nowMs: 1000,
  });
  if (first.status !== "claimed" || first.attemptNo !== 1) {
    throw new Error("expected first claim");
  }

  const seeded = input.readRow(input.message.idempotencyKey);
  if (!seeded) {
    throw new Error("expected seeded row");
  }
  seeded.status = input.status;
  seeded.lastAttemptAtMs = 1000;

  return first;
};

const summarizeConcurrentReclaim = (
  claimResults: Awaited<ReturnType<typeof claimDispatchAttempt>>[]
) => {
  return {
    claimedCount: claimResults.filter((result) => result.status === "claimed")
      .length,
    hasDedupedClaim: claimResults.some((result) => result.status === "deduped"),
  };
};

describe("dispatch ledger schema failures", () => {
  it("fails fast when the shared OPENMELD_DB migration has not created the ledger tables", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          first: () => {
            throw new Error("no such table: openMeldDaemon_dispatch_ledger");
          },
        }),
      }),
    } as unknown as D1Database;

    await expect(
      claimDispatchAttempt({
        db,
        message: buildDispatchMessage(),
        attempt: 1,
        nowMs: 1000,
      })
    ).rejects.toThrow("no such table: openMeldDaemon_dispatch_ledger");
  });
});

describe("claimDispatchAttempt", () => {
  it("rolls back a new ledger claim when its attempt insert fails", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb({
      failNextAttemptInsert: true,
    });
    const message = buildDispatchMessage({
      dispatchId: "dispatch-atomic-new-claim-1",
      sourceEventId: "signal-atomic-new-claim-1",
      targetProfileId: "agt-atomic-new-claim-1",
    });

    await expect(
      claimDispatchAttempt({
        attempt: 1,
        db,
        message,
        nowMs: 1000,
      })
    ).rejects.toThrow("injected dispatch attempt insert failure");

    expect(readRow(message.idempotencyKey)).toBeUndefined();
    await expect(
      claimDispatchAttempt({
        attempt: 2,
        db,
        message,
        nowMs: 1100,
      })
    ).resolves.toMatchObject({
      attemptNo: 1,
      status: "claimed",
    });
  });

  it("dedupes concurrent new claims for the same idempotency key", async () => {
    const { db, rows } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-concurrent-new-claim-1",
      sourceEventId: "signal-concurrent-new-claim-1",
      targetProfileId: "agt-concurrent-new-claim-1",
    });

    const claims = await Promise.allSettled([
      claimDispatchAttempt({
        attempt: 1,
        db,
        message,
        nowMs: 1000,
      }),
      claimDispatchAttempt({
        attempt: 1,
        db,
        message,
        nowMs: 1000,
      }),
    ]);

    expect(claims).toHaveLength(2);
    expect(claims.every((claim) => claim.status === "fulfilled")).toBe(true);
    const fulfilledClaims = claims
      .filter((claim) => claim.status === "fulfilled")
      .map((claim) => claim.value.status);
    expect(fulfilledClaims).toEqual(["claimed", "deduped"]);
    expect(rows).toHaveLength(1);
  });

  it("projects hosted native delivery as waiting for a result without daemon ownership", async () => {
    const { db, readAttempt, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-hosted-native-delivery-1",
      sourceEventId: "signal-hosted-native-delivery-1",
      targetProfileId: "agt-hosted-native-delivery-1",
    });
    const claim = await claimDispatchAttempt({
      attempt: 1,
      db,
      message,
      nowMs: 1000,
    });
    if (claim.status !== "claimed") {
      throw new Error("expected hosted dispatch claim");
    }

    await markDispatchAttemptWaitingForResult({
      attemptId: claim.attemptId,
      db,
      idempotencyKey: message.idempotencyKey,
      nowMs: 2000,
      targetProfileId: message.targetProfileId,
      taskId: message.taskId,
    });

    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: claim.attemptId,
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
    });
    expect(readAttempt(claim.attemptId)).toMatchObject({
      connectionGeneration: null,
      daemonSessionId: null,
      leaseEpoch: null,
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
      targetProfileId: message.targetProfileId,
      taskId: message.taskId,
    });
  });

  it("persists source client message id on new ledger claims", async () => {
    const { db, readLedgerInsert } = createDispatchLedgerInsertCaptureDb();
    const message = buildDispatchMessage({
      sourceClientMessageId: "client-message-1",
    });

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });

    const ledgerInsert = readLedgerInsert();
    expect(ledgerInsert.query).toContain("source_client_message_id");
    expect(ledgerInsert.bindings).toContain("client-message-1");
  });

  it("persists dispatch owner evidence from the queue message on new ledger claims", async () => {
    const { db, readLedgerInsert } = createDispatchLedgerInsertCaptureDb();
    const message = buildDispatchMessage({
      dispatchOwner: {
        id: "owner-1",
        kind: "owner_account",
      },
    });

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });

    const ledgerInsert = readLedgerInsert();
    expect(ledgerInsert.query).toContain("dispatch_owner_kind");
    expect(ledgerInsert.query).toContain("dispatch_owner_id");
    expect(ledgerInsert.bindings).toContain("owner_account");
    expect(ledgerInsert.bindings).toContain("owner-1");
  });

  it("does not clear creation-time dispatch owner evidence on ownerless retry messages", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const firstMessage = buildDispatchMessage({
      dispatchOwner: {
        id: "owner-a",
        kind: "owner_account",
      },
    });

    await claimDispatchAttempt({
      db,
      message: firstMessage,
      attempt: 1,
      nowMs: 1000,
    });

    const seeded = readRow(firstMessage.idempotencyKey);
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable;

    await claimDispatchAttempt({
      db,
      message: buildDispatchMessage({
        idempotencyKey: firstMessage.idempotencyKey,
      }),
      attempt: 2,
      nowMs: 2000,
    });

    expect(readRow(firstMessage.idempotencyKey)).toMatchObject({
      dispatchOwnerId: "owner-a",
      dispatchOwnerKind: "owner_account",
    });
  });

  it("does not overwrite creation-time dispatch owner evidence on retry messages", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const firstMessage = buildDispatchMessage({
      dispatchOwner: {
        id: "owner-a",
        kind: "owner_account",
      },
    });

    await claimDispatchAttempt({
      db,
      message: firstMessage,
      attempt: 1,
      nowMs: 1000,
    });

    const seeded = readRow(firstMessage.idempotencyKey);
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable;

    await claimDispatchAttempt({
      db,
      message: buildDispatchMessage({
        dispatchOwner: {
          id: "owner-b",
          kind: "owner_account",
        },
        idempotencyKey: firstMessage.idempotencyKey,
      }),
      attempt: 2,
      nowMs: 2000,
    });

    expect(readRow(firstMessage.idempotencyKey)).toMatchObject({
      dispatchOwnerId: "owner-a",
      dispatchOwnerKind: "owner_account",
    });
  });

  it("fills missing dispatch owner evidence once from a valid retry message", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const firstMessage = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message: firstMessage,
      attempt: 1,
      nowMs: 1000,
    });

    const seeded = readRow(firstMessage.idempotencyKey);
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable;

    const retryClaim = await claimDispatchAttempt({
      db,
      message: buildDispatchMessage({
        dispatchOwner: {
          id: "owner-a",
          kind: "owner_account",
        },
        idempotencyKey: firstMessage.idempotencyKey,
      }),
      attempt: 2,
      nowMs: 2000,
    });

    expect(retryClaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "claim_existing_inside_window",
        eventKind: "retry",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(firstMessage),
      },
      status: "deduped",
    });
    expect(readRow(firstMessage.idempotencyKey)).toMatchObject({
      attemptCount: 1,
      dispatchOwnerId: "owner-a",
      dispatchOwnerKind: "owner_account",
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    });
  });

  it("retries RuntimeCoordinator head accept after a retryable head failure instead of deduping", async () => {
    const { db, readAttempt, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-head-accept-retry-1",
      sourceEventId: "signal-head-accept-retry-1",
      targetProfileId: "agt-head-accept-retry-1",
    });

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }

    await markDispatchStatus({
      attemptId: first.attemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      db,
      errorCode: "runtime_coordinator.head_accept_unavailable",
      errorMessage:
        "RuntimeCoordinator head accept returned retry_later before execution creation",
      idempotencyKey: message.idempotencyKey,
      nowMs: 1100,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    });

    const retry = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1200,
    });

    expect(retry).toMatchObject({
      attemptNo: 2,
      status: "claimed",
    });
    if (retry.status !== "claimed") {
      throw new Error("expected retry claim");
    }
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(readRow(message.idempotencyKey)).toMatchObject({
      attemptCount: 2,
      latestAttemptId: retry.attemptId,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      errorCode: "runtime_coordinator.head_accept_unavailable",
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
    });
    expect(readAttempt(retry.attemptId)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
    });
  });

  it("retries RuntimeCoordinator head no-execution after a retryable head decision failure instead of deduping", async () => {
    const { db, readAttempt, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-head-no-execution-retry-1",
      sourceEventId: "signal-head-no-execution-retry-1",
      targetProfileId: "agt-head-no-execution-retry-1",
    });

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }

    await markDispatchStatus({
      attemptId: first.attemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      db,
      errorCode: "runtime_coordinator.head_no_execution_unavailable",
      errorMessage:
        "RuntimeCoordinator head no-execution decision returned retry_later before execution creation",
      idempotencyKey: message.idempotencyKey,
      nowMs: 1100,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    });

    const retry = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1200,
    });

    expect(retry).toMatchObject({
      attemptNo: 2,
      status: "claimed",
    });
    if (retry.status !== "claimed") {
      throw new Error("expected retry claim");
    }
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(readRow(message.idempotencyKey)).toMatchObject({
      attemptCount: 2,
      latestAttemptId: retry.attemptId,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      errorCode: "runtime_coordinator.head_no_execution_unavailable",
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
    });
    expect(readAttempt(retry.attemptId)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
    });
  });

  it("dedupes terminal status inside idempotency window", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    expect(first).toMatchObject({
      status: "claimed",
      attemptNo: 1,
      replyingHintActive: false,
    });

    const seeded = readRow(message.idempotencyKey);
    expect(seeded).toBeDefined();
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.succeeded;

    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 2000,
    });
    expect(second).toEqual({
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.status).toBe(
      OPENMELD_DAEMON_DISPATCH_STATE.succeeded
    );
  });

  it("dedupes fresh queued status inside idempotency window", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    const seeded = readRow(message.idempotencyKey);
    expect(seeded).toBeDefined();
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.queued;
    seeded.lastAttemptAtMs = 1000;
    seeded.replyHintSentAtMs = 1100;

    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 2000,
    });
    expect(second).toEqual({
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.status).toBe(
      OPENMELD_DAEMON_DISPATCH_STATE.queued
    );
  });

  it("does not let stale queued D1 state reclaim delivery inside idempotency window", async () => {
    const { db, readAttempt, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    const first = await seedStaleDispatchLedgerClaim({
      db,
      message,
      readRow,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });

    const reclaimNowMs = 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1;
    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: reclaimNowMs,
    });
    expect(second).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reclaim_stale_queued",
        eventKind: "reclaim",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });

    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
      lastAttemptAtMs: 1000,
      latestAttemptId: first.attemptId,
      replyHintSentAtMs: null,
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "dispatching",
      errorCode: null,
    });
  });

  it("keeps concurrent stale queued reclaim attempts as RuntimeCoordinator trigger evidence", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    await seedStaleDispatchLedgerClaim({
      db,
      message,
      readRow,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });

    const reclaimNowMs = 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1;
    const [firstClaim, secondClaim] = await Promise.all([
      claimDispatchAttempt({
        db,
        message,
        attempt: 2,
        nowMs: reclaimNowMs,
      }),
      claimDispatchAttempt({
        db,
        message,
        attempt: 3,
        nowMs: reclaimNowMs,
      }),
    ]);

    const claimResults = [firstClaim, secondClaim];
    expect(summarizeConcurrentReclaim(claimResults)).toEqual({
      claimedCount: 0,
      hasDedupedClaim: true,
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
      lastAttemptAtMs: 1000,
    });
  });

  it("dedupes fresh dispatching status inside idempotency window", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    const seeded = readRow(message.idempotencyKey);
    expect(seeded).toBeDefined();
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.dispatching;
    seeded.lastAttemptAtMs = 1000;
    seeded.replyHintSentAtMs = 1100;

    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS - 1,
    });
    expect(second).toEqual({
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.status).toBe(
      OPENMELD_DAEMON_DISPATCH_STATE.dispatching
    );
  });

  it("records daemon execution evidence while an attempt is still dispatching", async () => {
    const { db, readAttempt } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    const claim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (claim.status !== "claimed") {
      throw new Error("expected first claim");
    }

    await recordDispatchAttemptExecutionOwnership({
      attemptId: claim.attemptId,
      connectionGeneration: 7,
      daemonSessionId: "daemon-session-ownership-1",
      db,
      dispatchId: message.dispatchId,
      executionIdentity: buildExecutionIdentity({
        dispatchId: message.dispatchId,
        targetProfileId: message.targetProfileId,
      }),
      leaseEpoch: 3,
      nowMs: 2000,
      targetProfileId: message.targetProfileId,
      taskId: message.taskId,
    });

    expect(readAttempt(claim.attemptId)).toMatchObject({
      connectionGeneration: 7,
      daemonSessionId: "daemon-session-ownership-1",
      executionBindingId: "binding-1",
      executionAgentControllerRef: "builtin:codex",
      executionIdentityModelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
      executionRuntimeId: "runtime-1",
      leaseEpoch: 3,
      status: "dispatching",
      targetProfileId: message.targetProfileId,
      taskId: message.taskId,
    });
  });

  it("does not overwrite daemon execution evidence after an attempt leaves dispatching", async () => {
    const { db, readAttempt } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    const claim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (claim.status !== "claimed") {
      throw new Error("expected first claim");
    }
    const attempt = readAttempt(claim.attemptId);
    if (!attempt) {
      throw new Error("expected attempt");
    }
    attempt.status = "waiting_result";
    attempt.daemonSessionId = "daemon-session-existing";
    attempt.connectionGeneration = 2;
    attempt.leaseEpoch = 1;

    await expect(
      recordDispatchAttemptExecutionOwnership({
        attemptId: claim.attemptId,
        connectionGeneration: 7,
        daemonSessionId: "daemon-session-new",
        db,
        dispatchId: message.dispatchId,
        executionIdentity: buildExecutionIdentity({
          dispatchId: message.dispatchId,
          targetProfileId: message.targetProfileId,
        }),
        leaseEpoch: 3,
        nowMs: 2000,
        targetProfileId: message.targetProfileId,
        taskId: message.taskId,
      })
    ).rejects.toThrow(
      "dispatch attempt execution ownership was not recorded before delivery"
    );

    expect(readAttempt(claim.attemptId)).toMatchObject({
      connectionGeneration: 2,
      daemonSessionId: "daemon-session-existing",
      leaseEpoch: 1,
      status: "waiting_result",
    });
  });

  it("treats a waiting_result continuation as a RuntimeCoordinator trigger instead of resuming from D1", async () => {
    const { db, opsDecisionRows, readAttempt, readRow } =
      createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }

    const seeded = readRow(message.idempotencyKey);
    const seededAttempt = readAttempt(first.attemptId);
    if (!(seeded && seededAttempt)) {
      throw new Error("expected seeded attempt");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.dispatching;
    seeded.lastAttemptAtMs = 1000;
    seeded.replyHintSentAtMs = 1100;
    seededAttempt.status = "waiting_result";
    seededAttempt.daemonSessionId = "daemon-session-1";
    seededAttempt.leaseEpoch = 9;

    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 5000,
    });
    expect(second).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "continue_existing",
        eventKind: "reclaim",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.latestAttemptId).toBe(
      first.attemptId
    );
    expect(JSON.stringify(opsDecisionRows)).toContain("continue_existing");
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "waiting_result",
    });
  });

  it("does not use missing RuntimeCoordinator projection to resume a waiting_result attempt", async () => {
    const { db, opsDecisionRows, readAttempt, readRow } =
      createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }

    const seeded = readRow(message.idempotencyKey);
    const seededAttempt = readAttempt(first.attemptId);
    if (!(seeded && seededAttempt)) {
      throw new Error("expected seeded attempt");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.dispatching;
    seeded.lastAttemptAtMs = 1000;
    seededAttempt.status = "waiting_result";
    seededAttempt.daemonSessionId = "daemon-session-1";
    seededAttempt.leaseEpoch = 9;

    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 5000,
    });

    expect(second).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "continue_existing",
        eventKind: "reclaim",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.latestAttemptId).toBe(
      first.attemptId
    );
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "waiting_result",
    });
    expect(JSON.stringify(opsDecisionRows)).toContain("continue_existing");
  });

  it("does not treat a RuntimeCoordinator projection as first-Wake intake authority", async () => {
    const { db, opsDecisionRows, readRow, seedRuntimeCoordinatorExecution } =
      createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-runtime-coordinator-existing-1",
      sourceEventId: "evt-runtime-coordinator-existing-1",
      targetProfileId: "agt-runtime-coordinator-existing-1",
    });
    seedRuntimeCoordinatorExecution({
      attemptId: "attempt-existing-1",
      daemonSessionId: "daemon-session-existing-1",
      dispatchId: message.dispatchId,
      leaseEpoch: 1,
      status: "running",
      targetProfileId: message.targetProfileId,
    });

    const claim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });

    expect(claim).toMatchObject({
      attemptNo: 1,
      status: "claimed",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: claim.status === "claimed" ? claim.attemptId : null,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });
    expect(JSON.stringify(opsDecisionRows)).not.toContain(
      "runtime_coordinator.execution_exists_for_claim_new"
    );
  });

  it("treats RuntimeCoordinator reclaim queue messages as trigger-only decisions", async () => {
    const {
      db,
      opsDecisionRows,
      readAttempt,
      readRow,
      seedRuntimeCoordinatorExecution,
    } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-runtime-coordinator-reclaim-1",
      sourceEventId: "evt-runtime-coordinator-reclaim-1",
      targetProfileId: "agt-runtime-coordinator-reclaim-1",
    });

    const first = await seedStaleDispatchLedgerClaim({
      db,
      message,
      readRow,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });
    seedRuntimeCoordinatorExecution({
      attemptId: first.attemptId,
      daemonSessionId: "daemon-session-1",
      dispatchId: message.dispatchId,
      leaseEpoch: 9,
      status: "running",
      targetProfileId: message.targetProfileId,
    });

    const reclaimNowMs = 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1;
    const reclaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: reclaimNowMs,
    });

    expect(reclaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reclaim_stale_queued",
        eventKind: "reclaim",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: first.attemptId,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "dispatching",
    });
    const payload = JSON.parse(String(opsDecisionRows.at(-1)?.[2]));
    expect(payload).toMatchObject({
      claimDecision: "reclaim_stale_queued",
      coordinatorDecision: {
        kind: "runtime_coordinator_decision_required",
        queueOrAlarmRole: "trigger_only",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        usesFinalClaimAuthority: false,
        usesLegacyClaimLeaseAuthority: false,
      },
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
      runtimeCoordinatorExecutionId:
        buildExpectedRuntimeCoordinatorExecutionId(message),
    });
  });

  it("does not let stale D1 queued state reclaim delivery when RuntimeCoordinator projection is missing", async () => {
    const { db, opsDecisionRows, readAttempt, readRow } =
      createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-runtime-coordinator-reclaim-missing-projection-1",
      sourceEventId: "evt-runtime-coordinator-reclaim-missing-projection-1",
      targetProfileId: "agt-runtime-coordinator-reclaim-missing-projection-1",
    });

    const first = await seedStaleDispatchLedgerClaim({
      db,
      message,
      readRow,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });

    const reclaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1,
    });

    expect(reclaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reclaim_stale_queued",
        eventKind: "reclaim",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
        runtimeCoordinatorStatus: null,
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: first.attemptId,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "dispatching",
    });
    const payload = JSON.parse(String(opsDecisionRows.at(-1)?.[2]));
    expect(payload).toMatchObject({
      claimDecision: "reclaim_stale_queued",
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
      runtimeCoordinatorExecutionId:
        buildExpectedRuntimeCoordinatorExecutionId(message),
      runtimeCoordinatorStatus: null,
    });
  });

  it("treats RuntimeCoordinator retry queue messages as trigger-only decisions", async () => {
    const {
      db,
      opsDecisionRows,
      readAttempt,
      readRow,
      seedRuntimeCoordinatorExecution,
    } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-runtime-coordinator-retry-1",
      sourceEventId: "evt-runtime-coordinator-retry-1",
      targetProfileId: "agt-runtime-coordinator-retry-1",
    });

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }
    const ledgerRow = readRow(message.idempotencyKey);
    const attemptRow = readAttempt(first.attemptId);
    if (!(ledgerRow && attemptRow)) {
      throw new Error("expected seeded retry state");
    }
    ledgerRow.status = OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable;
    attemptRow.status = "failed_retryable";
    attemptRow.errorCode = "daemon.session.connection_replaced";
    seedRuntimeCoordinatorExecution({
      attemptId: first.attemptId,
      daemonSessionId: "daemon-session-1",
      dispatchId: message.dispatchId,
      leaseEpoch: 9,
      status: "running",
      targetProfileId: message.targetProfileId,
    });

    const retry = await claimDispatchAttempt({
      db,
      message: {
        ...message,
        deliveryRecoveryReason: "connection_replaced",
      },
      attempt: 2,
      nowMs: 2000,
    });

    expect(retry).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "claim_recovery",
        eventKind: "retry",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.latestAttemptId).toBe(
      first.attemptId
    );
    const payload = JSON.parse(String(opsDecisionRows.at(-1)?.[2]));
    expect(payload).toMatchObject({
      claimDecision: "claim_recovery",
      coordinatorDecision: {
        coordinatorAction: "decide_retry_timeout_or_reclaim",
        kind: "runtime_coordinator_decision_required",
        queueOrAlarmRole: "trigger_only",
        usesFinalClaimAuthority: false,
        usesLegacyClaimLeaseAuthority: false,
      },
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
    });
  });

  it("does not let failed D1 attempt state retry delivery when RuntimeCoordinator projection is missing", async () => {
    const { db, opsDecisionRows, readAttempt, readRow } =
      createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-runtime-coordinator-retry-missing-projection-1",
      sourceEventId: "evt-runtime-coordinator-retry-missing-projection-1",
      targetProfileId: "agt-runtime-coordinator-retry-missing-projection-1",
    });

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }
    const ledgerRow = readRow(message.idempotencyKey);
    const attemptRow = readAttempt(first.attemptId);
    if (!(ledgerRow && attemptRow)) {
      throw new Error("expected seeded retry state");
    }
    ledgerRow.status = OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable;
    attemptRow.status = "failed_retryable";
    attemptRow.errorCode = "daemon.session.connection_replaced";

    const retry = await claimDispatchAttempt({
      db,
      message: {
        ...message,
        deliveryRecoveryReason: "connection_replaced",
      },
      attempt: 2,
      nowMs: 2000,
    });

    expect(retry).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "claim_recovery",
        eventKind: "retry",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
        runtimeCoordinatorStatus: null,
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: first.attemptId,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    });
    const payload = JSON.parse(String(opsDecisionRows.at(-1)?.[2]));
    expect(payload).toMatchObject({
      claimDecision: "claim_recovery",
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
      runtimeCoordinatorExecutionId:
        buildExpectedRuntimeCoordinatorExecutionId(message),
      runtimeCoordinatorStatus: null,
    });
  });

  it("does not reopen a completed correlated attempt for already_completed duplicate delivery", async () => {
    const { db, readAttempt, readRow, seedAttemptRow } =
      createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-already-completed-correlation-1",
      sourceEventId: "evt-already-completed-correlation-1",
      targetProfileId: "agt-already-completed-correlation-1",
    });

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }
    const seededLedger = readRow(message.idempotencyKey);
    const seededAttempt = readAttempt(first.attemptId);
    if (!(seededLedger && seededAttempt)) {
      throw new Error("expected seeded dispatch state");
    }
    seededLedger.status = OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable;
    seededAttempt.status =
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable;

    const duplicateAttemptId = "attempt-already-completed-duplicate-2";
    seedAttemptRow({
      ...seededAttempt,
      attemptId: duplicateAttemptId,
      attemptNo: 2,
      createdAtMs: 2000,
      errorCode: null,
      errorMessage: null,
      finishedAtMs: null,
      startedAtMs: 2000,
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
    });
    seededLedger.status = OPENMELD_DAEMON_DISPATCH_STATE.succeeded;
    seededLedger.lastAttemptAtMs = 1500;
    seededLedger.latestAttemptId = duplicateAttemptId;
    seededAttempt.status = OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.succeeded;
    seededAttempt.finishedAtMs = 1500;
    seededAttempt.errorCode = null;
    seededAttempt.errorMessage = null;

    await correlateDuplicateDispatchDeliveryAttempt({
      correlatedAttemptId: first.attemptId,
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      db,
      duplicateAttemptId,
      idempotencyKey: message.idempotencyKey,
      leaseEpoch: 1,
      nowMs: 2500,
      reason: "already_completed",
    });

    expect(readAttempt(first.attemptId)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.succeeded,
      finishedAtMs: 1500,
      errorCode: null,
    });
    expect(readAttempt(duplicateAttemptId)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
      errorCode: "dispatch.attempt.already_completed",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
      lastAttemptAtMs: 1500,
    });
  });

  it("keeps already_pending duplicate delivery correlated to the active attempt", async () => {
    const { db, readAttempt, readRow, seedAttemptRow } =
      createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-already-pending-correlation-1",
      sourceEventId: "evt-already-pending-correlation-1",
      targetProfileId: "agt-already-pending-correlation-1",
    });

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }
    const ledger = readRow(message.idempotencyKey);
    const firstAttempt = readAttempt(first.attemptId);
    if (!(ledger && firstAttempt)) {
      throw new Error("expected first dispatch state");
    }
    ledger.status = OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable;
    firstAttempt.status =
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable;

    const duplicateAttemptId = "attempt-already-pending-duplicate-2";
    seedAttemptRow({
      ...firstAttempt,
      attemptId: duplicateAttemptId,
      attemptNo: 2,
      createdAtMs: 2000,
      errorCode: null,
      errorMessage: null,
      finishedAtMs: null,
      startedAtMs: 2000,
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
    });
    ledger.status = OPENMELD_DAEMON_DISPATCH_STATE.dispatching;
    ledger.latestAttemptId = duplicateAttemptId;
    firstAttempt.status = OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult;
    firstAttempt.finishedAtMs = null;

    await correlateDuplicateDispatchDeliveryAttempt({
      correlatedAttemptId: first.attemptId,
      connectionGeneration: 4,
      daemonSessionId: "daemon-session-4",
      db,
      duplicateAttemptId,
      idempotencyKey: message.idempotencyKey,
      leaseEpoch: 9,
      nowMs: 2500,
      reason: "already_pending",
    });

    expect(readAttempt(first.attemptId)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
      daemonSessionId: "daemon-session-4",
      connectionGeneration: 4,
      leaseEpoch: 9,
      finishedAtMs: null,
    });
    expect(readAttempt(duplicateAttemptId)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
      errorCode: "dispatch.attempt.already_pending",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      latestAttemptId: first.attemptId,
    });
  });

  it("does not let stale dispatching D1 state reclaim delivery inside idempotency window", async () => {
    const { db, readAttempt, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    const first = await seedStaleDispatchLedgerClaim({
      db,
      message,
      readRow,
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
    });

    const reclaimNowMs = 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1;
    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: reclaimNowMs,
    });
    expect(second).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reclaim_stale_dispatching",
        eventKind: "reclaim",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      lastAttemptAtMs: 1000,
      latestAttemptId: first.attemptId,
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "dispatching",
      errorCode: null,
    });
  });

  it("keeps stale dispatching threshold boundary as RuntimeCoordinator trigger evidence", async () => {
    const { db, readAttempt, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }
    const seeded = readRow(message.idempotencyKey);
    expect(seeded).toBeDefined();
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.dispatching;
    seeded.lastAttemptAtMs = 1000;

    const boundaryNowMs = 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS;
    const claim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: boundaryNowMs,
    });
    expect(claim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reclaim_stale_dispatching",
        eventKind: "reclaim",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      lastAttemptAtMs: 1000,
      latestAttemptId: first.attemptId,
    });
    expect(readAttempt(first.attemptId)?.status).toBe("dispatching");
  });

  it("keeps concurrent stale dispatching reclaim attempts as RuntimeCoordinator trigger evidence", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    await seedStaleDispatchLedgerClaim({
      db,
      message,
      readRow,
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
    });

    const reclaimNowMs = 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1;
    const [firstClaim, secondClaim] = await Promise.all([
      claimDispatchAttempt({
        db,
        message,
        attempt: 2,
        nowMs: reclaimNowMs,
      }),
      claimDispatchAttempt({
        db,
        message,
        attempt: 3,
        nowMs: reclaimNowMs,
      }),
    ]);

    const claimResults = [firstClaim, secondClaim];
    expect(summarizeConcurrentReclaim(claimResults)).toEqual({
      claimedCount: 0,
      hasDedupedClaim: true,
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      lastAttemptAtMs: 1000,
    });
  });

  it("keeps retryable in-window dispatches as RuntimeCoordinator trigger evidence", async () => {
    const { db, readAttempt, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (firstClaim.status !== "claimed") {
      throw new Error("expected first claim to be claimed");
    }

    const seeded = readRow(message.idempotencyKey);
    expect(seeded).toBeDefined();
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable;
    seeded.replyHintSentAtMs = 1100;

    const retryClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 2000,
    });
    expect(retryClaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "claim_existing_inside_window",
        eventKind: "retry",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
        runtimeCoordinatorStatus: null,
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: firstClaim.attemptId,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      replyHintSentAtMs: 1100,
    });
    expect(readAttempt("attempt-2")).toBeUndefined();
  });

  it("allows route_lost redrive to re-enter pre-execution waiting delivery", async () => {
    const { db, readAttempt, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-offline-waiting-redrive-1",
      sourceEventId: "evt-offline-waiting-redrive-1",
      targetProfileId: "agt-offline-waiting-redrive-1",
    });

    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (firstClaim.status !== "claimed") {
      throw new Error("expected first claim to be claimed");
    }

    const seeded = readRow(message.idempotencyKey);
    const firstAttempt = readAttempt(firstClaim.attemptId);
    if (!(seeded && firstAttempt)) {
      throw new Error("expected seeded offline waiting state");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable;
    firstAttempt.status =
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable;
    firstAttempt.errorCode = "daemon.profile.offline";

    const redriveClaim = await claimDispatchAttempt({
      db,
      message: {
        ...message,
        deliveryRecoveryReason: "route_lost",
      },
      attempt: 2,
      nowMs: 2000,
    });

    expect(redriveClaim).toMatchObject({
      attemptNo: 2,
      deliveryRecoveryReason: "route_lost",
      status: "claimed",
    });
    if (redriveClaim.status !== "claimed") {
      throw new Error("expected redrive claim to create a new attempt");
    }
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: redriveClaim.attemptId,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });
    expect(readAttempt(redriveClaim.attemptId)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
    });
  });

  it("rolls back an existing ledger update when its replacement attempt insert fails", async () => {
    const { db, injectNextAttemptInsertFailure, readAttempt, readRow } =
      createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-atomic-redrive-1",
      sourceEventId: "evt-atomic-redrive-1",
      targetProfileId: "agt-atomic-redrive-1",
    });

    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (firstClaim.status !== "claimed") {
      throw new Error("expected first claim to be claimed");
    }
    const seeded = readRow(message.idempotencyKey);
    const firstAttempt = readAttempt(firstClaim.attemptId);
    if (!(seeded && firstAttempt)) {
      throw new Error("expected seeded offline waiting state");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable;
    firstAttempt.status =
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable;
    firstAttempt.errorCode = "daemon.profile.offline";
    injectNextAttemptInsertFailure();

    await expect(
      claimDispatchAttempt({
        db,
        message: {
          ...message,
          deliveryRecoveryReason: "route_lost",
        },
        attempt: 2,
        nowMs: 2000,
      })
    ).rejects.toThrow("injected dispatch attempt insert failure");

    expect(readRow(message.idempotencyKey)).toMatchObject({
      attemptCount: 1,
      lastAttemptAtMs: 1000,
      latestAttemptId: firstClaim.attemptId,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    });
    await expect(
      claimDispatchAttempt({
        db,
        message: {
          ...message,
          deliveryRecoveryReason: "route_lost",
        },
        attempt: 3,
        nowMs: 2100,
      })
    ).resolves.toMatchObject({
      attemptNo: 2,
      status: "claimed",
    });
  });

  it("allows Queue retry to re-enter pre-execution waiting delivery as fallback trigger", async () => {
    const { db, readAttempt, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-offline-waiting-queue-retry-1",
      sourceEventId: "evt-offline-waiting-queue-retry-1",
      targetProfileId: "agt-offline-waiting-queue-retry-1",
    });

    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (firstClaim.status !== "claimed") {
      throw new Error("expected first claim to be claimed");
    }

    const seeded = readRow(message.idempotencyKey);
    const firstAttempt = readAttempt(firstClaim.attemptId);
    if (!(seeded && firstAttempt)) {
      throw new Error("expected seeded offline waiting state");
    }
    seeded.status = OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable;
    firstAttempt.status =
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable;
    firstAttempt.errorCode = "daemon.profile.offline";

    const retryClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 2000,
    });

    expect(retryClaim).toMatchObject({
      attemptNo: 2,
      status: "claimed",
    });
    if (retryClaim.status !== "claimed") {
      throw new Error("expected Queue retry to create a new attempt");
    }
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: retryClaim.attemptId,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });
    expect(readAttempt(retryClaim.attemptId)).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
    });
  });

  it("keeps connection_replaced retry as RuntimeCoordinator trigger evidence", async () => {
    const { db, readAttempt, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });

    if (firstClaim.status !== "claimed") {
      throw new Error("expected the initial claim to succeed");
    }

    const ledgerRow = readRow(message.idempotencyKey);
    if (!ledgerRow) {
      throw new Error("expected a seeded ledger row");
    }
    ledgerRow.status = OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable;

    const attemptRow = readAttempt(firstClaim.attemptId);
    if (!attemptRow) {
      throw new Error("expected a seeded attempt row");
    }
    attemptRow.status = "failed_retryable";
    attemptRow.errorCode = "daemon.session.connection_replaced";

    const retryClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 2000,
    });

    expect(retryClaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "claim_recovery",
        eventKind: "retry",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: firstClaim.attemptId,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    });
  });

  it("keeps watchdog recovery redrive as RuntimeCoordinator trigger evidence", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const message = {
      ...buildDispatchMessage(),
      deliveryRecoveryReason: "connection_replaced" as const,
    };

    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (firstClaim.status !== "claimed") {
      throw new Error("expected the initial claim to succeed");
    }

    const ledgerRow = readRow(message.idempotencyKey);
    if (!ledgerRow) {
      throw new Error("expected a seeded ledger row");
    }
    ledgerRow.status = OPENMELD_DAEMON_DISPATCH_STATE.queued;
    ledgerRow.lastAttemptAtMs = 1500;
    ledgerRow.replyHintSentAtMs = 1600;

    const recoveryClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 2000,
    });

    expect(recoveryClaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "claim_recovery",
        eventKind: "retry",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.latestAttemptId).toBe(
      firstClaim.attemptId
    );
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBe(1600);
  });

  it("keeps reset_existing outside the idempotency window as RuntimeCoordinator trigger evidence", async () => {
    const { db, opsDecisionRows, readAttempt, readRow } =
      createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }

    const beyondWindowMs = 1000 + DISPATCH_IDEMPOTENCY_WINDOW_MS + 1;
    const reset = await claimDispatchAttempt({
      db,
      message,
      attempt: 3,
      nowMs: beyondWindowMs,
    });
    expect(reset).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reset_existing",
        eventKind: "reclaim",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
        runtimeCoordinatorStatus: null,
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      firstSeenAtMs: 1000,
      latestAttemptId: first.attemptId,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "dispatching",
    });
    const payload = JSON.parse(String(opsDecisionRows.at(-1)?.[2]));
    expect(payload).toMatchObject({
      claimDecision: "reset_existing",
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
      runtimeCoordinatorExecutionId:
        buildExpectedRuntimeCoordinatorExecutionId(message),
      runtimeCoordinatorStatus: null,
    });
  });
});

describe("claimFinalReplyEmission", () => {
  it("claims final reply persistence only once per idempotency key", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });

    await expect(
      claimFinalReplyEmission({
        db,
        idempotencyKey: message.idempotencyKey,
        nowMs: 2000,
      })
    ).resolves.toBe("claimed");

    expect(readRow(message.idempotencyKey)?.finalReplySentAtMs).toBe(2000);

    await expect(
      claimFinalReplyEmission({
        db,
        idempotencyKey: message.idempotencyKey,
        nowMs: 3000,
      })
    ).resolves.toBe("already_claimed");
  });

  it("rolls back a final reply claim when persistence fails", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });

    await expect(
      claimFinalReplyEmission({
        db,
        idempotencyKey: message.idempotencyKey,
        nowMs: 2000,
      })
    ).resolves.toBe("claimed");
    expect(readRow(message.idempotencyKey)?.finalReplySentAtMs).toBe(2000);

    await rollbackFinalReplyEmissionClaim({
      db,
      idempotencyKey: message.idempotencyKey,
      claimedAtMs: 2000,
    });

    expect(readRow(message.idempotencyKey)?.finalReplySentAtMs).toBeNull();
  });
});

describe("replying hint claim", () => {
  it("claims once and rolls back only with matching timestamp", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });

    const firstClaim = await claimReplyingHintEmission({
      db,
      idempotencyKey: message.idempotencyKey,
      nowMs: 1100,
    });
    expect(firstClaim).toBe("claimed");
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBe(1100);

    const secondClaim = await claimReplyingHintEmission({
      db,
      idempotencyKey: message.idempotencyKey,
      nowMs: 1200,
    });
    expect(secondClaim).toBe("already_claimed");
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBe(1100);

    await rollbackReplyingHintEmissionClaim({
      db,
      idempotencyKey: message.idempotencyKey,
      claimedAtMs: 9999,
    });
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBe(1100);

    await rollbackReplyingHintEmissionClaim({
      db,
      idempotencyKey: message.idempotencyKey,
      claimedAtMs: 1100,
    });
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBeNull();
  });

  it("does not clear reply hint state from D1 reset_existing intake", async () => {
    const { db, readRow } = createInMemoryDispatchLedgerDb();
    const message = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    await claimReplyingHintEmission({
      db,
      idempotencyKey: message.idempotencyKey,
      nowMs: 1100,
    });
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBe(1100);

    const reset = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1000 + DISPATCH_IDEMPOTENCY_WINDOW_MS + 1,
    });

    expect(reset).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reset_existing",
        eventKind: "reclaim",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBe(1100);
  });

  it("returns missing_ledger_row when no ledger row exists", async () => {
    const { db } = createInMemoryDispatchLedgerDb();
    const claim = await claimReplyingHintEmission({
      db,
      idempotencyKey: "5:evt-missing|5:agt-missing",
      nowMs: 1100,
    });
    expect(claim).toBe("missing_ledger_row");
  });
});

describe("readDeliveryStabilityDispatchMetrics", () => {
  it("aggregates delivery stability metrics with explicit window and timeout thresholds", async () => {
    const { db, seedDlqRow, rows } = createInMemoryDispatchLedgerDb();
    const baseTs = 1_000_000;

    rows.set("5:evt-1|5:agt-1", {
      idempotencyKey: "5:evt-1|5:agt-1",
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      sourceEventId: "evt-1",
      sourceClientMessageId: null,
      targetProfileId: "agt-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      firstSeenAtMs: baseTs - 45_000,
      lastAttemptAtMs: baseTs - 40_000,
      attemptCount: 1,
      latestAttemptId: null,
      replyHintSentAtMs: null,
      finalReplySentAtMs: null,
    });
    rows.set("5:evt-2|5:agt-2", {
      idempotencyKey: "5:evt-2|5:agt-2",
      dispatchId: "dispatch-2",
      spaceId: "space-1",
      sourceEventId: "evt-2",
      sourceClientMessageId: null,
      targetProfileId: "agt-2",
      status: OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
      firstSeenAtMs: baseTs - 20_000,
      lastAttemptAtMs: baseTs - 10_000,
      attemptCount: 1,
      latestAttemptId: null,
      replyHintSentAtMs: null,
      finalReplySentAtMs: null,
    });
    rows.set("5:evt-3|5:agt-3", {
      idempotencyKey: "5:evt-3|5:agt-3",
      dispatchId: "dispatch-3",
      spaceId: "space-1",
      sourceEventId: "evt-3",
      sourceClientMessageId: null,
      targetProfileId: "agt-3",
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      firstSeenAtMs: baseTs - 8000,
      lastAttemptAtMs: baseTs - 8000,
      attemptCount: 2,
      latestAttemptId: null,
      replyHintSentAtMs: null,
      finalReplySentAtMs: null,
    });
    rows.set("5:evt-4|5:agt-4", {
      idempotencyKey: "5:evt-4|5:agt-4",
      dispatchId: "dispatch-4",
      spaceId: "space-1",
      sourceEventId: "evt-4",
      sourceClientMessageId: null,
      targetProfileId: "agt-4",
      status: OPENMELD_DAEMON_DISPATCH_STATE.deduped,
      firstSeenAtMs: baseTs - 5000,
      lastAttemptAtMs: baseTs - 5000,
      attemptCount: 1,
      latestAttemptId: null,
      replyHintSentAtMs: null,
      finalReplySentAtMs: null,
    });
    rows.set("5:evt-5|5:agt-5", {
      idempotencyKey: "5:evt-5|5:agt-5",
      dispatchId: "dispatch-5",
      spaceId: "space-1",
      sourceEventId: "evt-5",
      sourceClientMessageId: null,
      targetProfileId: "agt-5",
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      firstSeenAtMs: baseTs - 3000,
      lastAttemptAtMs: baseTs - 6000,
      attemptCount: 3,
      latestAttemptId: null,
      replyHintSentAtMs: null,
      finalReplySentAtMs: null,
    });

    seedDlqRow({
      dispatchId: "dispatch-1",
      idempotencyKey: "5:evt-1|5:agt-1",
      sourceEventId: "evt-1",
      targetProfileId: "agt-1",
      errorCode: "daemon.delivery.timeout",
      failedAtMs: baseTs - 1000,
    });
    seedDlqRow({
      dispatchId: "dispatch-2",
      idempotencyKey: "5:evt-2|5:agt-2",
      sourceEventId: "evt-2",
      targetProfileId: "agt-2",
      errorCode: "permission.denied.runtime",
      failedAtMs: baseTs - 1000,
    });

    const metrics = await readDeliveryStabilityDispatchMetrics({
      db,
      nowMs: baseTs,
      observeWindowMs: 60_000,
      dispatchingTimeoutMs: 5000,
    });
    expect(metrics.failedTerminalCount).toBe(1);
    expect(metrics.coldStartTimeoutCount).toBe(1);
    expect(metrics.dispatchingTimeoutCount).toBe(1);
    expect(metrics.dedupedCount).toBe(1);
    expect(metrics.failedTerminalRate).toBeCloseTo(1 / 3);
    expect(metrics.coldStartTimeoutRate).toBeCloseTo(1 / 3);
    expect(metrics.dedupedRatio).toBeCloseTo(1 / 4);
  });

  it("falls back to zero rates when no recent data exists", async () => {
    const { db } = createInMemoryDispatchLedgerDb();
    const metrics = await readDeliveryStabilityDispatchMetrics({
      db,
      nowMs: 1000,
      observeWindowMs: 60_000,
      dispatchingTimeoutMs: 5000,
    });

    expect(metrics).toEqual({
      failedTerminalCount: 0,
      failedTerminalRate: 0,
      coldStartTimeoutCount: 0,
      coldStartTimeoutRate: 0,
      dispatchingTimeoutCount: 0,
      dedupedCount: 0,
      dedupedRatio: 0,
    });
  });
});
