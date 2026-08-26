import type {
  ExecutionRecoveryDestination,
  SpaceMessageAttachment,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { createConfiguredMessageChannelProviderRegistry } from "../../remote-agent/application/message-channel-provider-runtime";
import { resolveMessageChannelPublicationTarget } from "../../remote-agent/application/message-channel-publication-target";
import {
  buildRemoteAgentFinalPublicationMetadata,
  REMOTE_AGENT_FINAL_PUBLICATION_METADATA_DELIVERY_ID_KEY,
  REMOTE_AGENT_FINAL_PUBLICATION_METADATA_EVENT_TYPE,
} from "../../remote-agent/application/native-delivery-final-publication-identity";
import { buildMessageChannelProviderPublicationUuid } from "../../remote-agent/application/provider-publication-uuid";
import { resolveSlackBotToken } from "../../remote-agent/application/slack-bot-token";
import {
  findSlackThreadMessageByMetadata,
  postSlackThreadMessage,
} from "../../remote-agent/application/slack-client";
import { buildSlackFinalReplyPresentation } from "../../remote-agent/application/slack-final-reply-presentation";
import type { RemoteAgentNativeDeliveryRecord } from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { assertExecutionRecoveryDestinationMatchesDelivery } from "./execution-recovery-destination";

const SLACK_RECOVERY_METADATA_EVENT_TYPE = "openmeld_execution_recovery";
type ConnectorRecoveryDestination = Exclude<
  ExecutionRecoveryDestination,
  { surface: "space" }
>;

export async function publishExecutionRecoveryToOrigin(input: {
  attachments?: readonly SpaceMessageAttachment[];
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  destination: ExecutionRecoveryDestination;
  env: CoreBindings;
  operationId: string;
  reuseOriginalFinalPublicationIdentity?: boolean;
  text: string;
}): Promise<{
  publicationId: string;
  status: "already_published" | "published";
}> {
  assertExecutionRecoveryDestinationMatchesDelivery(input);
  if (input.destination.surface === "space") {
    throw new Error("execution_recovery.space_publication_owned_by_space");
  }
  if (input.destination.surface === "slack") {
    return await publishSlackExecutionRecovery({
      ...input,
      destination: input.destination as ConnectorRecoveryDestination & {
        surface: "slack";
      },
    });
  }
  return await publishLarkExecutionRecovery({
    ...input,
    destination: input.destination as ConnectorRecoveryDestination & {
      surface: "lark";
    },
  });
}

export async function findExecutionRecoveryPublicationAtOrigin(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  destination: ExecutionRecoveryDestination;
  env: CoreBindings;
  operationId: string;
  reuseOriginalFinalPublicationIdentity?: boolean;
}): Promise<string | null> {
  assertExecutionRecoveryDestinationMatchesDelivery(input);
  if (input.destination.surface !== "slack") {
    return null;
  }
  const slackTeamId = input.delivery.slackTeamId?.trim();
  if (!(slackTeamId && input.destination.messageId)) {
    throw new Error("execution_recovery.destination_incomplete");
  }
  const botToken = await resolveSlackBotToken({
    cryptoKey: input.env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: input.db,
    fallbackBotToken: input.env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId,
  });
  const existing = await findSlackThreadMessageByMetadata({
    botToken,
    channelId: input.destination.conversationId,
    eventPayloadKey: input.reuseOriginalFinalPublicationIdentity
      ? REMOTE_AGENT_FINAL_PUBLICATION_METADATA_DELIVERY_ID_KEY
      : "operation_id",
    eventPayloadValue: input.reuseOriginalFinalPublicationIdentity
      ? input.delivery.deliveryId
      : input.operationId,
    eventType: input.reuseOriginalFinalPublicationIdentity
      ? REMOTE_AGENT_FINAL_PUBLICATION_METADATA_EVENT_TYPE
      : SLACK_RECOVERY_METADATA_EVENT_TYPE,
    threadTs: input.destination.messageId,
  });
  return existing?.id ?? null;
}

async function publishSlackExecutionRecovery(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  destination: ConnectorRecoveryDestination & { surface: "slack" };
  env: CoreBindings;
  operationId: string;
  reuseOriginalFinalPublicationIdentity?: boolean;
  text: string;
}): Promise<{
  publicationId: string;
  status: "already_published" | "published";
}> {
  const slackTeamId = input.delivery.slackTeamId?.trim();
  if (!slackTeamId) {
    throw new Error("execution_recovery.destination_incomplete");
  }
  if (!input.destination.messageId) {
    throw new Error("execution_recovery.destination_incomplete");
  }
  const botToken = await resolveSlackBotToken({
    cryptoKey: input.env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: input.db,
    fallbackBotToken: input.env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId,
  });
  const metadata = input.reuseOriginalFinalPublicationIdentity
    ? buildRemoteAgentFinalPublicationMetadata(input.delivery)
    : {
        eventPayload: {
          operation_id: input.operationId,
        },
        eventType: SLACK_RECOVERY_METADATA_EVENT_TYPE,
      };
  const existing = await findSlackThreadMessageByMetadata({
    botToken,
    channelId: input.destination.conversationId,
    eventPayloadKey: input.reuseOriginalFinalPublicationIdentity
      ? REMOTE_AGENT_FINAL_PUBLICATION_METADATA_DELIVERY_ID_KEY
      : "operation_id",
    eventPayloadValue: input.reuseOriginalFinalPublicationIdentity
      ? input.delivery.deliveryId
      : input.operationId,
    eventType: input.reuseOriginalFinalPublicationIdentity
      ? REMOTE_AGENT_FINAL_PUBLICATION_METADATA_EVENT_TYPE
      : SLACK_RECOVERY_METADATA_EVENT_TYPE,
    threadTs: input.destination.messageId,
  });
  if (existing) {
    return {
      publicationId: existing.id,
      status: "already_published",
    };
  }
  const published = await postSlackThreadMessage({
    ...(await buildSlackFinalReplyPresentation(input.text)),
    botToken,
    channelId: input.destination.conversationId,
    metadata,
    threadTs: input.destination.messageId,
  });
  return { publicationId: published.id, status: "published" };
}

async function publishLarkExecutionRecovery(input: {
  attachments?: readonly SpaceMessageAttachment[];
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  destination: ConnectorRecoveryDestination & { surface: "lark" };
  env: CoreBindings;
  operationId: string;
  reuseOriginalFinalPublicationIdentity?: boolean;
  text: string;
}): Promise<{
  publicationId: string;
  status: "already_published" | "published";
}> {
  const registry = createConfiguredMessageChannelProviderRegistry({
    db: input.db,
    env: input.env,
  });
  if (!registry) {
    throw new Error("execution_recovery.message_channel_adapter_unavailable");
  }
  const resolution = await resolveMessageChannelPublicationTarget({
    db: input.db,
    delivery: input.delivery,
    registry,
  });
  if (resolution.status !== "ready") {
    throw new Error(resolution.reasonCode);
  }
  const publication = await resolution.target.adapter.publishReply({
    attachments: input.attachments ?? [],
    connection: resolution.target.connection,
    locator: resolution.target.locator,
    providerPublicationIdempotencyKey:
      input.reuseOriginalFinalPublicationIdentity
        ? requireOriginalProviderPublicationIdempotencyKey(input.delivery)
        : await buildMessageChannelProviderPublicationUuid({
            deliveryId: `execution-recovery:${input.operationId}`,
            provider: resolution.target.locator.provider,
            publicationKind: "final",
          }),
    text: input.text,
  });
  if (publication.status === "published") {
    return {
      publicationId: publication.resultId,
      status: "published",
    };
  }
  if (publication.status === "outcome_unknown") {
    throw new Error(publication.reasonCode);
  }
  throw new Error(publication.reasonCode);
}

function requireOriginalProviderPublicationIdempotencyKey(
  delivery: RemoteAgentNativeDeliveryRecord
): string {
  if (!delivery.providerPublicationIdempotencyKey) {
    throw new Error("execution_recovery.destination_incomplete");
  }
  return delivery.providerPublicationIdempotencyKey;
}
