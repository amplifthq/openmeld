import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  remoteAgentCoreAdmissionCallbackSchema,
  remoteAgentCoreCallbackResponseSchema,
} from "@openmeld/schemas";
import type { CoreBindings } from "../../lib/bindings";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import {
  markRemoteAgentNativeDeliveryAck,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "../infrastructure/postgresql/native-delivery-ledger-repo";
import { ensureRemoteAgentAcceptedDeliveryProbe } from "./native-delivery-accepted-probe";
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
  const db = getPostgresDatabase(env);
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
  let acknowledged = await markRemoteAgentNativeDeliveryAck({
    accepted: true,
    db,
    idempotencyKey: body.idempotencyKey,
    nowMs: Date.now(),
    submissionId: body.submissionId,
    workerRequestId: body.submissionId,
  });
  try {
    acknowledged = (
      await ensureRemoteAgentAcceptedDeliveryProbe({
        db,
        delivery: acknowledged,
        env,
        nowMs: Date.now(),
      })
    ).delivery;
  } catch (error) {
    // The ACK is durable. Existing probe recovery retries missing/expired
    // schedules; a probe transport failure must not undo admission.
    console.warn(
      "[core.remote_agent.native_delivery.admission_accepted_probe_failed]",
      {
        event: CORE_LOG_EVENTS.coreInternalError,
        deliveryId: acknowledged.deliveryId,
        dispatchId: acknowledged.dispatchId,
        submissionId: acknowledged.submissionId,
        targetProfileId: acknowledged.profileId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    // A terminal transition during the failed scheduling attempt still wins.
    const current = await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db,
      idempotencyKey: body.idempotencyKey,
    });
    if (!current) {
      throw new Error("remote_agent.execution_store_unavailable");
    }
    acknowledged = current;
  }
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
