import {
  buildMentionDispatchResultEnvelope,
  buildRuntimeCoordinatorExecutionId,
  sanitizeDispatchErrorSummary,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchQueueMessage,
  OpenMeldDaemonDispatchQueueRecoveryReason,
  OpenMeldDaemonMentionDispatchResultPayload,
  RuntimeCoordinatorExecutionStatus,
  RuntimeTransportDeliveryExecutionIdentity,
} from "@openmeld/schemas/types";
import {
  type RuntimeCoordinatorTokenAwareEventKind,
  type RuntimeCoordinatorTokenAwareExecutionDecision,
  resolveRuntimeCoordinatorTokenAwareExecutionDecision,
} from "../../../runtime-transport/application/runtime-coordinator-execution-token";
import {
  DELIVERY_STABILITY_DEFAULT_DISPATCHING_TIMEOUT_MS,
  DELIVERY_STABILITY_DEFAULT_METRICS_WINDOW_MS,
} from "../../../strategy-constants";
import {
  DISPATCH_PLANNER_BLOCKED_DECISION_CODE,
  DISPATCH_PLANNER_FAILED_DECISION_CODE,
} from "../../application/dispatch-trace-decision-codes";
import {
  type DispatchAttemptClaimDecision,
  resolveDispatchAttemptClaimDecision,
} from "../../rules/dispatch-attempt-claim-policy";
import { resolveCoreClaimTransitionContractViolation } from "../../rules/dispatch-health-invariant-policy";
import { emitCoreDispatchHealthFinding } from "../../rules/dispatch-health-view";
import { buildIdempotencyKey } from "../../rules/dispatch-idempotency";
import {
  isActiveDispatchAttemptState,
  isTerminalDispatchAttemptState,
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
  type OpenMeldDaemonDispatchAttemptState,
  type OpenMeldDaemonDispatchState,
  resolveAttemptStateForDispatchState,
  toOpenMeldDaemonDispatchAttemptState,
  toOpenMeldDaemonDispatchState,
} from "../../rules/dispatch-lifecycle-contract";
import { DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS } from "../../rules/dispatch-runtime-constants";

export type { OpenMeldDaemonDispatchAttemptState, OpenMeldDaemonDispatchState };
export {
  isActiveDispatchAttemptState,
  isTerminalDispatchAttemptState,
  resolveAttemptStateForDispatchState,
  toOpenMeldDaemonDispatchAttemptState,
  toOpenMeldDaemonDispatchState,
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
};

export type OpenMeldDaemonOpsDecisionRecord = {
  id: string;
  decisionCode: string;
  decisionPayloadJson: string;
  decidedBy: string;
  decidedAtMs: number;
  expectedRecoveryCriteria: string | null;
  source: string;
  correlationId: string | null;
};

type NonReadyMentionDispatchDecision = Extract<
  OpenMeldDaemonMentionDispatchResultPayload,
  { status: "blocked" | "failed" }
>;

export type DispatchSlaMetrics = {
  failedTerminalCount: number;
  failedTerminalRate: number;
  coldStartTimeoutCount: number;
  coldStartTimeoutRate: number;
  dispatchingTimeoutCount: number;
  dedupedCount: number;
  dedupedRatio: number;
};

export type RuntimeCoordinatorQueueDecisionRequest = {
  claimDecision: RuntimeCoordinatorQueueTriggeredClaimDecision;
  coordinatorDecision: RuntimeCoordinatorTokenAwareExecutionDecision;
  eventKind: Extract<
    RuntimeCoordinatorTokenAwareEventKind,
    "reclaim" | "retry"
  >;
  reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only";
  runtimeCoordinatorExecutionId: string;
  runtimeCoordinatorStatus: RuntimeCoordinatorExecutionStatus | null;
};

export type OpenMeldDaemonDispatchAttemptClaimResult =
  | {
      status: "claimed";
      attemptId: string;
      attemptNo: number;
      replyingHintActive: boolean;
      deliveryRecoveryReason?: OpenMeldDaemonDispatchQueueRecoveryReason;
    }
  | {
      status: "continued";
      attemptId: string;
      attemptNo: number;
      connectionGeneration: number;
      daemonSessionId: string;
      leaseEpoch: number;
      replyingHintActive: boolean;
    }
  | {
      status: "deduped";
      hostedAdmissionRecoveryAttemptId?: string;
      hostedAdmissionRecoveryAttemptNo?: number;
      runtimeCoordinatorDecisionRequest?: RuntimeCoordinatorQueueDecisionRequest;
    };

type ExistingDispatchLedgerRow = {
  attemptCount: number;
  dispatchId: string;
  firstSeenAtMs: number;
  lastAttemptAtMs: number;
  latestAttemptId: string | null;
  replyHintSentAtMs: number | null;
  status: OpenMeldDaemonDispatchState | null;
};

const requireExistingDispatchLedgerRow = (
  row: ExistingDispatchLedgerRow | null
): ExistingDispatchLedgerRow => {
  if (!row) {
    throw new Error("dispatch claim decision requires an existing ledger row");
  }
  return row;
};

export type DispatchAttemptResultAcceptanceFact =
  | {
      status: "found";
      attemptId: string;
      attemptStatus: OpenMeldDaemonDispatchAttemptState;
      daemonSessionId: string;
      dispatchId: string;
      leaseEpoch: number;
      spaceId: string | null;
      targetProfileId: string;
      taskId: string;
    }
  | {
      status: "missing";
    }
  | {
      status: "invalid";
      reasonCode:
        | "daemon.delivery.timeout"
        | "daemon.result.identity_mismatch"
        | "daemon.session.stale_lease";
    };

export type DispatchAttemptExecutionOwnershipFact =
  | {
      status: "found";
      attemptId: string;
      bindingId: string;
      agentControllerRef: string;
      dispatchId: string;
      openMeldServiceRuntimeId: string;
      targetProfileId: string;
      taskId: string;
    }
  | {
      status: "missing";
    };

type DispatchAttemptLedgerRow = {
  attemptId: string;
  attemptNo: number;
  status: OpenMeldDaemonDispatchAttemptState | null;
  errorCode: string | null;
  connectionGeneration: number | null;
  daemonSessionId: string | null;
  leaseEpoch: number | null;
} | null;

type ClaimDispatchAttemptInput = {
  db: D1Database;
  message: OpenMeldDaemonDispatchQueueMessage;
  attempt: number;
  nowMs: number;
};

const DELIVERY_STABILITY_MIN_DENOMINATOR = 1;
const safeNumber = (input: unknown): number => {
  const value = Number(input);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
};

const roundRate = (numerator: number, denominator: number): number => {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
};

export const readDeliveryStabilityDispatchMetrics = async (input: {
  db: D1Database;
  nowMs: number;
  observeWindowMs?: number;
  dispatchingTimeoutMs?: number;
}): Promise<DispatchSlaMetrics> => {
  const nowMs = Math.max(0, Math.trunc(input.nowMs));
  const observeWindowMs = Math.max(
    1,
    Math.trunc(
      input.observeWindowMs ?? DELIVERY_STABILITY_DEFAULT_METRICS_WINDOW_MS
    )
  );
  const dispatchingTimeoutMs = Math.max(
    1,
    Math.trunc(
      input.dispatchingTimeoutMs ??
        DELIVERY_STABILITY_DEFAULT_DISPATCHING_TIMEOUT_MS
    )
  );
  const observeFromMs = Math.max(0, nowMs - observeWindowMs);
  const dispatchingTimeoutAtMs = Math.max(0, nowMs - dispatchingTimeoutMs);

  const summary = await input.db
    .prepare(
      `
        SELECT
          COALESCE(SUM(CASE WHEN status = 'failed_terminal' THEN 1 ELSE 0 END), 0) AS failed_terminal_count,
          COALESCE(SUM(CASE WHEN status IN ('succeeded','failed_retryable','failed_terminal','blocked') THEN 1 ELSE 0 END), 0) AS completed_relevant_count,
          COALESCE(SUM(CASE WHEN status = 'deduped' THEN 1 ELSE 0 END), 0) AS deduped_count,
          COALESCE(SUM(
            CASE
              WHEN status = 'dispatching' AND last_attempt_at_ms <= ? THEN 1
              ELSE 0
            END
          ), 0) AS dispatching_timeout_count
        FROM openMeldDaemon_dispatch_ledger
        WHERE last_attempt_at_ms >= ?
      `
    )
    .bind(dispatchingTimeoutAtMs, observeFromMs)
    .first<{
      failed_terminal_count?: unknown;
      completed_relevant_count?: unknown;
      deduped_count?: unknown;
      dispatching_timeout_count?: unknown;
    }>();

  const coldStartResult = await input.db
    .prepare(
      `
        SELECT
          COALESCE(COUNT(*), 0) AS cold_start_timeout_count
        FROM openMeldDaemon_dlq
        WHERE error_code = 'daemon.delivery.timeout'
          AND failed_at_ms >= ?
      `
    )
    .bind(observeFromMs)
    .first<{ cold_start_timeout_count?: unknown }>();

  const failedTerminalCount = safeNumber(summary?.failed_terminal_count);
  const completedRelevantCount = safeNumber(summary?.completed_relevant_count);
  const dedupedCount = safeNumber(summary?.deduped_count);
  const dispatchingTimeoutCount = safeNumber(
    summary?.dispatching_timeout_count
  );
  const coldStartTimeoutCount = safeNumber(
    coldStartResult?.cold_start_timeout_count
  );
  const completedRelevantRateDenominator =
    completedRelevantCount || DELIVERY_STABILITY_MIN_DENOMINATOR;

  const dedupedRatioDenominator =
    completedRelevantCount + dedupedCount || DELIVERY_STABILITY_MIN_DENOMINATOR;

  return {
    failedTerminalCount,
    failedTerminalRate: roundRate(
      failedTerminalCount,
      completedRelevantRateDenominator
    ),
    coldStartTimeoutCount,
    coldStartTimeoutRate: roundRate(
      coldStartTimeoutCount,
      completedRelevantRateDenominator
    ),
    dispatchingTimeoutCount,
    dedupedCount,
    dedupedRatio: roundRate(dedupedCount, dedupedRatioDenominator),
  };
};

const parseOptionalInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (value === null || typeof value === "undefined") {
    return null;
  }
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) ? parsedValue : null;
};

const didWriteRows = (value: unknown): boolean => {
  const candidate = value as {
    rowsWritten?: unknown;
    meta?: { changes?: unknown };
  };
  const rowsWritten = Number(candidate.rowsWritten ?? candidate.meta?.changes);
  return Number.isFinite(rowsWritten) && rowsWritten > 0;
};

const isNonReadyMentionDispatchState = (
  status: OpenMeldDaemonDispatchState | null
): boolean => {
  return (
    status === OPENMELD_DAEMON_DISPATCH_STATE.blocked ||
    status === OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal
  );
};

const toPlannerDispatchState = (
  decision: NonReadyMentionDispatchDecision
): OpenMeldDaemonDispatchState => {
  return decision.status === "blocked"
    ? OPENMELD_DAEMON_DISPATCH_STATE.blocked
    : OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal;
};

const toPlannerAttemptState = (
  decision: NonReadyMentionDispatchDecision
): Extract<
  OpenMeldDaemonDispatchAttemptState,
  "blocked" | "failed_terminal"
> => {
  return decision.status === "blocked"
    ? OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.blocked
    : OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal;
};

const toPlannerDecisionCode = (
  decision: NonReadyMentionDispatchDecision
): string => {
  return decision.status === "blocked"
    ? DISPATCH_PLANNER_BLOCKED_DECISION_CODE
    : DISPATCH_PLANNER_FAILED_DECISION_CODE;
};

const buildPlannerAttemptId = (dispatchId: string): string => {
  return `planner:${dispatchId}`;
};

const writePlannerMentionDispatchLedgerRow = async (input: {
  db: D1Database;
  decision: NonReadyMentionDispatchDecision;
  dispatchStatus: OpenMeldDaemonDispatchState;
  effectiveDispatchId: string;
  idempotencyKey: string;
  nowMs: number;
  plannerAttemptId: string;
  existingLedgerRow: ExistingDispatchLedgerRow | null;
  sourceClientMessageId?: string | null;
  spaceId: string;
}): Promise<boolean> => {
  if (input.existingLedgerRow) {
    if (input.existingLedgerRow.latestAttemptId !== input.plannerAttemptId) {
      return false;
    }

    const result = await input.db
      .prepare(
        `
          UPDATE openMeldDaemon_dispatch_ledger
          SET
            dispatch_id = ?,
            space_id = ?,
            source_event_id = ?,
            source_client_message_id = COALESCE(?, source_client_message_id),
            target_profile_id = ?,
            status = ?,
            last_attempt_at_ms = ?,
            latest_attempt_id = ?,
            attempt_count = CASE
              WHEN attempt_count > 1 THEN attempt_count
              ELSE 1
            END
          WHERE idempotency_key = ?
            AND status IN (?, ?)
            AND latest_attempt_id = ?
        `
      )
      .bind(
        input.effectiveDispatchId,
        input.spaceId,
        input.decision.sourceEventId,
        normalizeString(input.sourceClientMessageId),
        input.decision.targetProfileId,
        input.dispatchStatus,
        input.nowMs,
        input.plannerAttemptId,
        input.idempotencyKey,
        OPENMELD_DAEMON_DISPATCH_STATE.blocked,
        OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        input.plannerAttemptId
      )
      .run();

    return didWriteRows(result);
  }

  const result = await input.db
    .prepare(
      `
        INSERT OR IGNORE INTO openMeldDaemon_dispatch_ledger (
          idempotency_key,
          dispatch_id,
          space_id,
          source_event_id,
          source_client_message_id,
          target_profile_id,
          status,
          first_seen_at_ms,
          last_attempt_at_ms,
          attempt_count,
          latest_attempt_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      input.idempotencyKey,
      input.effectiveDispatchId,
      input.spaceId,
      input.decision.sourceEventId,
      normalizeString(input.sourceClientMessageId),
      input.decision.targetProfileId,
      input.dispatchStatus,
      input.nowMs,
      input.nowMs,
      1,
      input.plannerAttemptId
    )
    .run();

  return didWriteRows(result);
};

const buildClaimedDispatchAttemptResult = (input: {
  attemptId: string;
  attemptNo: number;
  replyingHintActive: boolean;
  deliveryRecoveryReason?: OpenMeldDaemonDispatchQueueRecoveryReason | null;
}): OpenMeldDaemonDispatchAttemptClaimResult => {
  return {
    status: "claimed",
    attemptId: input.attemptId,
    attemptNo: input.attemptNo,
    replyingHintActive: input.replyingHintActive,
    ...(input.deliveryRecoveryReason
      ? {
          deliveryRecoveryReason: input.deliveryRecoveryReason,
        }
      : {}),
  };
};

const commitDispatchAttemptClaim = async (input: {
  attemptId: string;
  attemptNo: number;
  createdAtMs: number;
  db: D1Database;
  deliveryRecoveryReason?: OpenMeldDaemonDispatchQueueRecoveryReason | null;
  dispatchId: string;
  idempotencyKey: string;
  ledgerMutation: D1PreparedStatement;
  targetProfileId: string;
  taskId: string;
}): Promise<OpenMeldDaemonDispatchAttemptClaimResult> => {
  const [ledgerResult, attemptResult] = await input.db.batch([
    input.ledgerMutation,
    prepareDispatchAttemptRow({
      attemptId: input.attemptId,
      attemptNo: input.attemptNo,
      createdAtMs: input.createdAtMs,
      db: input.db,
      dispatchId: input.dispatchId,
      idempotencyKey: input.idempotencyKey,
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
      targetProfileId: input.targetProfileId,
      taskId: input.taskId,
    }),
  ]);
  if (!didWriteRows(ledgerResult)) {
    return { status: "deduped" };
  }
  if (!didWriteRows(attemptResult)) {
    throw new Error(
      "dispatch attempt aggregate write did not create its claimed attempt"
    );
  }
  return buildClaimedDispatchAttemptResult({
    attemptId: input.attemptId,
    attemptNo: input.attemptNo,
    replyingHintActive: false,
    deliveryRecoveryReason: input.deliveryRecoveryReason,
  });
};

const prepareExistingDispatchLedgerForNewAttempt = (input: {
  db: D1Database;
  message: OpenMeldDaemonDispatchQueueMessage;
  nowMs: number;
  attemptId: string;
  attemptNo: number;
  includeDispatchId: boolean;
  whereSql: string;
  whereBindings: unknown[];
}) => {
  const dispatchOwner = normalizeDispatchOwnerEvidence(
    input.message.dispatchOwner
  );
  return input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_ledger
        SET
          ${input.includeDispatchId ? "dispatch_id = ?," : ""}
          space_id = ?,
          source_event_id = ?,
          source_client_message_id = ?,
          dispatch_owner_kind = CASE
            WHEN dispatch_owner_kind IS NULL AND dispatch_owner_id IS NULL THEN ?
            ELSE dispatch_owner_kind
          END,
          dispatch_owner_id = CASE
            WHEN dispatch_owner_kind IS NULL AND dispatch_owner_id IS NULL THEN ?
            ELSE dispatch_owner_id
          END,
          target_profile_id = ?,
          status = ?,
          last_attempt_at_ms = ?,
          latest_attempt_id = ?,
          attempt_count = CASE
            WHEN attempt_count > ? THEN attempt_count
            ELSE ?
          END,
          reply_hint_sent_at_ms = NULL
        WHERE idempotency_key = ?
          ${input.whereSql}
      `
    )
    .bind(
      ...(input.includeDispatchId ? [input.message.dispatchId] : []),
      input.message.spaceId,
      input.message.sourceEventId,
      normalizeString(input.message.sourceClientMessageId),
      dispatchOwner.kind,
      dispatchOwner.id,
      input.message.targetProfileId,
      OPENMELD_DAEMON_DISPATCH_STATE.queued,
      input.nowMs,
      input.attemptId,
      input.attemptNo,
      input.attemptNo,
      input.message.idempotencyKey,
      ...input.whereBindings
    );
};

const claimNewDispatchAttempt = (
  input: ClaimDispatchAttemptInput
): Promise<OpenMeldDaemonDispatchAttemptClaimResult> => {
  const dispatchOwner = normalizeDispatchOwnerEvidence(
    input.message.dispatchOwner
  );
  const attemptId = crypto.randomUUID();
  const attemptNo = 1;
  const ledgerMutation = input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_dispatch_ledger (
          idempotency_key,
          dispatch_id,
          space_id,
          source_event_id,
          source_client_message_id,
          dispatch_owner_kind,
          dispatch_owner_id,
          target_profile_id,
          status,
          first_seen_at_ms,
          last_attempt_at_ms,
          attempt_count,
          latest_attempt_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING
      `
    )
    .bind(
      input.message.idempotencyKey,
      input.message.dispatchId,
      input.message.spaceId,
      input.message.sourceEventId,
      normalizeString(input.message.sourceClientMessageId),
      dispatchOwner.kind,
      dispatchOwner.id,
      input.message.targetProfileId,
      OPENMELD_DAEMON_DISPATCH_STATE.queued,
      input.nowMs,
      input.nowMs,
      attemptNo,
      attemptId
    );
  return commitDispatchAttemptClaim({
    attemptId,
    attemptNo,
    createdAtMs: input.nowMs,
    db: input.db,
    dispatchId: input.message.dispatchId,
    idempotencyKey: input.message.idempotencyKey,
    ledgerMutation,
    targetProfileId: input.message.targetProfileId,
    taskId: input.message.taskId,
  });
};

const tryClaimRecoveryDispatchAttempt = (input: {
  db: D1Database;
  existing: ExistingDispatchLedgerRow;
  existingStatus: OpenMeldDaemonDispatchState | null;
  lastAttemptAtMs: number;
  message: OpenMeldDaemonDispatchQueueMessage;
  nowMs: number;
  deliveryRecoveryReason: OpenMeldDaemonDispatchQueueRecoveryReason | null;
}): Promise<OpenMeldDaemonDispatchAttemptClaimResult | null> => {
  if (!input.deliveryRecoveryReason) {
    return Promise.resolve(null);
  }

  const attemptId = crypto.randomUUID();
  const attemptNo = Math.max(1, input.existing.attemptCount + 1);
  const ledgerMutation = prepareExistingDispatchLedgerForNewAttempt({
    db: input.db,
    message: input.message,
    nowMs: input.nowMs,
    attemptId,
    attemptNo,
    includeDispatchId: true,
    whereSql: `
          AND status IS ?
          AND last_attempt_at_ms = ?
          AND latest_attempt_id IS ?
    `,
    whereBindings: [
      input.existingStatus,
      input.lastAttemptAtMs,
      input.existing.latestAttemptId,
    ],
  });

  return commitDispatchAttemptClaim({
    attemptId,
    attemptNo,
    createdAtMs: input.nowMs,
    db: input.db,
    deliveryRecoveryReason: input.deliveryRecoveryReason,
    dispatchId: input.existing.dispatchId,
    idempotencyKey: input.message.idempotencyKey,
    ledgerMutation,
    targetProfileId: input.message.targetProfileId,
    taskId: input.message.taskId,
  });
};

const reclaimStaleDispatchAttempt = async (input: {
  db: D1Database;
  existing: ExistingDispatchLedgerRow;
  expectedStatus:
    | typeof OPENMELD_DAEMON_DISPATCH_STATE.dispatching
    | typeof OPENMELD_DAEMON_DISPATCH_STATE.queued;
  lastAttemptAtMs: number;
  message: OpenMeldDaemonDispatchQueueMessage;
  nowMs: number;
  deliveryRecoveryReason: OpenMeldDaemonDispatchQueueRecoveryReason | null;
}): Promise<OpenMeldDaemonDispatchAttemptClaimResult> => {
  const attemptId = crypto.randomUUID();
  const attemptNo = Math.max(1, input.existing.attemptCount + 1);
  const ledgerMutation = prepareExistingDispatchLedgerForNewAttempt({
    db: input.db,
    message: input.message,
    nowMs: input.nowMs,
    attemptId,
    attemptNo,
    includeDispatchId: false,
    whereSql: `
          AND status = ?
          AND last_attempt_at_ms = ?
          AND latest_attempt_id IS ?
    `,
    whereBindings: [
      input.expectedStatus,
      input.lastAttemptAtMs,
      input.existing.latestAttemptId,
    ],
  });

  const claimResult = await commitDispatchAttemptClaim({
    attemptId,
    attemptNo,
    createdAtMs: input.nowMs,
    db: input.db,
    deliveryRecoveryReason: input.deliveryRecoveryReason,
    dispatchId: input.existing.dispatchId,
    idempotencyKey: input.message.idempotencyKey,
    ledgerMutation,
    targetProfileId: input.message.targetProfileId,
    taskId: input.message.taskId,
  });
  if (claimResult.status === "claimed" && input.existing.latestAttemptId) {
    await markDispatchAttemptStatus({
      attemptId: input.existing.latestAttemptId,
      db: input.db,
      errorCode: "dispatch.attempt.superseded",
      errorMessage: "dispatch attempt was superseded after stale reclaim",
      nowMs: input.nowMs,
      status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
    });
  }
  return claimResult;
};

const claimExistingDispatchInsideIdempotencyWindow = (input: {
  db: D1Database;
  existing: ExistingDispatchLedgerRow;
  message: OpenMeldDaemonDispatchQueueMessage;
  nowMs: number;
  deliveryRecoveryReason: OpenMeldDaemonDispatchQueueRecoveryReason | null;
}): Promise<OpenMeldDaemonDispatchAttemptClaimResult> => {
  const attemptId = crypto.randomUUID();
  const attemptNo = Math.max(1, input.existing.attemptCount + 1);
  const ledgerMutation = prepareExistingDispatchLedgerForNewAttempt({
    db: input.db,
    message: input.message,
    nowMs: input.nowMs,
    attemptId,
    attemptNo,
    includeDispatchId: false,
    whereSql: `
          AND status IS ?
          AND last_attempt_at_ms = ?
          AND latest_attempt_id IS ?
    `,
    whereBindings: [
      input.existing.status,
      input.existing.lastAttemptAtMs,
      input.existing.latestAttemptId,
    ],
  });
  return commitDispatchAttemptClaim({
    attemptId,
    attemptNo,
    createdAtMs: input.nowMs,
    db: input.db,
    deliveryRecoveryReason: input.deliveryRecoveryReason,
    dispatchId: input.existing.dispatchId,
    idempotencyKey: input.message.idempotencyKey,
    ledgerMutation,
    targetProfileId: input.message.targetProfileId,
    taskId: input.message.taskId,
  });
};

const resetDispatchLedgerClaim = (input: {
  db: D1Database;
  existing: ExistingDispatchLedgerRow;
  message: OpenMeldDaemonDispatchQueueMessage;
  nowMs: number;
  deliveryRecoveryReason: OpenMeldDaemonDispatchQueueRecoveryReason | null;
}): Promise<OpenMeldDaemonDispatchAttemptClaimResult> => {
  const dispatchOwner = normalizeDispatchOwnerEvidence(
    input.message.dispatchOwner
  );
  const attemptId = crypto.randomUUID();
  const attemptNo = 1;
  const ledgerMutation = input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_ledger
        SET
          dispatch_id = ?,
          space_id = ?,
          source_event_id = ?,
          source_client_message_id = ?,
          dispatch_owner_kind = CASE
            WHEN dispatch_owner_kind IS NULL AND dispatch_owner_id IS NULL THEN ?
            ELSE dispatch_owner_kind
          END,
          dispatch_owner_id = CASE
            WHEN dispatch_owner_kind IS NULL AND dispatch_owner_id IS NULL THEN ?
            ELSE dispatch_owner_id
          END,
          target_profile_id = ?,
          status = ?,
          first_seen_at_ms = ?,
          last_attempt_at_ms = ?,
          attempt_count = ?,
          latest_attempt_id = ?,
          reply_hint_sent_at_ms = NULL
        WHERE idempotency_key = ?
          AND status IS ?
          AND last_attempt_at_ms = ?
          AND latest_attempt_id IS ?
      `
    )
    .bind(
      input.message.dispatchId,
      input.message.spaceId,
      input.message.sourceEventId,
      normalizeString(input.message.sourceClientMessageId),
      dispatchOwner.kind,
      dispatchOwner.id,
      input.message.targetProfileId,
      OPENMELD_DAEMON_DISPATCH_STATE.queued,
      input.nowMs,
      input.nowMs,
      attemptNo,
      attemptId,
      input.message.idempotencyKey,
      input.existing.status,
      input.existing.lastAttemptAtMs,
      input.existing.latestAttemptId
    );
  return commitDispatchAttemptClaim({
    attemptId,
    attemptNo,
    createdAtMs: input.nowMs,
    db: input.db,
    deliveryRecoveryReason: input.deliveryRecoveryReason,
    dispatchId: input.message.dispatchId,
    idempotencyKey: input.message.idempotencyKey,
    ledgerMutation,
    targetProfileId: input.message.targetProfileId,
    taskId: input.message.taskId,
  });
};

export const writeOpenMeldDaemonOpsDecision = async (input: {
  db: D1Database;
  decisionCode: string;
  decisionPayload: unknown;
  decidedBy: string;
  decidedAtMs: number;
  expectedRecoveryCriteria?: string | null;
  source: string;
  correlationId?: string | null;
}): Promise<void> => {
  const nowMs = Math.max(0, Math.trunc(input.decidedAtMs));
  const decisionCode =
    normalizeString(input.decisionCode) ?? "dispatch.ops.unknown";
  const decidedBy = normalizeString(input.decidedBy) ?? "unknown";
  const source = normalizeString(input.source) ?? "unknown";
  const expectedRecoveryCriteria =
    normalizeString(input.expectedRecoveryCriteria) ?? null;
  const correlationId = normalizeString(input.correlationId) ?? null;
  const decisionPayloadJson = JSON.stringify(input.decisionPayload ?? null);

  // D4 trace contract (physical-db-split.md): correlation-scoped decisions
  // keep only the latest row per decision code. NULL correlations never
  // conflict on the unique index, so uncorrelated decisions still append.
  // The WHERE guard keeps a late-arriving older decision from overwriting a
  // newer one.
  await input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_ops_decisions (
          id,
          decision_code,
          decision_payload_json,
          decided_by,
          decided_at_ms,
          expected_recovery_criteria,
          source,
          correlation_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(correlation_id, decision_code) DO UPDATE SET
          decision_payload_json = excluded.decision_payload_json,
          decided_by = excluded.decided_by,
          decided_at_ms = excluded.decided_at_ms,
          expected_recovery_criteria = excluded.expected_recovery_criteria,
          source = excluded.source
        WHERE excluded.decided_at_ms >= openMeldDaemon_ops_decisions.decided_at_ms
      `
    )
    .bind(
      crypto.randomUUID(),
      decisionCode,
      decisionPayloadJson,
      decidedBy,
      nowMs,
      expectedRecoveryCriteria,
      source,
      correlationId
    )
    .run();
};

export const listRecentOpenMeldDaemonOpsDecisions = async (input: {
  db: D1Database;
  limit: number;
  decisionCode?: string | null;
  correlationId?: string | null;
}): Promise<OpenMeldDaemonOpsDecisionRecord[]> => {
  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit)));
  const decisionCode = normalizeString(input.decisionCode);
  const correlationId = normalizeString(input.correlationId);
  const query = buildRecentOpenMeldDaemonOpsDecisionsQuery({
    correlationId,
    decisionCode,
  });
  const result = await input.db
    .prepare(query.sql)
    .bind(...query.params, limit)
    .all<{
      id?: unknown;
      decision_code?: unknown;
      decision_payload_json?: unknown;
      decided_by?: unknown;
      decided_at_ms?: unknown;
      expected_recovery_criteria?: unknown;
      source?: unknown;
      correlation_id?: unknown;
    }>();

  const rows = Array.isArray(result.results) ? result.results : [];
  return rows
    .map((row): OpenMeldDaemonOpsDecisionRecord | null => {
      const id = normalizeString(row.id);
      const decisionCode = normalizeString(row.decision_code);
      const decisionPayloadJson =
        normalizeString(row.decision_payload_json) ?? "null";
      const decidedBy = normalizeString(row.decided_by);
      const source = normalizeString(row.source);
      if (!(id && decisionCode && decidedBy && source)) {
        return null;
      }
      return {
        id,
        decisionCode,
        decisionPayloadJson,
        decidedBy,
        decidedAtMs: Math.max(0, Number(row.decided_at_ms ?? 0)),
        expectedRecoveryCriteria:
          normalizeString(row.expected_recovery_criteria) ?? null,
        source,
        correlationId: normalizeString(row.correlation_id) ?? null,
      };
    })
    .filter((row): row is OpenMeldDaemonOpsDecisionRecord => row !== null);
};

const OPENMELD_DAEMON_OPS_DECISIONS_SELECT_SQL = `
  SELECT
    id,
    decision_code,
    decision_payload_json,
    decided_by,
    decided_at_ms,
    expected_recovery_criteria,
    source,
    correlation_id
  FROM openMeldDaemon_ops_decisions
`;

const buildRecentOpenMeldDaemonOpsDecisionsQuery = (input: {
  correlationId: string | null;
  decisionCode: string | null;
}): {
  params: string[];
  sql: string;
} => {
  if (input.correlationId && input.decisionCode) {
    return {
      params: [input.correlationId, input.decisionCode],
      sql: `${OPENMELD_DAEMON_OPS_DECISIONS_SELECT_SQL}
        WHERE correlation_id = ?
          AND decision_code = ?
        ORDER BY decided_at_ms DESC
        LIMIT ?`,
    };
  }

  if (input.correlationId) {
    return {
      params: [input.correlationId],
      sql: `${OPENMELD_DAEMON_OPS_DECISIONS_SELECT_SQL}
        WHERE correlation_id = ?
        ORDER BY decided_at_ms DESC
        LIMIT ?`,
    };
  }

  if (input.decisionCode) {
    return {
      params: [input.decisionCode],
      sql: `${OPENMELD_DAEMON_OPS_DECISIONS_SELECT_SQL}
        WHERE decision_code = ?
        ORDER BY decided_at_ms DESC
        LIMIT ?`,
    };
  }

  return {
    params: [],
    sql: `${OPENMELD_DAEMON_OPS_DECISIONS_SELECT_SQL}
      ORDER BY decided_at_ms DESC
      LIMIT ?`,
  };
};

export const claimDispatchAttempt = async (
  input: ClaimDispatchAttemptInput
): Promise<OpenMeldDaemonDispatchAttemptClaimResult> => {
  const existing: ExistingDispatchLedgerRow | null =
    await readDispatchLedgerRow({
      db: input.db,
      idempotencyKey: input.message.idempotencyKey,
    });
  const existingStatus = existing?.status ?? null;
  const lastAttemptAtMs = existing?.lastAttemptAtMs ?? null;
  const latestAttempt: DispatchAttemptLedgerRow = existing?.latestAttemptId
    ? await readDispatchAttemptRow({
        attemptId: existing.latestAttemptId,
        db: input.db,
      })
    : null;
  const claimDecision = resolveDispatchAttemptClaimDecision({
    existing,
    latestAttempt,
    nowMs: input.nowMs,
    requestedDispatchId: input.message.dispatchId,
    requestedRecoveryReason: input.message.deliveryRecoveryReason,
    staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
  });
  const coordinatorQueueDecision =
    resolveRuntimeCoordinatorQueueDecisionForClaim({
      claimDecision,
      latestAttempt,
      message: input.message,
    });
  const coordinatorClaimResult = await buildRuntimeCoordinatorClaimResult({
    coordinatorQueueDecision,
    db: input.db,
    message: input.message,
    nowMs: input.nowMs,
  });
  if (coordinatorClaimResult) {
    return coordinatorClaimResult;
  }
  const claimTransitionViolation = resolveCoreClaimTransitionContractViolation({
    decision: claimDecision,
    existingStatus,
    humanContext: {
      dispatchId: input.message.dispatchId,
      idempotencyKey: input.message.idempotencyKey,
      sourceEventId: input.message.sourceEventId,
      targetProfileId: input.message.targetProfileId,
    },
    latestAttemptStatus: latestAttempt?.status ?? null,
  });
  if (claimTransitionViolation) {
    emitCoreDispatchHealthFinding({
      eventName: "[core.openmeld.dispatch.transition_contract_violation]",
      fields: {
        decision: claimDecision.kind,
        dispatchId: input.message.dispatchId,
        existingStatus,
        idempotencyKey: input.message.idempotencyKey,
        latestAttemptStatus: latestAttempt?.status ?? null,
        operation: "dispatch.claim",
        sourceEventId: input.message.sourceEventId,
        targetProfileId: input.message.targetProfileId,
      },
      finding: claimTransitionViolation,
    });
  }
  switch (claimDecision.kind) {
    case "claim_new": {
      return claimNewDispatchAttempt(input);
    }
    case "resume_hosted_admission": {
      return {
        hostedAdmissionRecoveryAttemptId: claimDecision.attemptId,
        hostedAdmissionRecoveryAttemptNo: claimDecision.attemptNo,
        status: "deduped",
      };
    }
    case "reset_existing": {
      return resetDispatchLedgerClaim({
        db: input.db,
        existing: requireExistingDispatchLedgerRow(existing),
        message: input.message,
        nowMs: input.nowMs,
        deliveryRecoveryReason: claimDecision.deliveryRecoveryReason,
      });
    }
    case "claim_recovery": {
      if (!existing || lastAttemptAtMs === null) {
        return claimNewDispatchAttempt(input);
      }
      const recoveryClaim = await tryClaimRecoveryDispatchAttempt({
        db: input.db,
        existing,
        existingStatus,
        lastAttemptAtMs,
        message: input.message,
        nowMs: input.nowMs,
        deliveryRecoveryReason: claimDecision.deliveryRecoveryReason,
      });
      return recoveryClaim ?? { status: "deduped" };
    }
    case "continue_existing": {
      return {
        status: "continued",
        attemptId: claimDecision.attemptId,
        attemptNo: claimDecision.attemptNo,
        connectionGeneration: claimDecision.connectionGeneration,
        daemonSessionId: claimDecision.daemonSessionId,
        leaseEpoch: claimDecision.leaseEpoch,
        replyingHintActive: existing?.replyHintSentAtMs != null,
      };
    }
    case "dedupe": {
      return {
        status: "deduped",
      };
    }
    case "reclaim_stale_dispatching": {
      if (!existing || lastAttemptAtMs === null) {
        return claimNewDispatchAttempt(input);
      }
      return reclaimStaleDispatchAttempt({
        db: input.db,
        existing,
        expectedStatus: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
        lastAttemptAtMs,
        message: input.message,
        nowMs: input.nowMs,
        deliveryRecoveryReason: claimDecision.deliveryRecoveryReason,
      });
    }
    case "reclaim_stale_queued": {
      if (!existing || lastAttemptAtMs === null) {
        return claimNewDispatchAttempt(input);
      }
      return reclaimStaleDispatchAttempt({
        db: input.db,
        existing,
        expectedStatus: OPENMELD_DAEMON_DISPATCH_STATE.queued,
        lastAttemptAtMs,
        message: input.message,
        nowMs: input.nowMs,
        deliveryRecoveryReason: claimDecision.deliveryRecoveryReason,
      });
    }
    case "claim_existing_inside_window": {
      if (!existing) {
        return claimNewDispatchAttempt(input);
      }
      return claimExistingDispatchInsideIdempotencyWindow({
        db: input.db,
        existing,
        message: input.message,
        nowMs: input.nowMs,
        deliveryRecoveryReason: claimDecision.deliveryRecoveryReason,
      });
    }
    default: {
      throw new Error("unsupported dispatch claim decision");
    }
  }
};

type RuntimeCoordinatorQueueDecision =
  | {
      kind: "allow";
    }
  | {
      coordinatorDecision: RuntimeCoordinatorTokenAwareExecutionDecision;
      kind: "dedupe";
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only";
      claimDecision: RuntimeCoordinatorQueueTriggeredClaimDecision;
      runtimeCoordinatorExecutionId: string;
      runtimeCoordinatorStatus: RuntimeCoordinatorExecutionStatus | null;
    };

const buildRuntimeCoordinatorClaimResult = async (input: {
  coordinatorQueueDecision: RuntimeCoordinatorQueueDecision;
  db: D1Database;
  message: OpenMeldDaemonDispatchQueueMessage;
  nowMs: number;
}): Promise<OpenMeldDaemonDispatchAttemptClaimResult | null> => {
  if (input.coordinatorQueueDecision.kind !== "dedupe") {
    return null;
  }
  await fillMissingDispatchOwnerEvidenceFromMessage({
    db: input.db,
    message: input.message,
  });
  await writeRuntimeCoordinatorQueueDecision({
    db: input.db,
    decisionPayload: input.coordinatorQueueDecision,
    message: input.message,
    nowMs: input.nowMs,
  });
  const runtimeCoordinatorDecisionRequest =
    buildRuntimeCoordinatorQueueDecisionRequest(input.coordinatorQueueDecision);
  if (runtimeCoordinatorDecisionRequest) {
    return {
      runtimeCoordinatorDecisionRequest,
      status: "deduped",
    };
  }
  return {
    status: "deduped",
  };
};

const resolveRuntimeCoordinatorQueueDecision = (input: {
  claimDecision: DispatchAttemptClaimDecision;
  message: OpenMeldDaemonDispatchQueueMessage;
}): RuntimeCoordinatorQueueDecision => {
  const queueDecisionTrigger = resolveRuntimeCoordinatorQueueDecisionTrigger(
    input.claimDecision.kind
  );
  if (!queueDecisionTrigger) {
    return { kind: "allow" };
  }

  const coordinatorDecision =
    resolveRuntimeCoordinatorTokenAwareExecutionDecision({
      authority: null,
      eventKind: queueDecisionTrigger.eventKind,
      trigger: "queue",
    });
  return {
    kind: "dedupe",
    claimDecision: queueDecisionTrigger.claimDecision,
    coordinatorDecision,
    reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
    runtimeCoordinatorExecutionId: buildRuntimeCoordinatorExecutionId({
      dispatchId: input.message.dispatchId,
      spaceId: input.message.spaceId,
      targetProfileId: input.message.targetProfileId,
    }),
    runtimeCoordinatorStatus: null,
  };
};

const resolveRuntimeCoordinatorQueueDecisionForClaim = (input: {
  claimDecision: DispatchAttemptClaimDecision;
  latestAttempt: DispatchAttemptLedgerRow;
  message: OpenMeldDaemonDispatchQueueMessage;
}): RuntimeCoordinatorQueueDecision => {
  if (
    shouldRetryRuntimeCoordinatorHeadAcceptAfterRetryableFailure({
      claimDecision: input.claimDecision,
      latestAttempt: input.latestAttempt,
    })
  ) {
    return { kind: "allow" };
  }
  if (
    shouldRetryRuntimeCoordinatorHeadWaitingAfterRouteRecovery({
      claimDecision: input.claimDecision,
      latestAttempt: input.latestAttempt,
    })
  ) {
    return { kind: "allow" };
  }
  return resolveRuntimeCoordinatorQueueDecision({
    claimDecision: input.claimDecision,
    message: input.message,
  });
};

type RuntimeCoordinatorQueueTriggeredClaimDecision =
  | "continue_existing"
  | "reset_existing"
  | "claim_recovery"
  | "claim_existing_inside_window"
  | "reclaim_stale_dispatching"
  | "reclaim_stale_queued";

const resolveRuntimeCoordinatorQueueDecisionTrigger = (
  claimDecision: DispatchAttemptClaimDecision["kind"]
): {
  claimDecision: RuntimeCoordinatorQueueTriggeredClaimDecision;
  eventKind: Extract<
    RuntimeCoordinatorTokenAwareEventKind,
    "reclaim" | "retry"
  >;
} | null => {
  switch (claimDecision) {
    case "continue_existing":
    case "reset_existing":
      return {
        claimDecision,
        eventKind: "reclaim",
      };
    case "claim_recovery":
    case "claim_existing_inside_window":
      return {
        claimDecision,
        eventKind: "retry",
      };
    case "reclaim_stale_dispatching":
    case "reclaim_stale_queued":
      return {
        claimDecision,
        eventKind: "reclaim",
      };
    default:
      return null;
  }
};

const shouldRetryRuntimeCoordinatorHeadAcceptAfterRetryableFailure = (input: {
  claimDecision: DispatchAttemptClaimDecision;
  latestAttempt: DispatchAttemptLedgerRow;
}): boolean => {
  if (
    !(
      input.claimDecision.kind === "claim_existing_inside_window" ||
      input.claimDecision.kind === "reset_existing"
    )
  ) {
    return false;
  }
  return (
    input.latestAttempt?.status ===
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable &&
    isRuntimeCoordinatorHeadLifecycleRetryableErrorCode(
      input.latestAttempt.errorCode
    )
  );
};

const shouldRetryRuntimeCoordinatorHeadWaitingAfterRouteRecovery = (input: {
  claimDecision: DispatchAttemptClaimDecision;
  latestAttempt: DispatchAttemptLedgerRow;
}): boolean => {
  if (
    input.latestAttempt?.status !==
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable ||
    input.latestAttempt.errorCode !== "daemon.profile.offline"
  ) {
    return false;
  }

  if (input.claimDecision.kind === "claim_recovery") {
    return input.claimDecision.deliveryRecoveryReason === "route_lost";
  }

  return input.claimDecision.kind === "claim_existing_inside_window";
};

const isRuntimeCoordinatorHeadLifecycleRetryableErrorCode = (
  errorCode: string | null
): boolean => {
  return (
    typeof errorCode === "string" &&
    (errorCode.startsWith("runtime_coordinator.head_accept_") ||
      errorCode.startsWith("runtime_coordinator.head_no_execution_"))
  );
};

const buildRuntimeCoordinatorQueueDecisionRequest = (
  decision: RuntimeCoordinatorQueueDecision
): RuntimeCoordinatorQueueDecisionRequest | undefined => {
  if (
    decision.kind !== "dedupe" ||
    !decision.coordinatorDecision ||
    !decision.runtimeCoordinatorExecutionId
  ) {
    return undefined;
  }
  const eventKind = decision.coordinatorDecision.eventKind;
  if (!(eventKind === "retry" || eventKind === "reclaim")) {
    return undefined;
  }
  return {
    claimDecision: decision.claimDecision,
    coordinatorDecision: decision.coordinatorDecision,
    eventKind,
    reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
    runtimeCoordinatorExecutionId: decision.runtimeCoordinatorExecutionId,
    runtimeCoordinatorStatus: decision.runtimeCoordinatorStatus,
  };
};

const fillMissingDispatchOwnerEvidenceFromMessage = async (input: {
  db: D1Database;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<void> => {
  const dispatchOwner = normalizeDispatchOwnerEvidence(
    input.message.dispatchOwner
  );
  if (!(dispatchOwner.kind && dispatchOwner.id)) {
    return;
  }
  await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_ledger
        SET
          dispatch_owner_kind = ?,
          dispatch_owner_id = ?
        WHERE idempotency_key = ?
          AND dispatch_owner_kind IS NULL
          AND dispatch_owner_id IS NULL
      `
    )
    .bind(dispatchOwner.kind, dispatchOwner.id, input.message.idempotencyKey)
    .run();
};

const writeRuntimeCoordinatorQueueDecision = async (input: {
  db: D1Database;
  decisionPayload: RuntimeCoordinatorQueueDecision;
  message: OpenMeldDaemonDispatchQueueMessage;
  nowMs: number;
}): Promise<void> => {
  await writeOpenMeldDaemonOpsDecision({
    db: input.db,
    decisionCode: "runtime_coordinator.queue_claim_decision",
    decisionPayload: {
      ...input.decisionPayload,
      dispatchId: input.message.dispatchId,
      idempotencyKey: input.message.idempotencyKey,
      spaceId: input.message.spaceId,
      targetProfileId: input.message.targetProfileId,
    },
    decidedBy: "core.dispatch.queue.runtime_coordinator",
    decidedAtMs: input.nowMs,
    source: "dispatch_queue",
    correlationId: input.message.dispatchId,
  });
};

const readDispatchLedgerRow = async (input: {
  db: D1Database;
  idempotencyKey: string;
}): Promise<ExistingDispatchLedgerRow | null> => {
  const existing = await input.db
    .prepare(
      `
          SELECT
            dispatch_id,
            first_seen_at_ms,
            last_attempt_at_ms,
            latest_attempt_id,
            attempt_count,
            reply_hint_sent_at_ms,
            status
          FROM openMeldDaemon_dispatch_ledger
          WHERE idempotency_key = ?
          LIMIT 1
        `
    )
    .bind(input.idempotencyKey)
    .first<{
      attempt_count?: unknown;
      dispatch_id?: unknown;
      first_seen_at_ms?: unknown;
      last_attempt_at_ms?: unknown;
      latest_attempt_id?: unknown;
      reply_hint_sent_at_ms?: unknown;
      status?: unknown;
    }>();
  if (!existing) {
    return null;
  }
  return {
    attemptCount: Math.max(0, Number(existing.attempt_count ?? 0)),
    dispatchId:
      normalizeString(existing.dispatch_id) ??
      `missing-dispatch:${input.idempotencyKey}`,
    firstSeenAtMs: Math.max(0, Number(existing.first_seen_at_ms ?? 0)),
    lastAttemptAtMs: Math.max(0, Number(existing.last_attempt_at_ms ?? 0)),
    latestAttemptId: normalizeString(existing.latest_attempt_id),
    replyHintSentAtMs: parseOptionalInteger(existing.reply_hint_sent_at_ms),
    status: toOpenMeldDaemonDispatchState(existing.status),
  };
};

export const readDispatchFirstSeenAtMs = async (input: {
  db: D1Database;
  idempotencyKey: string;
}): Promise<number | null> => {
  const row = await readDispatchLedgerRow(input);
  return row?.firstSeenAtMs ?? null;
};

const readDispatchAttemptRow = async (input: {
  attemptId: string | null;
  db: D1Database;
}): Promise<DispatchAttemptLedgerRow> => {
  const normalizedAttemptId = normalizeString(input.attemptId);
  if (!normalizedAttemptId) {
    return null;
  }

  const row = await input.db
    .prepare(
      `
        SELECT
          attempt_id AS attemptId,
          attempt_no AS attemptNo,
          status,
          error_code AS errorCode,
          daemon_session_id AS daemonSessionId,
          connection_generation AS connectionGeneration,
          lease_epoch AS leaseEpoch
        FROM openMeldDaemon_dispatch_attempts
        WHERE attempt_id = ?
        LIMIT 1
      `
    )
    .bind(normalizedAttemptId)
    .first<{
      attemptId?: unknown;
      attemptNo?: unknown;
      status?: unknown;
      errorCode?: unknown;
      connectionGeneration?: unknown;
      daemonSessionId?: unknown;
      leaseEpoch?: unknown;
    }>();
  const attemptId = normalizeString(row?.attemptId);
  const status = toOpenMeldDaemonDispatchAttemptState(row?.status);
  if (!(attemptId && status)) {
    return null;
  }

  return {
    attemptId,
    attemptNo: Math.max(1, Number(row?.attemptNo ?? 1)),
    status,
    errorCode: normalizeString(row?.errorCode),
    connectionGeneration: parseOptionalInteger(row?.connectionGeneration),
    daemonSessionId: normalizeString(row?.daemonSessionId),
    leaseEpoch: parseOptionalInteger(row?.leaseEpoch),
  };
};

export const readDispatchAttemptResultAcceptanceFact = async (input: {
  attemptId: string;
  db: D1Database;
  dispatchId: string;
}): Promise<DispatchAttemptResultAcceptanceFact> => {
  const row = await input.db
    .prepare(
      `
        SELECT
          attempts.attempt_id AS attemptId,
          attempts.dispatch_id AS dispatchId,
          attempts.status AS attemptStatus,
          attempts.daemon_session_id AS daemonSessionId,
          attempts.lease_epoch AS leaseEpoch,
          ledger.space_id AS spaceId,
          attempts.task_id AS taskId,
          COALESCE(attempts.target_profile_id, ledger.target_profile_id) AS targetProfileId
        FROM openMeldDaemon_dispatch_attempts AS attempts
        LEFT JOIN openMeldDaemon_dispatch_ledger AS ledger
          ON ledger.dispatch_id = attempts.dispatch_id
        WHERE attempts.attempt_id = ?
          AND attempts.dispatch_id = ?
        LIMIT 1
      `
    )
    .bind(input.attemptId, input.dispatchId)
    .first<{
      attemptId?: unknown;
      attemptStatus?: unknown;
      daemonSessionId?: unknown;
      dispatchId?: unknown;
      leaseEpoch?: unknown;
      spaceId?: unknown;
      targetProfileId?: unknown;
      taskId?: unknown;
    }>();

  if (!row) {
    return { status: "missing" };
  }

  const attemptStatus = toOpenMeldDaemonDispatchAttemptState(row.attemptStatus);
  const daemonSessionId = normalizeString(row.daemonSessionId);
  const dispatchId = normalizeString(row.dispatchId);
  const leaseEpoch = parseOptionalInteger(row.leaseEpoch);
  const spaceId = normalizeString(row.spaceId);
  const targetProfileId = normalizeString(row.targetProfileId);
  const taskId = normalizeString(row.taskId);
  if (!(attemptStatus && dispatchId === input.dispatchId)) {
    return {
      reasonCode: "daemon.result.identity_mismatch",
      status: "invalid",
    };
  }
  if (attemptStatus === OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.timedOut) {
    return {
      reasonCode: "daemon.delivery.timeout",
      status: "invalid",
    };
  }
  if (!isActiveDispatchAttemptState(attemptStatus)) {
    return {
      reasonCode: "daemon.result.identity_mismatch",
      status: "invalid",
    };
  }
  if (!(daemonSessionId && leaseEpoch !== null)) {
    return {
      reasonCode: "daemon.session.stale_lease",
      status: "invalid",
    };
  }
  if (!(targetProfileId && taskId)) {
    return {
      reasonCode: "daemon.result.identity_mismatch",
      status: "invalid",
    };
  }

  return {
    attemptId: input.attemptId,
    attemptStatus,
    daemonSessionId,
    dispatchId,
    leaseEpoch,
    spaceId,
    targetProfileId,
    taskId,
    status: "found",
  };
};

export const readDispatchAttemptExecutionOwnershipFact = async (input: {
  attemptId: string;
  db: D1Database;
  dispatchId: string;
}): Promise<DispatchAttemptExecutionOwnershipFact> => {
  const row = await input.db
    .prepare(
      `
        SELECT
          attempt_id AS attemptId,
          dispatch_id AS dispatchId,
          target_profile_id AS targetProfileId,
          task_id AS taskId,
          execution_binding_id AS bindingId,
          execution_openmeld_service_runtime_id AS openMeldServiceRuntimeId,
          execution_agent_controller_ref AS agentControllerRef
        FROM openMeldDaemon_dispatch_attempts
        WHERE attempt_id = ?
          AND dispatch_id = ?
        LIMIT 1
      `
    )
    .bind(input.attemptId, input.dispatchId)
    .first<{
      attemptId?: unknown;
      bindingId?: unknown;
      agentControllerRef?: unknown;
      dispatchId?: unknown;
      openMeldServiceRuntimeId?: unknown;
      targetProfileId?: unknown;
      taskId?: unknown;
    }>();

  const attemptId = normalizeString(row?.attemptId);
  const bindingId = normalizeString(row?.bindingId);
  const agentControllerRef = normalizeString(row?.agentControllerRef);
  const dispatchId = normalizeString(row?.dispatchId);
  const openMeldServiceRuntimeId = normalizeString(
    row?.openMeldServiceRuntimeId
  );
  const targetProfileId = normalizeString(row?.targetProfileId);
  const taskId = normalizeString(row?.taskId);
  if (
    !(
      attemptId &&
      bindingId &&
      agentControllerRef &&
      dispatchId &&
      openMeldServiceRuntimeId &&
      targetProfileId &&
      taskId
    ) ||
    dispatchId !== input.dispatchId
  ) {
    return { status: "missing" };
  }

  return {
    attemptId,
    bindingId,
    agentControllerRef,
    dispatchId,
    openMeldServiceRuntimeId,
    targetProfileId,
    taskId,
    status: "found",
  };
};

const prepareDispatchAttemptRow = (input: {
  attemptId: string;
  attemptNo: number;
  createdAtMs: number;
  db: D1Database;
  dispatchId: string;
  idempotencyKey: string;
  status: OpenMeldDaemonDispatchAttemptState;
  targetProfileId?: string | null;
  taskId?: string | null;
}) => {
  return input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_dispatch_attempts (
          attempt_id,
          dispatch_id,
          idempotency_key,
          attempt_no,
          status,
          task_id,
          target_profile_id,
          created_at_ms,
          started_at_ms
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM openMeldDaemon_dispatch_ledger
          WHERE idempotency_key = ?
            AND latest_attempt_id = ?
            AND attempt_count = ?
        )
      `
    )
    .bind(
      input.attemptId,
      input.dispatchId,
      input.idempotencyKey,
      input.attemptNo,
      input.status,
      normalizeString(input.taskId),
      normalizeString(input.targetProfileId),
      input.createdAtMs,
      input.createdAtMs,
      input.idempotencyKey,
      input.attemptId,
      input.attemptNo
    );
};

const createTerminalPlannerAttemptRowIfMissing = async (input: {
  attemptId: string;
  createdAtMs: number;
  db: D1Database;
  dispatchId: string;
  idempotencyKey: string;
  status: Extract<
    OpenMeldDaemonDispatchAttemptState,
    "blocked" | "failed_terminal"
  >;
}): Promise<void> => {
  await input.db
    .prepare(
      `
        INSERT OR IGNORE INTO openMeldDaemon_dispatch_attempts (
          attempt_id,
          dispatch_id,
          idempotency_key,
          attempt_no,
          status,
          created_at_ms,
          started_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL)
      `
    )
    .bind(
      input.attemptId,
      input.dispatchId,
      input.idempotencyKey,
      1,
      input.status,
      input.createdAtMs
    )
    .run();
};

export const claimReplyingHintEmission = async (input: {
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
}): Promise<"claimed" | "already_claimed" | "missing_ledger_row"> => {
  const nowMs = Math.max(0, Math.trunc(input.nowMs));
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_ledger
        SET reply_hint_sent_at_ms = ?
        WHERE idempotency_key = ?
          AND reply_hint_sent_at_ms IS NULL
      `
    )
    .bind(nowMs, input.idempotencyKey)
    .run();
  if (didWriteRows(result)) {
    return "claimed";
  }

  const existing = await input.db
    .prepare(
      `
        SELECT idempotency_key
        FROM openMeldDaemon_dispatch_ledger
        WHERE idempotency_key = ?
        LIMIT 1
      `
    )
    .bind(input.idempotencyKey)
    .first<{ idempotency_key?: unknown }>();
  return existing ? "already_claimed" : "missing_ledger_row";
};

export const rollbackReplyingHintEmissionClaim = async (input: {
  db: D1Database;
  idempotencyKey: string;
  claimedAtMs: number;
}): Promise<void> => {
  await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_ledger
        SET reply_hint_sent_at_ms = NULL
        WHERE idempotency_key = ?
          AND reply_hint_sent_at_ms = ?
      `
    )
    .bind(input.idempotencyKey, Math.max(0, Math.trunc(input.claimedAtMs)))
    .run();
};

export const claimFinalReplyEmission = async (input: {
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
}): Promise<"claimed" | "already_claimed" | "missing_ledger_row"> => {
  const nowMs = Math.max(0, Math.trunc(input.nowMs));
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_ledger
        SET final_reply_sent_at_ms = ?
        WHERE idempotency_key = ?
          AND final_reply_sent_at_ms IS NULL
      `
    )
    .bind(nowMs, input.idempotencyKey)
    .run();
  if (didWriteRows(result)) {
    return "claimed";
  }

  const existing = await input.db
    .prepare(
      `
        SELECT idempotency_key
        FROM openMeldDaemon_dispatch_ledger
        WHERE idempotency_key = ?
        LIMIT 1
      `
    )
    .bind(input.idempotencyKey)
    .first<{ idempotency_key?: unknown }>();
  return existing ? "already_claimed" : "missing_ledger_row";
};

export const rollbackFinalReplyEmissionClaim = async (input: {
  db: D1Database;
  idempotencyKey: string;
  claimedAtMs: number;
}): Promise<void> => {
  await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_ledger
        SET final_reply_sent_at_ms = NULL
        WHERE idempotency_key = ?
          AND final_reply_sent_at_ms = ?
      `
    )
    .bind(input.idempotencyKey, Math.max(0, Math.trunc(input.claimedAtMs)))
    .run();
};

export const markDispatchStatus = async (input: {
  attemptId: string;
  attemptStatus?: OpenMeldDaemonDispatchAttemptState;
  db: D1Database;
  errorCode?: string | null;
  errorMessage?: string | null;
  idempotencyKey: string;
  leaseEpoch?: number | null;
  daemonSessionId?: string | null;
  status: OpenMeldDaemonDispatchState;
  nowMs: number;
}): Promise<void> => {
  await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_ledger
        SET status = ?, last_attempt_at_ms = ?, latest_attempt_id = ?
        WHERE idempotency_key = ?
      `
    )
    .bind(input.status, input.nowMs, input.attemptId, input.idempotencyKey)
    .run();

  await markDispatchAttemptStatus({
    attemptId: input.attemptId,
    daemonSessionId: input.daemonSessionId ?? null,
    db: input.db,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    leaseEpoch: input.leaseEpoch ?? null,
    nowMs: input.nowMs,
    status:
      input.attemptStatus ?? resolveAttemptStateForDispatchState(input.status),
  });
};

export const recordMentionDispatchPlannerDecision = async (input: {
  db: D1Database;
  decision: NonReadyMentionDispatchDecision;
  nowMs: number;
  sourceClientMessageId?: string | null;
  spaceId: string;
}): Promise<void> => {
  const idempotencyKey = buildIdempotencyKey({
    sourceEventId: input.decision.sourceEventId,
    targetProfileId: input.decision.targetProfileId,
  });
  const existing = await readDispatchLedgerRow({
    db: input.db,
    idempotencyKey,
  });
  if (existing?.status && !isNonReadyMentionDispatchState(existing.status)) {
    return;
  }

  const effectiveDispatchId = existing?.dispatchId ?? input.decision.dispatchId;
  const effectiveAttemptId = buildPlannerAttemptId(effectiveDispatchId);
  const effectiveDecision = {
    ...input.decision,
    dispatchId: effectiveDispatchId,
  } satisfies NonReadyMentionDispatchDecision;
  const dispatchStatus = toPlannerDispatchState(effectiveDecision);
  const attemptStatus = toPlannerAttemptState(effectiveDecision);

  const wrotePlannerLedgerRow = await writePlannerMentionDispatchLedgerRow({
    db: input.db,
    decision: effectiveDecision,
    dispatchStatus,
    effectiveDispatchId,
    existingLedgerRow: existing,
    idempotencyKey,
    nowMs: input.nowMs,
    plannerAttemptId: effectiveAttemptId,
    sourceClientMessageId: input.sourceClientMessageId,
    spaceId: input.spaceId,
  });
  if (!wrotePlannerLedgerRow) {
    return;
  }

  await createTerminalPlannerAttemptRowIfMissing({
    attemptId: effectiveAttemptId,
    createdAtMs: input.nowMs,
    db: input.db,
    dispatchId: effectiveDispatchId,
    idempotencyKey,
    status: attemptStatus,
  });
  await markDispatchAttemptStatus({
    attemptId: effectiveAttemptId,
    db: input.db,
    errorCode: effectiveDecision.errorCode,
    errorMessage: effectiveDecision.ruleReason,
    nowMs: input.nowMs,
    status: attemptStatus,
  });
  await writeOpenMeldDaemonOpsDecision({
    db: input.db,
    decisionCode: toPlannerDecisionCode(effectiveDecision),
    decisionPayload: buildMentionDispatchResultEnvelope(effectiveDecision),
    decidedBy: "core.space.dispatch_planner",
    decidedAtMs: input.nowMs,
    source: "space_dispatch_planner",
    correlationId: effectiveDispatchId,
  });
};

// Daemon execution evidence is present for workstation Wakes and intentionally
// absent for hosted native delivery. In both cases, waiting_result is only the
// dispatch read projection that execution accepted the turn and owes a result.
export const markDispatchAttemptWaitingForResult = async (input: {
  attemptId: string;
  connectionGeneration?: number | null;
  daemonSessionId?: string | null;
  db: D1Database;
  idempotencyKey: string;
  leaseEpoch?: number | null;
  nowMs: number;
  targetProfileId: string;
  taskId: string;
}): Promise<void> => {
  await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_ledger
        SET status = ?, last_attempt_at_ms = ?, latest_attempt_id = ?
        WHERE idempotency_key = ?
          AND latest_attempt_id = ?
      `
    )
    .bind(
      OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      input.nowMs,
      input.attemptId,
      input.idempotencyKey,
      input.attemptId
    )
    .run();

  await markDispatchAttemptStatus({
    attemptId: input.attemptId,
    connectionGeneration: input.connectionGeneration,
    daemonSessionId: input.daemonSessionId,
    db: input.db,
    leaseEpoch: input.leaseEpoch,
    nowMs: input.nowMs,
    status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
    targetProfileId: input.targetProfileId,
    taskId: input.taskId,
  });
};

export const recordDispatchAttemptExecutionOwnership = async (input: {
  attemptId: string;
  connectionGeneration: number;
  daemonSessionId: string;
  db: D1Database;
  dispatchId: string;
  executionIdentity: RuntimeTransportDeliveryExecutionIdentity;
  leaseEpoch: number;
  nowMs: number;
  targetProfileId: string;
  taskId: string;
}): Promise<void> => {
  const write = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_attempts
        SET
          daemon_session_id = ?,
          connection_generation = ?,
          lease_epoch = ?,
          task_id = ?,
          target_profile_id = ?,
          execution_identity_model_version = ?,
          execution_binding_id = ?,
          execution_openmeld_service_runtime_id = ?,
          execution_agent_controller_ref = ?,
          started_at_ms = COALESCE(started_at_ms, ?),
          error_code = NULL,
          error_message = NULL
        WHERE attempt_id = ?
          AND dispatch_id = ?
          AND status = ?
      `
    )
    .bind(
      input.daemonSessionId,
      input.connectionGeneration,
      input.leaseEpoch,
      normalizeString(input.taskId),
      normalizeString(input.targetProfileId),
      input.executionIdentity.core.modelVersion,
      input.executionIdentity.core.bindingId,
      input.executionIdentity.core.openMeldServiceRuntimeId.value,
      input.executionIdentity.core.agentControllerRef,
      input.nowMs,
      input.attemptId,
      input.dispatchId,
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching
    )
    .run();

  if (!didWriteRows(write)) {
    throw new Error(
      `dispatch attempt execution ownership was not recorded before delivery: ${input.dispatchId}::${input.attemptId}`
    );
  }
};

export const correlateDuplicateDispatchDeliveryAttempt = async (input: {
  correlatedAttemptId: string;
  connectionGeneration: number;
  daemonSessionId: string;
  duplicateAttemptId: string;
  idempotencyKey: string;
  leaseEpoch: number;
  nowMs: number;
  reason: "already_pending" | "already_completed";
  db: D1Database;
}): Promise<void> => {
  if (input.duplicateAttemptId === input.correlatedAttemptId) {
    return;
  }

  await markDispatchAttemptStatus({
    attemptId: input.duplicateAttemptId,
    db: input.db,
    errorCode: `dispatch.attempt.${input.reason}`,
    errorMessage: `dispatch attempt was correlated to ${input.correlatedAttemptId}`,
    nowMs: input.nowMs,
    status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
  });

  if (input.reason === "already_completed") {
    return;
  }

  const correlatedAttemptWrite = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_attempts
        SET
          status = ?,
          daemon_session_id = COALESCE(?, daemon_session_id),
          connection_generation = COALESCE(?, connection_generation),
          lease_epoch = COALESCE(?, lease_epoch),
          started_at_ms = COALESCE(started_at_ms, ?),
          finished_at_ms = NULL,
          error_code = NULL,
          error_message = NULL
        WHERE attempt_id = ?
      `
    )
    .bind(
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
      input.daemonSessionId,
      input.connectionGeneration,
      input.leaseEpoch,
      input.nowMs,
      input.correlatedAttemptId
    )
    .run();
  if (!didWriteRows(correlatedAttemptWrite)) {
    throw new Error(
      `correlated dispatch attempt not found: ${input.correlatedAttemptId}`
    );
  }

  const ledgerWrite = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_ledger
        SET status = ?, last_attempt_at_ms = ?, latest_attempt_id = ?
        WHERE idempotency_key = ?
          AND latest_attempt_id = ?
      `
    )
    .bind(
      OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      input.nowMs,
      input.correlatedAttemptId,
      input.idempotencyKey,
      input.duplicateAttemptId
    )
    .run();
  if (!didWriteRows(ledgerWrite)) {
    throw new Error(
      `dispatch ledger duplicate correlation failed: ${input.idempotencyKey}`
    );
  }
};

const markDispatchAttemptStatus = async (input: {
  attemptId: string | null;
  connectionGeneration?: number | null;
  daemonSessionId?: string | null;
  db: D1Database;
  errorCode?: string | null;
  errorMessage?: string | null;
  leaseEpoch?: number | null;
  nowMs: number;
  status: OpenMeldDaemonDispatchAttemptState;
  targetProfileId?: string | null;
  taskId?: string | null;
}): Promise<void> => {
  if (!input.attemptId) {
    return;
  }

  const finishedAtMs = isTerminalDispatchAttemptState(input.status)
    ? input.nowMs
    : null;
  const startedAtMs = isActiveDispatchAttemptState(input.status)
    ? input.nowMs
    : null;

  await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_dispatch_attempts
        SET
          status = ?,
          daemon_session_id = COALESCE(?, daemon_session_id),
          connection_generation = COALESCE(?, connection_generation),
          lease_epoch = COALESCE(?, lease_epoch),
          task_id = COALESCE(?, task_id),
          target_profile_id = COALESCE(?, target_profile_id),
          started_at_ms = COALESCE(?, started_at_ms),
          finished_at_ms = COALESCE(finished_at_ms, ?),
          error_code = ?,
          error_message = ?
        WHERE attempt_id = ?
      `
    )
    .bind(
      input.status,
      input.daemonSessionId ?? null,
      input.connectionGeneration ?? null,
      input.leaseEpoch ?? null,
      normalizeString(input.taskId),
      normalizeString(input.targetProfileId),
      startedAtMs,
      finishedAtMs,
      input.errorCode ?? null,
      sanitizeDispatchErrorSummary(input.errorMessage),
      input.attemptId
    )
    .run();
};

export const writeDispatchDlq = async (input: {
  db: D1Database;
  message: OpenMeldDaemonDispatchQueueMessage;
  errorCode: string;
  errorMessage: string | null;
  nowMs: number;
}): Promise<void> => {
  await input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_dlq (
          dispatch_id,
          idempotency_key,
          source_event_id,
          target_profile_id,
          error_code,
          error_message,
          failed_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      input.message.dispatchId,
      input.message.idempotencyKey,
      input.message.sourceEventId,
      input.message.targetProfileId,
      input.errorCode,
      sanitizeDispatchErrorSummary(input.errorMessage),
      input.nowMs
    )
    .run();
};

export const writeInvalidDispatchPayloadDlq = async (input: {
  db: D1Database;
  body: unknown;
  issues: unknown;
  nowMs: number;
}): Promise<void> => {
  const normalized = normalizeInvalidPayloadAuditFields(
    input.body,
    input.nowMs
  );
  await input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_dlq (
          dispatch_id,
          idempotency_key,
          source_event_id,
          target_profile_id,
          error_code,
          error_message,
          failed_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      normalized.dispatchId,
      normalized.idempotencyKey,
      normalized.sourceEventId,
      normalized.targetProfileId,
      "schema.invalid.queue_payload",
      JSON.stringify({ issues: input.issues }),
      input.nowMs
    )
    .run();
};

const normalizeInvalidPayloadAuditFields = (body: unknown, nowMs: number) => {
  const bodyObject = body && typeof body === "object" ? body : {};
  const dispatchId = normalizeString(
    (bodyObject as { dispatchId?: unknown }).dispatchId
  );
  const idempotencyKey = normalizeString(
    (bodyObject as { idempotencyKey?: unknown }).idempotencyKey
  );
  const sourceEventId = normalizeString(
    (bodyObject as { sourceEventId?: unknown }).sourceEventId
  );
  const targetProfileId = normalizeString(
    (bodyObject as { targetProfileId?: unknown }).targetProfileId
  );
  const auditSuffix = `${nowMs}:${crypto.randomUUID()}`;

  return {
    dispatchId: dispatchId ?? `invalid-dispatch:${auditSuffix}`,
    idempotencyKey: idempotencyKey ?? `invalid-key:${auditSuffix}`,
    sourceEventId: sourceEventId ?? "unknown-source-event",
    targetProfileId: targetProfileId ?? "unknown-target-profile",
  };
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeDispatchOwnerEvidence = (
  owner: OpenMeldDaemonDispatchQueueMessage["dispatchOwner"]
): {
  id: string | null;
  kind: "owner_account" | null;
} => {
  const kind = normalizeString(owner?.kind);
  const id = normalizeString(owner?.id);
  return kind === "owner_account" && id
    ? {
        id,
        kind,
      }
    : {
        id: null,
        kind: null,
      };
};

// Cap for W-CA-CAP1 (Center Agent dispatch history tool). This is a browse
// surface for one recent failure or in-flight Wake, not a general dispatch
// export, so N stays small and bounded regardless of caller-supplied limit.
export const CENTER_AGENT_DISPATCH_HISTORY_MAX_LIMIT = 20;

export type DispatchHistoryLatestAttempt = {
  attemptId: string;
  attemptNo: number;
  createdAtMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAtMs: number | null;
  startedAtMs: number | null;
  status: OpenMeldDaemonDispatchAttemptState;
};

export type DispatchHistoryEntry = {
  attemptCount: number;
  dispatchId: string;
  firstSeenAtMs: number;
  lastAttemptAtMs: number;
  latestAttempt: DispatchHistoryLatestAttempt | null;
  status: OpenMeldDaemonDispatchState;
  targetProfileId: string;
};

type DispatchHistoryRow = {
  attemptCount?: unknown;
  attemptCreatedAtMs?: unknown;
  attemptErrorCode?: unknown;
  attemptErrorMessage?: unknown;
  attemptFinishedAtMs?: unknown;
  attemptId?: unknown;
  attemptNo?: unknown;
  attemptStartedAtMs?: unknown;
  attemptStatus?: unknown;
  dispatchId?: unknown;
  firstSeenAtMs?: unknown;
  lastAttemptAtMs?: unknown;
  status?: unknown;
  targetProfileId?: unknown;
};

const toDispatchHistoryEntry = (
  row: DispatchHistoryRow
): DispatchHistoryEntry | null => {
  const dispatchId = normalizeString(row.dispatchId);
  const targetProfileId = normalizeString(row.targetProfileId);
  const status = toOpenMeldDaemonDispatchState(row.status);
  if (!(dispatchId && targetProfileId && status)) {
    return null;
  }

  const attemptId = normalizeString(row.attemptId);
  const attemptStatus = toOpenMeldDaemonDispatchAttemptState(row.attemptStatus);
  const latestAttempt: DispatchHistoryLatestAttempt | null =
    attemptId && attemptStatus
      ? {
          attemptId,
          attemptNo: Math.max(1, Number(row.attemptNo ?? 1)),
          createdAtMs: Math.max(0, Number(row.attemptCreatedAtMs ?? 0)),
          errorCode: normalizeString(row.attemptErrorCode),
          errorMessage: sanitizeDispatchErrorSummary(
            normalizeString(row.attemptErrorMessage)
          ),
          finishedAtMs: parseOptionalInteger(row.attemptFinishedAtMs),
          startedAtMs: parseOptionalInteger(row.attemptStartedAtMs),
          status: attemptStatus,
        }
      : null;

  return {
    attemptCount: Math.max(0, Number(row.attemptCount ?? 0)),
    dispatchId,
    firstSeenAtMs: Math.max(0, Number(row.firstSeenAtMs ?? 0)),
    lastAttemptAtMs: Math.max(0, Number(row.lastAttemptAtMs ?? 0)),
    latestAttempt,
    status,
    targetProfileId,
  };
};

// Read model for the Center Agent dispatch history tool (W-CA-CAP1). Joins
// the ledger's aggregate per-dispatch state (including the in-flight
// "dispatching" status) with its latest attempt row (including the
// in-flight "waiting_result" attempt status and the attempt's errorCode /
// errorMessage) so the Center Agent can tell "still running" apart from
// "already failed" and cite the real vendor error instead of guessing from
// Space-visible text alone. Read-only: this does not decide, retry, or
// finalize dispatch execution (developing/architecture/data-and-observability.md
// Dispatch Ledger Boundary).
export const listRecentDispatchLedgerEntriesForSpace = async (input: {
  db: D1Database;
  dispatchId?: string | null;
  limit: number;
  spaceId: string;
  targetProfileId?: string | null;
}): Promise<DispatchHistoryEntry[]> => {
  const spaceId = input.spaceId;
  const targetProfileId = normalizeString(input.targetProfileId);
  const dispatchId = normalizeString(input.dispatchId);
  const limit = Math.max(
    1,
    Math.min(CENTER_AGENT_DISPATCH_HISTORY_MAX_LIMIT, Math.trunc(input.limit))
  );

  const whereClauses = ["ledger.space_id = ?"];
  const params: unknown[] = [spaceId];
  if (targetProfileId) {
    whereClauses.push("ledger.target_profile_id = ?");
    params.push(targetProfileId);
  }
  if (dispatchId) {
    whereClauses.push("ledger.dispatch_id = ?");
    params.push(dispatchId);
  }
  params.push(limit);

  const result = await input.db
    .prepare(
      `
        SELECT
          ledger.dispatch_id AS dispatchId,
          ledger.target_profile_id AS targetProfileId,
          ledger.status AS status,
          ledger.first_seen_at_ms AS firstSeenAtMs,
          ledger.last_attempt_at_ms AS lastAttemptAtMs,
          ledger.attempt_count AS attemptCount,
          attempts.attempt_id AS attemptId,
          attempts.attempt_no AS attemptNo,
          attempts.status AS attemptStatus,
          attempts.error_code AS attemptErrorCode,
          attempts.error_message AS attemptErrorMessage,
          attempts.created_at_ms AS attemptCreatedAtMs,
          attempts.started_at_ms AS attemptStartedAtMs,
          attempts.finished_at_ms AS attemptFinishedAtMs
        FROM openMeldDaemon_dispatch_ledger AS ledger
        LEFT JOIN openMeldDaemon_dispatch_attempts AS attempts
          ON attempts.attempt_id = ledger.latest_attempt_id
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY ledger.last_attempt_at_ms DESC
        LIMIT ?
      `
    )
    .bind(...params)
    .all<DispatchHistoryRow>();

  const rows = Array.isArray(result.results) ? result.results : [];
  return rows
    .map((row) => toDispatchHistoryEntry(row))
    .filter((entry): entry is DispatchHistoryEntry => entry !== null);
};
