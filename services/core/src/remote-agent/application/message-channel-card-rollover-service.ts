import {
  claimRemoteAgentMessageChannelProviderCardRolloverCreation,
  claimRemoteAgentMessageChannelProviderCardRolloverFinalize,
  claimRemoteAgentMessageChannelProviderCardRolloverSend,
  expireRemoteAgentMessageChannelProviderProgressClaim,
  markRemoteAgentMessageChannelProviderCardRolloverCreated,
  markRemoteAgentMessageChannelProviderCardRolloverCreationFailed,
  markRemoteAgentMessageChannelProviderCardRolloverFinalizeFailed,
  markRemoteAgentMessageChannelProviderCardRolloverFinalizeOutcomeUnknown,
  markRemoteAgentMessageChannelProviderCardRolloverFinalizePublished,
  markRemoteAgentMessageChannelProviderCardRolloverSendFailed,
  markRemoteAgentMessageChannelProviderCardRolloverSendOutcomeUnknown,
  markRemoteAgentMessageChannelProviderCardRolloverSent,
} from "../infrastructure/d1/message-channel-provider-progress-repo";
import {
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "../infrastructure/d1/native-delivery-ledger-repo";
import {
  hashMessageChannelCardText,
  MESSAGE_CHANNEL_CARD_MAX_SEGMENTS,
  MESSAGE_CHANNEL_CARD_MAX_TOTAL_CHARS,
  splitMessageChannelCardSegment,
} from "./message-channel-card-segmentation";
import type { MessageChannelPublicationTarget } from "./message-channel-publication-target";
import { buildMessageChannelProviderPublicationUuid } from "./provider-publication-uuid";

const MESSAGE_CHANNEL_CARD_ROLLOVER_CLAIM_LEASE_MS = 30_000;

export type MessageChannelCardRolloverResult =
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      status: "rolled_over";
    }
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      reasonCode: string;
      retryAfterMs?: number;
      status: "in_progress" | "outcome_unknown" | "retryable";
    };

type RolloverEvidence = {
  head: string;
  pendingSourceOffset: number;
  pendingTextHash: string;
  sequence: number;
};

export async function advanceRemoteAgentMessageChannelCardRollover(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  finalPublicationClaimId?: string | null;
  nowMs: number;
  sequence: number;
  target: MessageChannelPublicationTarget;
  textSnapshot: string;
}): Promise<MessageChannelCardRolloverResult> {
  assertRolloverInput(input);
  await expireRemoteAgentMessageChannelProviderProgressClaim({
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
    nowMs: input.nowMs,
  });
  let delivery = await requireCurrentDelivery(input);
  assertCurrentFinalPublicationClaim({
    delivery,
    finalPublicationClaimId: input.finalPublicationClaimId,
  });
  if (delivery.providerProgressState === "rollover_send_outcome_unknown") {
    return outcomeUnknown(
      delivery,
      delivery.providerProgressFailureCode ??
        "message_channel.rollover_card_send_outcome_unknown"
    );
  }
  if (input.textSnapshot.length > MESSAGE_CHANNEL_CARD_MAX_TOTAL_CHARS) {
    return retryable(delivery, "message_channel.card_response_budget_exceeded");
  }
  const evidence = await buildRolloverEvidence({
    delivery,
    sequence: input.sequence,
    textSnapshot: input.textSnapshot,
  });
  if (
    delivery.providerProgressRolloverIndex >=
    MESSAGE_CHANNEL_CARD_MAX_SEGMENTS - 1
  ) {
    return retryable(delivery, "message_channel.card_segment_budget_exceeded");
  }
  const evidenceFailure = validatePendingEvidence(delivery, evidence);
  if (evidenceFailure) {
    return outcomeUnknown(delivery, evidenceFailure);
  }
  const rolloverIndex = delivery.providerProgressRolloverIndex + 1;
  const finalizePublicationKey =
    await buildMessageChannelProviderPublicationUuid({
      deliveryId: delivery.deliveryId,
      provider: input.target.locator.provider,
      publicationKind: `rollover:${rolloverIndex}:finalize:${evidence.sequence}`,
    });

  if (delivery.providerProgressState === "sent") {
    const claim =
      await claimRemoteAgentMessageChannelProviderCardRolloverFinalize({
        claimExpiresAtMs:
          input.nowMs + MESSAGE_CHANNEL_CARD_ROLLOVER_CLAIM_LEASE_MS,
        claimId: finalizePublicationKey,
        db: input.db,
        finalPublicationClaimId: input.finalPublicationClaimId,
        idempotencyKey: delivery.idempotencyKey,
        nowMs: input.nowMs,
        pendingSourceOffset: evidence.pendingSourceOffset,
        pendingTextHash: evidence.pendingTextHash,
        providerPublicationIdempotencyKey: finalizePublicationKey,
        sequence: evidence.sequence,
      });
    if (claim.status !== "claimed") {
      return classifyRolloverConflict(claim.delivery, evidence);
    }
    delivery = claim.delivery;
  }

  if (delivery.providerProgressState === "rollover_finalize_claimed") {
    const finalized = await finalizeCurrentCard({
      db: input.db,
      delivery,
      evidence,
      nowMs: input.nowMs,
      providerPublicationIdempotencyKey: finalizePublicationKey,
      target: input.target,
    });
    if (finalized.status !== "published") {
      return finalized;
    }
    delivery = finalized.delivery;
  }

  if (delivery.providerProgressState === "rollover_finalized") {
    const created = await createContinuedCard({
      db: input.db,
      delivery,
      evidence,
      nowMs: input.nowMs,
      rolloverIndex,
      target: input.target,
      textSnapshot: input.textSnapshot,
    });
    if (created.status !== "created") {
      return created;
    }
    delivery = created.delivery;
  }

  if (
    delivery.providerProgressState === "rollover_created" ||
    delivery.providerProgressState === "rollover_send_claimed"
  ) {
    const sent = await sendContinuedCard({
      db: input.db,
      delivery,
      nowMs: input.nowMs,
      rolloverIndex,
      target: input.target,
    });
    if (sent.status !== "published") {
      return sent;
    }
    return { delivery: sent.delivery, status: "rolled_over" };
  }

  return classifyRolloverConflict(delivery, evidence);
}

async function finalizeCurrentCard(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  evidence: RolloverEvidence;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
  target: MessageChannelPublicationTarget;
}): Promise<
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      status: "published";
    }
  | MessageChannelCardRolloverResult
> {
  const cardId = requireText(
    input.delivery.providerProgressCardId,
    "Message Channel rollover has no active card"
  );
  const claimId = requireText(
    input.delivery.providerProgressClaimId,
    "Message Channel rollover has no finalize claim"
  );
  const publication = await input.target.adapter.finalizeWorkingCard({
    cardId,
    connection: input.target.connection,
    locator: input.target.locator,
    providerPublicationIdempotencyKey: input.providerPublicationIdempotencyKey,
    sequence: input.evidence.sequence,
    outcome: "continued",
    text: input.evidence.head,
  });
  const transitionInput = {
    claimId,
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
    nowMs: input.nowMs,
    pendingSourceOffset: input.evidence.pendingSourceOffset,
    pendingTextHash: input.evidence.pendingTextHash,
    providerPublicationIdempotencyKey: input.providerPublicationIdempotencyKey,
    sequence: input.evidence.sequence,
  };
  if (publication.status === "published") {
    return {
      delivery: await requireTransition(
        markRemoteAgentMessageChannelProviderCardRolloverFinalizePublished(
          transitionInput
        ),
        "Message Channel rollover finalize lost its durable claim"
      ),
      status: "published",
    };
  }
  if (publication.status === "outcome_unknown") {
    const delivery = await requireTransition(
      markRemoteAgentMessageChannelProviderCardRolloverFinalizeOutcomeUnknown({
        ...transitionInput,
        failureCode: publication.reasonCode,
      }),
      "Message Channel ambiguous rollover finalize lost its durable claim"
    );
    return retryable(delivery, publication.reasonCode);
  }
  const delivery = await requireTransition(
    markRemoteAgentMessageChannelProviderCardRolloverFinalizeFailed({
      ...transitionInput,
      failureCode: publication.reasonCode,
    }),
    "Message Channel failed rollover finalize lost its durable claim"
  );
  return retryable(delivery, publication.reasonCode, publication.retryAfterMs);
}

async function createContinuedCard(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  evidence: RolloverEvidence;
  nowMs: number;
  rolloverIndex: number;
  target: MessageChannelPublicationTarget;
  textSnapshot: string;
}): Promise<
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      status: "created";
    }
  | MessageChannelCardRolloverResult
> {
  const claimId = await buildMessageChannelProviderPublicationUuid({
    deliveryId: input.delivery.deliveryId,
    provider: input.target.locator.provider,
    publicationKind: `rollover:${input.rolloverIndex}:create`,
  });
  const claim =
    await claimRemoteAgentMessageChannelProviderCardRolloverCreation({
      claimExpiresAtMs:
        input.nowMs + MESSAGE_CHANNEL_CARD_ROLLOVER_CLAIM_LEASE_MS,
      claimId,
      db: input.db,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs: input.nowMs,
    });
  if (claim.status !== "claimed") {
    return classifyRolloverConflict(claim.delivery, input.evidence);
  }
  const initialText = splitMessageChannelCardSegment({
    sourceOffset: input.evidence.pendingSourceOffset,
    text: input.textSnapshot,
  }).head;
  const creation = await input.target.adapter.createWorkingCard({
    connection: input.target.connection,
    initialText,
    locator: input.target.locator,
  });
  if (creation.status === "created") {
    return {
      delivery: await requireTransition(
        markRemoteAgentMessageChannelProviderCardRolloverCreated({
          cardId: creation.cardId,
          claimId,
          db: input.db,
          idempotencyKey: input.delivery.idempotencyKey,
          nowMs: input.nowMs,
        }),
        "Message Channel rollover card creation lost its durable claim"
      ),
      status: "created",
    };
  }
  const delivery = await requireTransition(
    markRemoteAgentMessageChannelProviderCardRolloverCreationFailed({
      claimId,
      db: input.db,
      failureCode: creation.reasonCode,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs: input.nowMs,
    }),
    "Message Channel failed rollover card creation lost its durable claim"
  );
  return retryable(
    delivery,
    creation.reasonCode,
    creation.status === "failed" ? creation.retryAfterMs : undefined
  );
}

async function sendContinuedCard(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  nowMs: number;
  rolloverIndex: number;
  target: MessageChannelPublicationTarget;
}): Promise<
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      status: "published";
    }
  | MessageChannelCardRolloverResult
> {
  const providerPublicationIdempotencyKey =
    await buildMessageChannelProviderPublicationUuid({
      deliveryId: input.delivery.deliveryId,
      provider: input.target.locator.provider,
      publicationKind: `rollover:${input.rolloverIndex}:send`,
    });
  const claim = await claimRemoteAgentMessageChannelProviderCardRolloverSend({
    claimExpiresAtMs:
      input.nowMs + MESSAGE_CHANNEL_CARD_ROLLOVER_CLAIM_LEASE_MS,
    claimId: providerPublicationIdempotencyKey,
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
    nowMs: input.nowMs,
    providerPublicationIdempotencyKey,
  });
  if (claim.status !== "claimed") {
    return classifyRolloverConflict(claim.delivery, null);
  }
  const cardId = requireText(
    claim.delivery.providerProgressPendingCardId,
    "Message Channel rollover send has no pending card"
  );
  const publication = await input.target.adapter.publishWorkingCard({
    cardId,
    connection: input.target.connection,
    locator: input.target.locator,
    providerPublicationIdempotencyKey,
  });
  if (publication.status === "published") {
    return {
      delivery: await requireTransition(
        markRemoteAgentMessageChannelProviderCardRolloverSent({
          claimId: providerPublicationIdempotencyKey,
          db: input.db,
          idempotencyKey: input.delivery.idempotencyKey,
          messageId: publication.resultId,
          nowMs: input.nowMs,
          providerPublicationIdempotencyKey,
        }),
        "Message Channel rollover card send lost its durable claim"
      ),
      status: "published",
    };
  }
  if (publication.status === "outcome_unknown") {
    const delivery = await requireTransition(
      markRemoteAgentMessageChannelProviderCardRolloverSendOutcomeUnknown({
        claimId: providerPublicationIdempotencyKey,
        db: input.db,
        failureCode: publication.reasonCode,
        idempotencyKey: input.delivery.idempotencyKey,
        nowMs: input.nowMs,
        providerPublicationIdempotencyKey,
      }),
      "Message Channel ambiguous rollover card send lost its durable claim"
    );
    return retryable(delivery, publication.reasonCode);
  }
  const delivery = await requireTransition(
    markRemoteAgentMessageChannelProviderCardRolloverSendFailed({
      claimId: providerPublicationIdempotencyKey,
      db: input.db,
      failureCode: publication.reasonCode,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs: input.nowMs,
      providerPublicationIdempotencyKey,
    }),
    "Message Channel failed rollover card send lost its durable claim"
  );
  return retryable(delivery, publication.reasonCode, publication.retryAfterMs);
}

async function buildRolloverEvidence(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  sequence: number;
  textSnapshot: string;
}): Promise<RolloverEvidence> {
  const segment = splitMessageChannelCardSegment({
    sourceOffset: input.delivery.providerProgressSourceOffset,
    text: input.textSnapshot,
  });
  if (!segment.tail) {
    throw new Error("Message Channel rollover requires another card segment");
  }
  const sequence =
    input.delivery.providerProgressPendingSequence ?? input.sequence;
  return {
    head: segment.head,
    pendingSourceOffset: segment.sourceEnd,
    pendingTextHash: await hashMessageChannelCardText(segment.head),
    sequence,
  };
}

function validatePendingEvidence(
  delivery: RemoteAgentNativeDeliveryRecord,
  evidence: RolloverEvidence
): string | null {
  if (delivery.providerProgressState === "sent") {
    return null;
  }
  if (
    delivery.providerProgressPendingSequence !== evidence.sequence ||
    delivery.providerProgressPendingSourceOffset !==
      evidence.pendingSourceOffset ||
    delivery.providerProgressPendingTextHash !== evidence.pendingTextHash
  ) {
    return "message_channel.rollover_source_changed";
  }
  return null;
}

function classifyRolloverConflict(
  delivery: RemoteAgentNativeDeliveryRecord | null,
  evidence: Pick<RolloverEvidence, "pendingSourceOffset"> | null
): MessageChannelCardRolloverResult {
  if (!delivery) {
    throw new Error("Message Channel rollover lost its Native Delivery");
  }
  if (
    delivery.providerProgressState === "sent" &&
    evidence &&
    delivery.providerProgressSourceOffset >= evidence.pendingSourceOffset
  ) {
    return { delivery, status: "rolled_over" };
  }
  if (delivery.providerProgressState === "rollover_send_outcome_unknown") {
    return outcomeUnknown(
      delivery,
      delivery.providerProgressFailureCode ??
        "message_channel.rollover_card_send_outcome_unknown"
    );
  }
  return {
    delivery,
    reasonCode: "message_channel.card_rollover_in_progress",
    status: "in_progress",
  };
}

async function requireCurrentDelivery(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
  });
  if (!delivery || delivery.deliveryId !== input.delivery.deliveryId) {
    throw new Error("Message Channel rollover lost its Native Delivery");
  }
  return delivery;
}

function assertRolloverInput(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  sequence: number;
  target: MessageChannelPublicationTarget;
  textSnapshot: string;
}): void {
  const locator = input.delivery.messageChannelLocator;
  if (
    !locator ||
    (locator.provider !== "lark" && locator.provider !== "feishu") ||
    locator.provider !== input.target.locator.provider ||
    locator.connectionId !== input.target.connection.connectionId ||
    locator.connectionId !== input.target.locator.connectionId ||
    input.delivery.organizationId !== input.target.connection.organizationId ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence <= 0 ||
    !input.textSnapshot
  ) {
    throw new Error(
      "Message Channel rollover does not match its frozen provider target"
    );
  }
}

function assertCurrentFinalPublicationClaim(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  finalPublicationClaimId?: string | null;
}): void {
  const finalPublicationClaimId = input.finalPublicationClaimId?.trim() || null;
  if (
    finalPublicationClaimId !== null &&
    (input.delivery.finalPublicationState !== "claimed" ||
      input.delivery.finalPublicationClaimId !== finalPublicationClaimId)
  ) {
    throw new Error(
      "Message Channel rollover does not own the final publication claim"
    );
  }
}

function retryable(
  delivery: RemoteAgentNativeDeliveryRecord,
  reasonCode: string,
  retryAfterMs?: number
): MessageChannelCardRolloverResult {
  return {
    delivery,
    reasonCode,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    status: "retryable",
  };
}

function outcomeUnknown(
  delivery: RemoteAgentNativeDeliveryRecord,
  reasonCode: string
): MessageChannelCardRolloverResult {
  return { delivery, reasonCode, status: "outcome_unknown" };
}

async function requireTransition(
  transition: Promise<RemoteAgentNativeDeliveryRecord | null>,
  errorMessage: string
): Promise<RemoteAgentNativeDeliveryRecord> {
  const delivery = await transition;
  if (!delivery) {
    throw new Error(errorMessage);
  }
  return delivery;
}

function requireText(value: string | null, errorMessage: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(errorMessage);
  }
  return normalized;
}
