import type { CoreBindings } from "../../lib/bindings";
import {
  claimRemoteAgentAcceptedDeliveryProbeSchedule,
  markRemoteAgentAcceptedDeliveryProbeScheduled,
  markRemoteAgentNativeDeliveryAck,
  type RemoteAgentNativeDeliveryRecord,
  releaseRemoteAgentAcceptedDeliveryProbeSchedule,
} from "../infrastructure/d1/native-delivery-ledger-repo";
import {
  enqueueRemoteAgentAcceptedDeliveryProbe,
  REMOTE_AGENT_ACCEPTED_DELIVERY_PROBE_DELAY_SECONDS,
} from "./native-delivery-admission-watchdog";

export async function markRemoteAgentNativeDeliveryAckWithProbe(input: {
  accepted: boolean;
  db: D1Database;
  env: CoreBindings;
  idempotencyKey: string;
  nowMs: number;
  submissionId: string;
  workerRequestId: string | null;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  const delivery = await markRemoteAgentNativeDeliveryAck({
    accepted: input.accepted,
    db: input.db,
    idempotencyKey: input.idempotencyKey,
    nowMs: input.nowMs,
    submissionId: input.submissionId,
    workerRequestId: input.workerRequestId,
  });
  return (
    await ensureRemoteAgentAcceptedDeliveryProbe({
      db: input.db,
      delivery,
      env: input.env,
      nowMs: input.nowMs,
    })
  ).delivery;
}

export async function ensureRemoteAgentAcceptedDeliveryProbe(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  env: CoreBindings;
  nowMs: number;
}): Promise<{
  delivery: RemoteAgentNativeDeliveryRecord;
  enqueued: boolean;
}> {
  if (
    input.delivery.acceptedProbeNextDueAtMs !== null &&
    input.delivery.acceptedProbeNextDueAtMs > input.nowMs
  ) {
    return { delivery: input.delivery, enqueued: false };
  }
  if (
    input.delivery.status !== "accepted" &&
    input.delivery.status !== "retry_observed"
  ) {
    return { delivery: input.delivery, enqueued: false };
  }
  const submissionId = input.delivery.submissionId;
  if (!submissionId) {
    throw new Error(
      "Remote Agent accepted delivery is missing its submission identity"
    );
  }

  const nextDueAtMs =
    input.nowMs + REMOTE_AGENT_ACCEPTED_DELIVERY_PROBE_DELAY_SECONDS * 1000;
  const claim = await claimRemoteAgentAcceptedDeliveryProbeSchedule({
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
    leaseDueAtMs: nextDueAtMs,
    nowMs: input.nowMs,
    submissionId,
  });
  if (!claim.claimed) {
    return {
      delivery: claim.delivery ?? input.delivery,
      enqueued: false,
    };
  }

  try {
    const enqueued = await enqueueRemoteAgentAcceptedDeliveryProbe({
      ack: { submissionId },
      env: input.env,
      nowMs: input.nowMs,
      target: {
        dispatchId: input.delivery.dispatchId,
        idempotencyKey: input.delivery.idempotencyKey,
        organizationId: input.delivery.organizationId,
        profileId: input.delivery.profileId,
        spaceId: input.delivery.spaceId,
      },
    });
    if (!enqueued) {
      throw new Error("Remote Agent accepted-delivery probe was not enqueued");
    }
  } catch (error) {
    await releaseRemoteAgentAcceptedDeliveryProbeSchedule({
      db: input.db,
      idempotencyKey: input.delivery.idempotencyKey,
      leaseDueAtMs: nextDueAtMs,
      nowMs: input.nowMs,
      submissionId,
    });
    throw error;
  }

  const delivery = await markRemoteAgentAcceptedDeliveryProbeScheduled({
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
    nextDueAtMs,
    nowMs: input.nowMs,
    submissionId,
  });
  if (!delivery || delivery.acceptedProbeNextDueAtMs !== nextDueAtMs) {
    throw new Error(
      "Remote Agent accepted-delivery probe marker was not persisted"
    );
  }
  return { delivery, enqueued: true };
}
