import { remoteAgentWorkerCancellationResponseSchema } from "@openmeld/schemas";
import type { RemoteAgentWorkerCancellationResponse } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { buildStoppedLocalAgentStreamTerminal } from "../../runtime-transport/application/local-agent-stream";
import { RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE } from "../../runtime-transport/application/runtime-coordinator-authority";
import {
  claimRemoteAgentNativeDeliveryTerminalFailure,
  markRemoteAgentNativeDeliveryFailure,
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  readRemoteAgentNativeDeliveryBySubmissionId,
} from "../infrastructure/d1/native-delivery-ledger-repo";
import { resolveRemoteAgentNativeDeliveryRuntimeConversationId } from "./remote-agent-conversation-continuity";
import { closeRemoteAgentStreamProjection } from "./stream-delta-service";

export async function requestRemoteAgentNativeDeliveryStop(input: {
  admittedSubmissionId?: string;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  env: CoreBindings;
  nowMs: number;
}): Promise<"not_stoppable" | "stop_requested" | "stopped"> {
  const current =
    (await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: input.db,
      idempotencyKey: input.delivery.idempotencyKey,
    })) ?? input.delivery;
  const submissionId =
    normalizeOptionalText(input.admittedSubmissionId) ??
    normalizeOptionalText(current.submissionId);
  if (!submissionId && current.status === "submitted") {
    return "stop_requested";
  }
  const result = await stopRemoteAgentNativeDeliveryWithOutcome({
    ...input,
    delivery: current,
  });
  if (result.delivery) {
    return "stopped";
  }
  return result.cancellation?.status === "cancellation_requested"
    ? "stop_requested"
    : "not_stoppable";
}

export async function stopRemoteAgentNativeDelivery(input: {
  admittedSubmissionId?: string;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  env: CoreBindings;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  return (await stopRemoteAgentNativeDeliveryWithOutcome(input)).delivery;
}

async function stopRemoteAgentNativeDeliveryWithOutcome(input: {
  admittedSubmissionId?: string;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  env: CoreBindings;
  nowMs: number;
}): Promise<{
  cancellation: RemoteAgentWorkerCancellationResponse | null;
  delivery: RemoteAgentNativeDeliveryRecord | null;
}> {
  let current =
    (await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: input.db,
      idempotencyKey: input.delivery.idempotencyKey,
    })) ?? input.delivery;
  const submissionId =
    normalizeOptionalText(input.admittedSubmissionId) ??
    normalizeOptionalText(current.submissionId);

  if (!submissionId) {
    return { cancellation: null, delivery: null };
  }
  const cancellation = await requestRemoteAgentWorkerCancellation({
    delivery: current,
    env: input.env,
    submissionId,
  });
  if (!isConfirmedRemoteAgentCancellation(cancellation)) {
    return { cancellation, delivery: null };
  }

  if (current.status === "submitted") {
    await markRemoteAgentNativeDeliveryFailure({
      db: input.db,
      failureCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
      idempotencyKey: current.idempotencyKey,
      nowMs: input.nowMs,
      status: "failed",
    });
    current =
      (await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: input.db,
        idempotencyKey: current.idempotencyKey,
      })) ?? current;
  }

  if (
    (current.status === "accepted" || current.status === "retry_observed") &&
    current.submissionId
  ) {
    await claimRemoteAgentNativeDeliveryTerminalFailure({
      db: input.db,
      failureCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
      idempotencyKey: current.idempotencyKey,
      nowMs: input.nowMs,
      submissionId: current.submissionId,
    });
    current =
      (await readRemoteAgentNativeDeliveryBySubmissionId({
        db: input.db,
        submissionId: current.submissionId,
      })) ?? current;
  }

  if (!isStoppedDelivery(current)) {
    return { cancellation, delivery: null };
  }
  await closeRemoteAgentStreamProjection({
    delivery: current,
    env: input.env,
    submissionId,
    terminal: buildStoppedLocalAgentStreamTerminal(
      RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE
    ),
  });
  return { cancellation, delivery: current };
}

export async function requestRemoteAgentWorkerCancellation(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  env: CoreBindings;
  submissionId: string;
  reason?: string;
}): Promise<RemoteAgentWorkerCancellationResponse> {
  const worker = input.env.OPENMELD_REMOTE_AGENT_WORKER;
  if (!worker?.cancelExecution) {
    throw new Error(
      "remote_agent.parent_stop_cancellation_receiver_unavailable"
    );
  }
  const response = remoteAgentWorkerCancellationResponseSchema.parse(
    await worker.cancelExecution({
      ...resolveRemoteAgentCancellationConversationIdentity(input.delivery),
      idempotencyKey: input.delivery.idempotencyKey,
      organizationId: input.delivery.organizationId,
      reason: input.reason ?? "Parent task was stopped.",
      spaceId: input.delivery.spaceId,
      submissionId: input.submissionId,
      v: 1,
    })
  );
  if (
    response.status === "not_found" ||
    response.status === "identity_mismatch"
  ) {
    throw new Error(
      response.status === "identity_mismatch"
        ? response.reasonCode
        : "remote_agent.parent_stop_execution_not_found"
    );
  }
  console.info("[core.remote_agent.native_delivery.admission_stop_forwarded]", {
    dispatchId: input.delivery.dispatchId,
    status: response.status,
    submissionId: input.submissionId,
    targetProfileId: input.delivery.profileId,
  });
  return response;
}

function isConfirmedRemoteAgentCancellation(
  response: RemoteAgentWorkerCancellationResponse
): boolean {
  return (
    response.status === "already_cancelled" &&
    response.execution.status === "aborted"
  );
}

function resolveRemoteAgentCancellationConversationIdentity(
  delivery: RemoteAgentNativeDeliveryRecord
): { conversationId?: string } {
  const conversationId =
    resolveRemoteAgentNativeDeliveryRuntimeConversationId(delivery);
  return conversationId ? { conversationId } : {};
}

function isStoppedDelivery(delivery: RemoteAgentNativeDeliveryRecord): boolean {
  return (
    delivery.status === "failed" &&
    delivery.failureCode ===
      RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE
  );
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
