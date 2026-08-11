import type { MessageChannelConversationLocator } from "@openmeld/schemas/types";
import {
  type RemoteAgentLarkPlatformChannelConnectionRecord,
  readRemoteAgentLarkPlatformChannelConnection,
} from "../infrastructure/d1/lark-platform-channel-connection-repo";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/d1/native-delivery-ledger-repo";
import type {
  MessageChannelProviderAdapter,
  MessageChannelProviderRegistry,
} from "./message-channel-adapters";

type LarkPlatformConversationLocator = Extract<
  MessageChannelConversationLocator,
  { provider: "feishu" | "lark" }
>;

export type MessageChannelPublicationTarget = {
  adapter: MessageChannelProviderAdapter;
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  locator: LarkPlatformConversationLocator;
  providerPublicationIdempotencyKey: string;
};

export async function resolveMessageChannelPublicationTarget(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  registry: MessageChannelProviderRegistry;
}): Promise<
  | {
      status: "ready";
      target: MessageChannelPublicationTarget;
    }
  | {
      reasonCode: string;
      status: "retryable";
    }
> {
  const locator = requireLarkPlatformLocator(input.delivery);
  const providerPublicationIdempotencyKey =
    requireProviderPublicationIdempotencyKey(input.delivery);
  const connection = await readRemoteAgentLarkPlatformChannelConnection({
    connectionId: locator.connectionId,
    db: input.db,
  });
  if (
    !connection ||
    connection.status !== "connected" ||
    connection.organizationId !== input.delivery.organizationId ||
    connection.provider !== locator.provider ||
    connection.appId !== locator.appId ||
    connection.tenantKey !== locator.tenantKey
  ) {
    return {
      reasonCode: "remote_agent.message_channel_connection_unavailable",
      status: "retryable",
    };
  }

  let adapter: MessageChannelProviderAdapter;
  try {
    adapter = input.registry.require(locator.provider);
  } catch {
    return {
      reasonCode: "remote_agent.message_channel_adapter_unavailable",
      status: "retryable",
    };
  }
  return {
    status: "ready",
    target: {
      adapter,
      connection,
      locator,
      providerPublicationIdempotencyKey,
    },
  };
}

function requireLarkPlatformLocator(
  delivery: RemoteAgentNativeDeliveryRecord
): LarkPlatformConversationLocator {
  const locator = delivery.messageChannelLocator;
  if (
    !locator ||
    (locator.provider !== "lark" && locator.provider !== "feishu")
  ) {
    throw new Error(
      "Message Channel Native Delivery has no Lark-platform locator"
    );
  }
  return locator;
}

function requireProviderPublicationIdempotencyKey(
  delivery: RemoteAgentNativeDeliveryRecord
): string {
  const value = delivery.providerPublicationIdempotencyKey?.trim();
  if (!value) {
    throw new Error(
      "Message Channel Native Delivery has no publication idempotency key"
    );
  }
  return value;
}
