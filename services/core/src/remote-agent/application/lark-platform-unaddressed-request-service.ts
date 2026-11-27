import { normalizedMessageChannelMessageEventSchema } from "@openmeld/schemas";
import type { NormalizedMessageChannelEvent } from "@openmeld/schemas/types";
import type { RemoteAgentLarkPlatformChannelConnectionRecord } from "../infrastructure/postgresql/lark-platform-channel-connection-repo";
import type {
  AdmittedMessageChannelEventSource,
  RemoteAgentMessageChannelEventProcessingResult,
} from "./message-channel-event-service";
import type {
  UnaddressedChannelBatchRequest,
  UnaddressedChannelBatchSubmission,
} from "./message-channel-unaddressed-intake-service";

type MessageEvent = Extract<NormalizedMessageChannelEvent, { kind: "message" }>;

/**
 * Starts the turn for a routed Lark or Feishu batch through the same path an
 * @mention takes. The request keeps the trigger message's own identifiers, so
 * the reply lands in that message's thread.
 */
export async function submitUnaddressedLarkPlatformRequest(
  request: UnaddressedChannelBatchRequest,
  dependencies: {
    readConnection(input: {
      connectionId: string;
      db: UnaddressedChannelBatchRequest["db"];
    }): Promise<RemoteAgentLarkPlatformChannelConnectionRecord | null>;
    submitAdmittedEvent(input: {
      event: MessageEvent;
      source: AdmittedMessageChannelEventSource;
    }): Promise<RemoteAgentMessageChannelEventProcessingResult>;
  }
): Promise<UnaddressedChannelBatchSubmission> {
  const { trigger } = request;
  if (trigger.provider !== "lark" && trigger.provider !== "feishu") {
    throw new Error("Not a Lark-platform unaddressed batch");
  }
  const connection = await dependencies.readConnection({
    connectionId: trigger.connectionId,
    db: request.db,
  });
  if (
    !connection ||
    connection.provider !== trigger.provider ||
    connection.status !== "connected"
  ) {
    return {
      reasonCode: "message_channel.unaddressed_connection_unavailable",
      status: "not_submitted",
    };
  }
  const submission = await dependencies.submitAdmittedEvent({
    event: normalizedMessageChannelMessageEventSchema.parse({
      kind: "message",
      locator: {
        appId: connection.appId,
        chatId: trigger.conversationKey,
        connectionId: connection.connectionId,
        provider: trigger.provider,
        rootMessageId: trigger.rootMessageId,
        tenantKey: connection.tenantKey,
        threadId: trigger.threadId,
      },
      mention: "group_message",
      messageId: trigger.messageId,
      resources: trigger.resources,
      senderId: trigger.senderId,
      ...(trigger.senderTenantKey
        ? { senderTenantKey: trigger.senderTenantKey }
        : {}),
      sentAtMs: trigger.sentAtMs,
      text: request.text,
    }),
    source: {
      addressed: false,
      connectionGeneration: trigger.connectionGeneration ?? undefined,
      connectionId: connection.connectionId,
      provider: trigger.provider,
      providerEventId: request.requestEventId,
      sourceProofText: trigger.text,
    },
  });
  if (submission.status === "failed") {
    // A delivery was created and no worker accepted it. The archive keeps
    // the link to it without calling the request routed.
    return {
      deliveryId: submission.deliveryId,
      reasonCode: "message_channel.unaddressed_request_failed",
      status: "not_submitted",
    };
  }
  if ("deliveryId" in submission) {
    // `outcome_unknown` stays linked to its delivery, which holds the
    // uncertainty and is reconciled by native delivery.
    return { deliveryId: submission.deliveryId, status: "submitted" };
  }
  return {
    reasonCode:
      "reasonCode" in submission
        ? submission.reasonCode
        : `message_channel.unaddressed_request_${submission.status}`,
    status: "not_submitted",
  };
}
