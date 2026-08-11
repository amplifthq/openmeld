import type { ExecutionRecoveryDestination } from "@openmeld/schemas/types";
import type { RemoteAgentNativeDeliveryRecord } from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";

export function resolveExecutionRecoveryDestination(input: {
  delivery: RemoteAgentNativeDeliveryRecord | null;
  fallbackSpaceId: string;
  fallbackThreadId: string | null;
}): ExecutionRecoveryDestination {
  const delivery = input.delivery;
  if (!delivery) {
    return {
      spaceId: input.fallbackSpaceId,
      surface: "space",
      threadId: input.fallbackThreadId,
    };
  }
  if (delivery.spaceId !== input.fallbackSpaceId) {
    throw new Error("execution_recovery.destination_space_mismatch");
  }
  if (delivery.conversationKind === "space") {
    return {
      spaceId: delivery.spaceId,
      surface: "space",
      threadId: delivery.threadContext?.threadId ?? input.fallbackThreadId,
    };
  }
  if (delivery.conversationKind === "slack") {
    if (!(delivery.slackChannelId && delivery.slackThreadTs)) {
      throw new Error("execution_recovery.destination_incomplete");
    }
    return {
      conversationId: delivery.slackChannelId,
      messageId: delivery.slackThreadTs,
      spaceId: delivery.spaceId,
      surface: "slack",
    };
  }
  const locator = delivery.messageChannelLocator;
  if (
    !locator ||
    (locator.provider !== "lark" && locator.provider !== "feishu")
  ) {
    throw new Error("execution_recovery.destination_incomplete");
  }
  return {
    conversationId: locator.chatId,
    messageId: locator.rootMessageId,
    spaceId: delivery.spaceId,
    surface: "lark",
  };
}

export function assertExecutionRecoveryDestinationMatchesDelivery(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  destination: ExecutionRecoveryDestination;
}): void {
  const frozen = resolveExecutionRecoveryDestination({
    delivery: input.delivery,
    fallbackSpaceId: input.delivery.spaceId,
    fallbackThreadId: input.delivery.threadContext?.threadId ?? null,
  });
  if (JSON.stringify(frozen) !== JSON.stringify(input.destination)) {
    throw new Error("execution_recovery.destination_mismatch");
  }
}
