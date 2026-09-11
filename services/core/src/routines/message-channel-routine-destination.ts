import { buildMessageChannelConversationId } from "@openmeld/schemas";
import type { MessageChannelConversationLocator } from "@openmeld/schemas/types";
import { readRemoteAgentLarkPlatformChannelConnection } from "../remote-agent/infrastructure/d1/lark-platform-channel-connection-repo";
import { readRemoteAgentNativeDeliveryByDeliveryId } from "../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { createCoreRpcHttpError } from "../rpc/errors";

export async function isMessageChannelRoutineConnectionAvailable(input: {
  db: D1Database;
  organizationId: string;
  locator: MessageChannelConversationLocator | null | undefined;
}): Promise<boolean> {
  const locator = input.locator;
  if (!locator || locator.provider === "slack") {
    return false;
  }
  const connection = await readRemoteAgentLarkPlatformChannelConnection({
    db: input.db,
    connectionId: locator.connectionId,
  });
  return (
    !!connection &&
    connection.status === "connected" &&
    connection.organizationId === input.organizationId &&
    connection.provider === locator.provider &&
    connection.appId === locator.appId &&
    connection.tenantKey === locator.tenantKey
  );
}

export async function requireMessageChannelRoutineConnection(
  input: Parameters<typeof isMessageChannelRoutineConnectionAvailable>[0]
): Promise<void> {
  if (!(await isMessageChannelRoutineConnectionAvailable(input))) {
    throw unavailable();
  }
}

export async function requireMessageChannelRoutineOrigin(input: {
  db: D1Database;
  locator: MessageChannelConversationLocator;
  organizationId: string;
  sourceNativeDeliveryId: string | null;
  userId: string;
}): Promise<void> {
  const delivery = input.sourceNativeDeliveryId
    ? await readRemoteAgentNativeDeliveryByDeliveryId({
        db: input.db,
        deliveryId: input.sourceNativeDeliveryId,
      })
    : null;
  const source = delivery?.messageChannelLocator;
  if (
    !(delivery && source) ||
    delivery.organizationId !== input.organizationId ||
    delivery.onBehalfOfUserId !== input.userId ||
    buildMessageChannelConversationId(source) !==
      buildMessageChannelConversationId(input.locator) ||
    source.provider === "slack" ||
    input.locator.provider === "slack" ||
    source.appId !== input.locator.appId ||
    source.tenantKey !== input.locator.tenantKey ||
    source.rootMessageId !== input.locator.rootMessageId ||
    source.threadId !== input.locator.threadId
  ) {
    throw unavailable();
  }
}

function unavailable(): Error {
  return createCoreRpcHttpError({
    status: 409,
    code: "routine.message_channel_unavailable",
    reason:
      "Choose the current conversation in a connected Feishu or Lark chat.",
  });
}
