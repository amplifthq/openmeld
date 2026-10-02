import {
  remoteAgentCoreAdmissionCallbackSchema,
  remoteAgentCoreCallbackResponseSchema,
} from "@openmeld/schemas";
import { type CoreBindings, wakeEvidenceDb } from "../../lib/bindings";
import { readRemoteAgentNativeDeliveryByIdempotencyKey } from "../infrastructure/d1/native-delivery-ledger-repo";
import { markRemoteAgentNativeDeliveryAckWithProbe } from "./native-delivery-accepted-probe";
import { isNativeDeliveryExecutingStatus } from "./native-delivery-execution-status";
import { resolveRemoteAgentNativeDeliveryIdentityMismatch } from "./native-delivery-identity";
import { isRemoteAgentRequestStopRequested } from "./space-wake-stop-intent";

/** Native preparation can run before submitConversationTurn returns to Core.
 * Persist the same ACK before any preparation needs its Core projection. */
export async function acknowledgeRemoteAgentAdmission(
  env: CoreBindings,
  value: unknown
) {
  const body = remoteAgentCoreAdmissionCallbackSchema.parse(value);
  const db = wakeEvidenceDb(env);
  if (!db) {
    throw new Error("remote_agent.execution_store_unavailable");
  }
  const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db,
    idempotencyKey: body.idempotencyKey,
  });
  const request =
    delivery?.executionRecoverySubmitRequest ?? delivery?.workerSubmitRequest;
  if (
    !(delivery && request) ||
    resolveRemoteAgentNativeDeliveryIdentityMismatch(delivery, body) ||
    body.submissionId !== (delivery.submissionId ?? delivery.dispatchId) ||
    request.idempotencyKey !== body.idempotencyKey ||
    request.dispatchId !== body.dispatchId ||
    (delivery.status !== "submitted" &&
      !isNativeDeliveryExecutingStatus(delivery.status))
  ) {
    return remoteAgentCoreCallbackResponseSchema.parse({
      status: "rejected",
      reasonCode: "remote_agent.admission_identity_not_active",
    });
  }
  if (await isRemoteAgentRequestStopRequested(env, request)) {
    return remoteAgentCoreCallbackResponseSchema.parse({
      status: "rejected",
      reasonCode: "remote_agent.execution_cancelled",
    });
  }
  const acknowledged = await markRemoteAgentNativeDeliveryAckWithProbe({
    accepted: true,
    db,
    env,
    idempotencyKey: body.idempotencyKey,
    nowMs: Date.now(),
    submissionId: body.submissionId,
    workerRequestId: body.submissionId,
  });
  // A concurrent terminal transition wins the conditional ACK write.
  return remoteAgentCoreCallbackResponseSchema.parse(
    isNativeDeliveryExecutingStatus(acknowledged.status) &&
      acknowledged.submissionId === body.submissionId
      ? { status: "accepted" }
      : {
          status: "rejected",
          reasonCode: "remote_agent.admission_identity_not_active",
        }
  );
}
