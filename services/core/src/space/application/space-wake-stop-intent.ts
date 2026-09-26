import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  isHostedAgentControllerRef,
} from "@openmeld/schemas";
import type {
  RemoteAgentWorkerCancellationRequest,
  RemoteAgentWorkerCancellationResponse,
  SpaceWakeStopIntentQuery,
  SpaceWakeStopIntentResponse,
} from "@openmeld/schemas/types";
import {
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByExecution,
} from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  createDispatchOutboxRecord,
  insertDispatchOutboxRecord,
  readDispatchOutboxRecordByDispatchId,
} from "../infrastructure/outbox/dispatch-outbox-repo";

/** Old Core versions retired handed-off payloads before execution ended.
 * Absence is not permission by itself: require the exact persisted native
 * delivery, then re-read Space after the asynchronous boundary. Unknown or
 * mismatched requests remain not_found; neither absence nor this read proves
 * execution stopped. Final publication still meets Stop atomically in Space. */
export async function readNativeSpaceWakeStopIntent(input: {
  db: D1Database | null | undefined;
  query: SpaceWakeStopIntentQuery;
  sql: SqlStorage;
}): Promise<SpaceWakeStopIntentResponse> {
  const current = readSpaceWakeStopIntent(input.sql, input.query);
  if (
    current.status !== "not_found" ||
    hasStoredOutboxFence(input.sql, input.query.dispatchId) ||
    !input.db
  ) {
    return current;
  }
  const delivery = await readRemoteAgentNativeDeliveryByExecution({
    db: input.db,
    dispatchId: input.query.dispatchId,
    profileId: input.query.targetProfileId,
    spaceId: input.query.spaceId,
  });
  if (
    !delivery ||
    delivery.conversationKind !== "space" ||
    delivery.routineRunId
  ) {
    return { status: "not_found" };
  }
  const latest = readSpaceWakeStopIntent(input.sql, input.query);
  if (
    latest.status !== "not_found" ||
    hasStoredOutboxFence(input.sql, input.query.dispatchId)
  ) {
    return latest;
  }
  return {
    status:
      delivery.failureCode === "remote_agent.execution_cancelled" ||
      delivery.failureCode === "runtime_coordinator.pre_agent_stop_requested"
        ? "requested"
        : "not_requested",
  };
}

function hasStoredOutboxFence(sql: SqlStorage, dispatchId: string): boolean {
  // A malformed or mismatched stored fence is not the same as normal conveyor
  // retirement. Never authorize through it by falling back to another store.
  return (
    sql
      .exec(
        "SELECT 1 FROM openMeldDaemon_outbox WHERE dispatch_id = ? LIMIT 1",
        dispatchId
      )
      .toArray().length > 0
  );
}

/** Reconstitute only a cancelled control record for a retired legacy payload.
 * This record cannot enter dispatch recovery or replay the diagnostic text.
 * Execution identity is still taken from the native ledger, never this seed. */
export function retainRetiredNativeWakeStopFence(
  sql: SqlStorage,
  delivery: RemoteAgentNativeDeliveryRecord
) {
  const request =
    delivery.workerSubmitRequest ?? delivery.executionRecoverySubmitRequest;
  const agentControllerRef =
    request?.v === 4 && request.conversationIdentity?.kind === "personal_agent"
      ? HOSTED_REMOTE_AGENT_CONTROLLER_REF
      : HOSTED_CENTER_AGENT_CONTROLLER_REF;
  const seed = createDispatchOutboxRecord({
    bindingState: "bound",
    bindingEnabled: true,
    agentControllerRef,
    dispatchPolicy: "mention_only",
    ruleId: "native-stop-fence",
    ruleReason: "retired_native_stop_fence",
    ruleSource: "system",
    sourceSignalSnapshot: {
      text: "Retained Hosted Wake Stop.",
      profileId: delivery.onBehalfOfProfileId,
      profileKind: null,
    },
    senderProfileId: delivery.onBehalfOfProfileId ?? delivery.profileId,
    spaceId: delivery.spaceId,
    organizationId: delivery.organizationId,
    sourceEventId: delivery.triggerMessageId,
    sourceClientMessageId: delivery.sourceClientMessageId,
    targetProfileId: delivery.profileId,
    threadContext: delivery.threadContext,
    nowMs: delivery.createdAtMs,
  });
  const {
    payloadJson: _payload,
    status: _status,
    createdAtMs: _created,
    handedOffAtMs: _handoff,
    ...message
  } = seed;
  const retained = {
    ...message,
    dispatchId: delivery.dispatchId,
    taskId: delivery.dispatchId,
    dispatchChainId: delivery.dispatchId,
    idempotencyKey: delivery.idempotencyKey,
  };
  insertDispatchOutboxRecord(sql, {
    ...retained,
    payloadJson: JSON.stringify(retained),
    status: "cancelled",
    createdAtMs: delivery.createdAtMs,
    handedOffAtMs: delivery.acceptedAtMs,
  });
  return readDispatchOutboxRecordByDispatchId(sql, delivery.dispatchId);
}

/** Every saved native Stop lacking a final claim has a recovery owner, even
 * when admission evidence is NULL or has not arrived yet. The cursor is only
 * scan scheduling; it never decides execution or cancellation truth. */
export function listPendingNativeWakeStops(
  sql: SqlStorage,
  limit: number,
  afterDispatchId = ""
) {
  return sql
    .exec<{ dispatch_id: string }>(
      `
    SELECT dispatch_id FROM openMeldDaemon_outbox AS outbox
    WHERE status = 'cancelled' AND dispatch_id > ?
      AND json_extract(payload_json, '$.controllerSnapshot.agentControllerRef') IN (?, ?)
      AND NOT EXISTS (SELECT 1 FROM space_final_reply_claims AS claim
        WHERE claim.dispatch_id = outbox.dispatch_id AND claim.profile_id = outbox.target_profile_id)
    ORDER BY dispatch_id LIMIT ?`,
      afterDispatchId,
      HOSTED_CENTER_AGENT_CONTROLLER_REF,
      HOSTED_REMOTE_AGENT_CONTROLLER_REF,
      limit
    )
    .toArray()
    .flatMap(({ dispatch_id }) => {
      const record = readDispatchOutboxRecordByDispatchId(sql, dispatch_id);
      return record &&
        isHostedAgentControllerRef(record.controllerSnapshot.agentControllerRef)
        ? [record]
        : [];
    });
}

export function isMatchingNativeStopTerminal(
  response: RemoteAgentWorkerCancellationResponse,
  target: Omit<RemoteAgentWorkerCancellationRequest, "v" | "reason">
): boolean {
  if (
    response.status !== "already_cancelled" &&
    response.status !== "not_stoppable"
  ) {
    return false;
  }
  const execution = response.execution;
  const terminal =
    response.status === "already_cancelled"
      ? execution.status === "aborted"
      : execution.status === "completed" || execution.status === "failed";
  return (
    terminal &&
    execution.organizationId === target.organizationId &&
    execution.spaceId === target.spaceId &&
    execution.submissionId === target.submissionId &&
    execution.idempotencyKey === target.idempotencyKey
  );
}

/** Projection of Space's existing durable Stop intent, not execution settlement. */
export function readSpaceWakeStopIntent(
  sql: SqlStorage,
  query: SpaceWakeStopIntentQuery
): SpaceWakeStopIntentResponse {
  const record = readDispatchOutboxRecordByDispatchId(sql, query.dispatchId);
  if (
    !record ||
    record.spaceId !== query.spaceId ||
    record.targetProfileId !== query.targetProfileId
  ) {
    return { status: "not_found" };
  }
  return {
    status: record.outboxStatus === "cancelled" ? "requested" : "not_requested",
  };
}

/** Admission and Stop meet in the existing Space outbox. This synchronous
 * evidence records possible exposure to execution, never execution outcome. */
export function authorizeSpaceNativeWakeAdmission(
  sql: SqlStorage,
  query: SpaceWakeStopIntentQuery,
  nowMs: number
): SpaceWakeStopIntentResponse {
  const intent = readSpaceWakeStopIntent(sql, query);
  if (intent.status !== "not_requested") {
    return intent;
  }
  sql.exec(
    `UPDATE openMeldDaemon_outbox
     SET native_admission_started_at_ms = COALESCE(NULLIF(native_admission_started_at_ms, 0), ?)
     WHERE dispatch_id = ? AND space_id = ? AND target_profile_id = ?`,
    Math.max(1, nowMs),
    query.dispatchId,
    query.spaceId,
    query.targetProfileId
  );
  return intent;
}

export function isSpaceNativeWakeUnexposed(
  sql: SqlStorage,
  query: SpaceWakeStopIntentQuery
): boolean {
  const row = sql
    .exec<{ native_admission_started_at_ms: number | null }>(
      `SELECT native_admission_started_at_ms FROM openMeldDaemon_outbox
     WHERE dispatch_id = ? AND space_id = ? AND target_profile_id = ?`,
      query.dispatchId,
      query.spaceId,
      query.targetProfileId
    )
    .toArray()[0];
  return row?.native_admission_started_at_ms === 0;
}
