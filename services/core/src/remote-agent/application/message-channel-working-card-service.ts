import type { RemoteAgentLarkPlatformChannelConnectionRecord } from "../infrastructure/d1/lark-platform-channel-connection-repo";
import {
  claimRemoteAgentMessageChannelProviderCardCreation,
  claimRemoteAgentMessageChannelProviderCardSend,
  expireRemoteAgentMessageChannelProviderProgressClaim,
  markRemoteAgentMessageChannelProviderCardCreated,
  markRemoteAgentMessageChannelProviderCardCreationOutcomeUnknown,
  markRemoteAgentMessageChannelProviderCardSendOutcomeUnknown,
  markRemoteAgentMessageChannelProviderCardSent,
  markRemoteAgentMessageChannelProviderCardUnavailable,
} from "../infrastructure/d1/message-channel-provider-progress-repo";
import {
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "../infrastructure/d1/native-delivery-ledger-repo";
import type { MessageChannelProviderRegistry } from "./message-channel-adapters";
import { buildMessageChannelProviderPublicationUuid } from "./provider-publication-uuid";

const MESSAGE_CHANNEL_PROVIDER_PROGRESS_CLAIM_LEASE_MS = 30_000;

export type MessageChannelWorkingCardPreparationResult =
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      status: "ready";
    }
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      reasonCode: string;
      status: "unavailable";
    }
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      reasonCode: string;
      status: "in_progress";
    };

export async function prepareRemoteAgentMessageChannelWorkingCard(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  nowMs: number;
  registry: MessageChannelProviderRegistry;
}): Promise<MessageChannelWorkingCardPreparationResult> {
  await expireRemoteAgentMessageChannelProviderProgressClaim({
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
    nowMs: input.nowMs,
  });
  let delivery = await requireCurrentDelivery(input);
  if (
    delivery.providerProgressState === "create_claimed" ||
    delivery.providerProgressState === "send_claimed"
  ) {
    return {
      delivery,
      reasonCode: "message_channel.card_progress_claim_in_progress",
      status: "in_progress",
    };
  }
  if (delivery.providerProgressState === null) {
    delivery = await createWorkingCard({
      ...input,
      delivery,
    });
  }
  if (delivery.providerProgressState === "created") {
    delivery = await publishWorkingCard({
      ...input,
      delivery,
    });
  }
  if (delivery.providerProgressState === "sent") {
    return { delivery, status: "ready" };
  }
  if (
    delivery.providerProgressState === "create_claimed" ||
    delivery.providerProgressState === "send_claimed"
  ) {
    return {
      delivery,
      reasonCode: "message_channel.card_progress_claim_in_progress",
      status: "in_progress",
    };
  }
  return {
    delivery,
    reasonCode:
      delivery.providerProgressFailureCode ??
      "message_channel.card_progress_unavailable",
    status: "unavailable",
  };
}

async function createWorkingCard(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  nowMs: number;
  registry: MessageChannelProviderRegistry;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  const claimId = crypto.randomUUID();
  const claim = await claimRemoteAgentMessageChannelProviderCardCreation({
    claimExpiresAtMs:
      input.nowMs + MESSAGE_CHANNEL_PROVIDER_PROGRESS_CLAIM_LEASE_MS,
    claimId,
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
    nowMs: input.nowMs,
  });
  if (claim.status !== "claimed") {
    return claim.delivery ?? input.delivery;
  }
  const target = requireWorkingCardTarget({
    connection: input.connection,
    delivery: claim.delivery,
    registry: input.registry,
  });
  const result = await target.adapter.createWorkingCard({
    ...(claim.delivery.onBehalfOfUserId
      ? { stopDeliveryId: claim.delivery.deliveryId }
      : {}),
    connection: target.connection,
    initialText: "Request received. Preparing your conversation…",
    locator: target.locator,
  });
  if (result.status === "created") {
    return await requireTransition(
      markRemoteAgentMessageChannelProviderCardCreated({
        cardId: result.cardId,
        claimId,
        db: input.db,
        idempotencyKey: input.delivery.idempotencyKey,
        nowMs: input.nowMs,
      }),
      "Message Channel card creation result lost its claim"
    );
  }
  if (result.status === "outcome_unknown") {
    return await requireTransition(
      markRemoteAgentMessageChannelProviderCardCreationOutcomeUnknown({
        claimId,
        db: input.db,
        failureCode: result.reasonCode,
        idempotencyKey: input.delivery.idempotencyKey,
        nowMs: input.nowMs,
      }),
      "Message Channel ambiguous card creation lost its claim"
    );
  }
  return await requireTransition(
    markRemoteAgentMessageChannelProviderCardUnavailable({
      claimId,
      db: input.db,
      expectedState: "create_claimed",
      failureCode: result.reasonCode,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs: input.nowMs,
    }),
    "Message Channel failed card creation lost its claim"
  );
}

async function publishWorkingCard(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  nowMs: number;
  registry: MessageChannelProviderRegistry;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  const locator = input.delivery.messageChannelLocator;
  const cardId = input.delivery.providerProgressCardId;
  if (
    !locator ||
    (locator.provider !== "lark" && locator.provider !== "feishu") ||
    !cardId
  ) {
    throw new Error(
      "Message Channel created card has no durable provider identity"
    );
  }
  const claimId = crypto.randomUUID();
  const providerPublicationIdempotencyKey =
    await buildMessageChannelProviderPublicationUuid({
      deliveryId: input.delivery.deliveryId,
      provider: locator.provider,
      publicationKind: "working",
    });
  const claim = await claimRemoteAgentMessageChannelProviderCardSend({
    claimExpiresAtMs:
      input.nowMs + MESSAGE_CHANNEL_PROVIDER_PROGRESS_CLAIM_LEASE_MS,
    claimId,
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
    nowMs: input.nowMs,
    providerPublicationIdempotencyKey,
  });
  if (claim.status !== "claimed") {
    return claim.delivery ?? input.delivery;
  }
  const target = requireWorkingCardTarget({
    connection: input.connection,
    delivery: claim.delivery,
    registry: input.registry,
  });
  const result = await target.adapter.publishWorkingCard({
    cardId,
    connection: target.connection,
    locator: target.locator,
    providerPublicationIdempotencyKey,
  });
  if (result.status === "published") {
    return await requireTransition(
      markRemoteAgentMessageChannelProviderCardSent({
        claimId,
        db: input.db,
        idempotencyKey: input.delivery.idempotencyKey,
        messageId: result.resultId,
        nowMs: input.nowMs,
        providerPublicationIdempotencyKey,
      }),
      "Message Channel card send result lost its claim"
    );
  }
  if (result.status === "outcome_unknown") {
    return await requireTransition(
      markRemoteAgentMessageChannelProviderCardSendOutcomeUnknown({
        claimId,
        db: input.db,
        failureCode: result.reasonCode,
        idempotencyKey: input.delivery.idempotencyKey,
        nowMs: input.nowMs,
      }),
      "Message Channel ambiguous card send lost its claim"
    );
  }
  return await requireTransition(
    markRemoteAgentMessageChannelProviderCardUnavailable({
      claimId,
      db: input.db,
      expectedState: "send_claimed",
      failureCode: result.reasonCode,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs: input.nowMs,
    }),
    "Message Channel failed card send lost its claim"
  );
}

async function requireCurrentDelivery(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  const current = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
  });
  if (!current || current.deliveryId !== input.delivery.deliveryId) {
    throw new Error("Message Channel card progress lost its Native Delivery");
  }
  return current;
}

function requireWorkingCardTarget(input: {
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  delivery: RemoteAgentNativeDeliveryRecord;
  registry: MessageChannelProviderRegistry;
}) {
  const locator = input.delivery.messageChannelLocator;
  if (
    !locator ||
    (locator.provider !== "lark" && locator.provider !== "feishu") ||
    input.connection.status !== "connected" ||
    input.connection.connectionId !== locator.connectionId ||
    input.connection.organizationId !== input.delivery.organizationId ||
    input.connection.provider !== locator.provider ||
    input.connection.appId !== locator.appId ||
    input.connection.tenantKey !== locator.tenantKey
  ) {
    throw new Error(
      "Message Channel working card target does not match its Native Delivery"
    );
  }
  return {
    adapter: input.registry.require(locator.provider),
    connection: input.connection,
    locator,
  };
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
