import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { remoteAgentStreamDeltaCallbackResponseSchema } from "@openmeld/schemas";
import type { RemoteAgentStreamDeltaCallbackResponse } from "@openmeld/schemas/types";
import {
  claimRemoteAgentMessageChannelProviderCardUpdate,
  markRemoteAgentMessageChannelProviderCardUpdateFailed,
  markRemoteAgentMessageChannelProviderCardUpdateOutcomeUnknown,
  markRemoteAgentMessageChannelProviderCardUpdatePublished,
} from "../infrastructure/postgresql/message-channel-provider-progress-repo";
import {
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "../infrastructure/postgresql/native-delivery-ledger-repo";
import type { MessageChannelProviderRegistry } from "./message-channel-adapters";
import {
  projectMessageChannelCardRevision,
  revisePreviousMessageChannelCards,
} from "./message-channel-card-revision";
import { advanceRemoteAgentMessageChannelCardRollover } from "./message-channel-card-rollover-service";
import { resolveMessageChannelPublicationTarget } from "./message-channel-publication-target";
import { buildMessageChannelProviderPublicationUuid } from "./provider-publication-uuid";

const MESSAGE_CHANNEL_CARD_UPDATE_CLAIM_LEASE_MS = 30_000;
export async function publishRemoteAgentMessageChannelCardStreamDelta(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  evidenceDb: PostgresDatabase;
  nowMs: number;
  providerDb: PostgresDatabase;
  registry: MessageChannelProviderRegistry;
  sequence: number;
  textSnapshot: string;
}): Promise<RemoteAgentStreamDeltaCallbackResponse> {
  const locator = input.delivery.messageChannelLocator;
  if (
    !locator ||
    (locator.provider !== "lark" && locator.provider !== "feishu")
  ) {
    throw new Error(
      "Message Channel stream delivery has no Lark-platform locator"
    );
  }
  if (!canPublishCardStream(input.delivery.providerProgressState)) {
    return acceptSuppressedSequence(input.sequence);
  }
  if (input.delivery.finalPublicationState !== null) {
    return remoteAgentStreamDeltaCallbackResponseSchema.parse({
      lastSequence: input.sequence,
      status: "duplicate_accepted",
    });
  }
  let delivery = input.delivery;
  if (
    delivery.providerProgressState === "sent" &&
    (delivery.providerProgressSequence ?? 0) >= input.sequence
  ) {
    return resolveUnclaimedCardUpdate(input.sequence, delivery);
  }
  let rolledOver = false;
  while (requiresCardRollover(delivery, input.textSnapshot)) {
    const target = await resolveMessageChannelPublicationTarget({
      db: input.providerDb,
      delivery,
      registry: input.registry,
    });
    if (target.status !== "ready") {
      return retryCardStream(delivery, target.reasonCode);
    }
    const rollover = await advanceRemoteAgentMessageChannelCardRollover({
      db: input.evidenceDb,
      delivery,
      nowMs: input.nowMs,
      sequence: input.sequence,
      target: target.target,
      textSnapshot: input.textSnapshot,
    });
    if (rollover.status !== "rolled_over") {
      return retryCardStream(
        rollover.delivery,
        rollover.reasonCode,
        rollover.retryAfterMs
      );
    }
    delivery = rollover.delivery;
    rolledOver = true;
  }
  if ((delivery.providerProgressSequence ?? 0) >= input.sequence) {
    return remoteAgentStreamDeltaCallbackResponseSchema.parse({
      lastSequence: input.sequence,
      status: rolledOver ? "accepted" : "duplicate_accepted",
    });
  }
  const revision = projectMessageChannelCardRevision(
    delivery,
    input.textSnapshot
  );
  const activeSegment = revision.active;
  if (activeSegment.tail) {
    throw new Error(
      "Message Channel stream still exceeds its card after rollover"
    );
  }
  const providerPublicationIdempotencyKey =
    await buildMessageChannelProviderPublicationUuid({
      deliveryId: delivery.deliveryId,
      provider: locator.provider,
      publicationKind: buildMessageChannelStreamPublicationKind(
        delivery,
        input.sequence
      ),
    });
  const claim = await claimRemoteAgentMessageChannelProviderCardUpdate({
    cardHistory: { ...revision.history, pendingSnapshot: input.textSnapshot },
    claimExpiresAtMs: input.nowMs + MESSAGE_CHANNEL_CARD_UPDATE_CLAIM_LEASE_MS,
    claimId: providerPublicationIdempotencyKey,
    db: input.evidenceDb,
    idempotencyKey: delivery.idempotencyKey,
    nowMs: input.nowMs,
    providerPublicationIdempotencyKey,
    sequence: input.sequence,
  });
  if (claim.status !== "claimed") {
    return resolveUnclaimedCardUpdate(input.sequence, claim.delivery);
  }
  return await publishClaimedCardUpdate({
    ...input,
    claimId: providerPublicationIdempotencyKey,
    claimedDelivery: claim.delivery,
    delivery,
    providerPublicationIdempotencyKey,
    textSnapshot: input.textSnapshot,
  });
}
function buildMessageChannelStreamPublicationKind(
  delivery: RemoteAgentNativeDeliveryRecord,
  sequence: number
): `stream:${number}` | `work-loop:${number}:stream:${number}` {
  const workLoopAttempt =
    delivery.executionRecoverySubmitRequest?.turnEnvelope.workLoopContinuation
      ?.attempt;
  return workLoopAttempt
    ? `work-loop:${workLoopAttempt}:stream:${sequence}`
    : `stream:${sequence}`;
}
async function publishClaimedCardUpdate(input: {
  claimId: string;
  claimedDelivery: RemoteAgentNativeDeliveryRecord;
  delivery: RemoteAgentNativeDeliveryRecord;
  evidenceDb: PostgresDatabase;
  nowMs: number;
  providerDb: PostgresDatabase;
  providerPublicationIdempotencyKey: string;
  registry: MessageChannelProviderRegistry;
  sequence: number;
  textSnapshot: string;
}): Promise<RemoteAgentStreamDeltaCallbackResponse> {
  const cardId = input.claimedDelivery.providerProgressCardId;
  if (!cardId) {
    throw new Error("Message Channel stream claim has no durable card id");
  }
  const target = await resolveMessageChannelPublicationTarget({
    db: input.providerDb,
    delivery: input.claimedDelivery,
    registry: input.registry,
  });
  if (target.status !== "ready") {
    await markRemoteAgentMessageChannelProviderCardUpdateFailed({
      claimId: input.claimId,
      db: input.evidenceDb,
      failureCode: target.reasonCode,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs: input.nowMs,
      providerPublicationIdempotencyKey:
        input.providerPublicationIdempotencyKey,
      sequence: input.sequence,
    });
    return remoteAgentStreamDeltaCallbackResponseSchema.parse({
      lastSequence: input.delivery.providerProgressSequence ?? 0,
      reasonCode: target.reasonCode,
      status: "retryable",
    });
  }
  const revision = projectMessageChannelCardRevision(
    input.claimedDelivery,
    input.claimedDelivery.providerProgressCardHistory?.pendingSnapshot ??
      input.textSnapshot
  );
  const previous = await revisePreviousMessageChannelCards({
    delivery: input.claimedDelivery,
    revision,
    target: target.target,
    sequence: input.sequence,
    providerPublicationIdempotencyKey: input.providerPublicationIdempotencyKey,
  });
  let result = previous.result;
  if (result.status === "published") {
    result = await target.target.adapter.updateWorkingCard({
      cardId,
      connection: target.target.connection,
      locator: target.target.locator,
      providerPublicationIdempotencyKey:
        input.providerPublicationIdempotencyKey,
      sequence: input.sequence,
      text: revision.active.head,
    });
  }
  // Keep provider backoff even when cross-retry recovery must retain the claim.
  const retryAfterMs =
    result.status === "failed" ? result.retryAfterMs : undefined;
  if (previous.revised && result.status === "failed") {
    result = { status: "outcome_unknown", reasonCode: result.reasonCode };
  }
  if (result.status === "published") {
    const published =
      await markRemoteAgentMessageChannelProviderCardUpdatePublished({
        cardHistory: previous.history,
        sourceOffset: revision.sourceOffset,
        claimId: input.claimId,
        db: input.evidenceDb,
        idempotencyKey: input.delivery.idempotencyKey,
        nowMs: input.nowMs,
        providerPublicationIdempotencyKey:
          input.providerPublicationIdempotencyKey,
        sequence: input.sequence,
      });
    if (!published) {
      // Final publication may claim the same card while this provider request
      // is in flight. Its higher sequence owns the complete answer; never
      // reopen progress or misreport a lost final fence as provider failure.
      const current = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: input.evidenceDb,
        idempotencyKey: input.delivery.idempotencyKey,
      });
      if (current && current.finalPublicationState !== null) {
        return resolveUnclaimedCardUpdate(input.sequence, current);
      }
      throw new Error(
        "Message Channel stream publication lost its durable claim"
      );
    }
    return remoteAgentStreamDeltaCallbackResponseSchema.parse({
      lastSequence: input.sequence,
      status: "accepted",
    });
  }
  if (result.status === "outcome_unknown") {
    await markRemoteAgentMessageChannelProviderCardUpdateOutcomeUnknown({
      claimId: input.claimId,
      db: input.evidenceDb,
      failureCode: result.reasonCode,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs: input.nowMs,
      providerPublicationIdempotencyKey:
        input.providerPublicationIdempotencyKey,
      sequence: input.sequence,
    });
  } else {
    await markRemoteAgentMessageChannelProviderCardUpdateFailed({
      claimId: input.claimId,
      db: input.evidenceDb,
      failureCode: result.reasonCode,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs: input.nowMs,
      providerPublicationIdempotencyKey:
        input.providerPublicationIdempotencyKey,
      sequence: input.sequence,
    });
  }
  return remoteAgentStreamDeltaCallbackResponseSchema.parse({
    lastSequence: input.delivery.providerProgressSequence ?? 0,
    reasonCode: result.reasonCode,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    status: "retryable",
  });
}
function resolveUnclaimedCardUpdate(
  sequence: number,
  delivery: RemoteAgentNativeDeliveryRecord | null
): RemoteAgentStreamDeltaCallbackResponse {
  if (
    (delivery?.providerProgressSequence ?? 0) >= sequence ||
    (delivery !== null && delivery.finalPublicationState !== null)
  ) {
    return remoteAgentStreamDeltaCallbackResponseSchema.parse({
      lastSequence: sequence,
      status: "duplicate_accepted",
    });
  }
  return remoteAgentStreamDeltaCallbackResponseSchema.parse({
    lastSequence: delivery?.providerProgressSequence ?? 0,
    reasonCode: "agent_stream.message_channel_card_update_in_progress",
    status: "retryable",
  });
}
function acceptSuppressedSequence(
  sequence: number
): RemoteAgentStreamDeltaCallbackResponse {
  return remoteAgentStreamDeltaCallbackResponseSchema.parse({
    lastSequence: sequence,
    status: "accepted",
  });
}
function requiresCardRollover(
  delivery: RemoteAgentNativeDeliveryRecord,
  textSnapshot: string
): boolean {
  if (
    delivery.providerProgressState === "rollover_finalize_claimed" ||
    delivery.providerProgressState === "rollover_finalized" ||
    delivery.providerProgressState === "rollover_create_claimed" ||
    delivery.providerProgressState === "rollover_created" ||
    delivery.providerProgressState === "rollover_send_claimed" ||
    delivery.providerProgressState === "rollover_send_outcome_unknown"
  ) {
    return true;
  }
  if (delivery.providerProgressState !== "sent") {
    return false;
  }
  return (
    projectMessageChannelCardRevision(delivery, textSnapshot).active.tail
      .length > 0
  );
}
function canPublishCardStream(
  state: RemoteAgentNativeDeliveryRecord["providerProgressState"]
): boolean {
  return (
    state === "sent" ||
    state === "update_claimed" ||
    state === "rollover_finalize_claimed" ||
    state === "rollover_finalized" ||
    state === "rollover_create_claimed" ||
    state === "rollover_created" ||
    state === "rollover_send_claimed" ||
    state === "rollover_send_outcome_unknown"
  );
}
function retryCardStream(
  delivery: RemoteAgentNativeDeliveryRecord,
  reasonCode: string,
  retryAfterMs?: number
): RemoteAgentStreamDeltaCallbackResponse {
  return remoteAgentStreamDeltaCallbackResponseSchema.parse({
    lastSequence: delivery.providerProgressSequence ?? 0,
    reasonCode,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    status: "retryable",
  });
}
