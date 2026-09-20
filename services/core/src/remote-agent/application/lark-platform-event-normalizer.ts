import {
  messageChannelCardControlSchema,
  messageChannelIngressEnvelopeSchema,
  normalizedMessageChannelEventSchema,
} from "@openmeld/schemas";
import type {
  MessageChannelIngressEnvelope,
  MessageChannelResourceDescriptor,
  NormalizedMessageChannelEvent,
} from "@openmeld/schemas/types";
import type { RemoteAgentLarkPlatformChannelConnectionRecord } from "../infrastructure/d1/lark-platform-channel-connection-repo";
import { readLarkPlatformPostContent } from "./lark-platform-post-content";

type JsonObject = Record<string, unknown>;

const NONNEGATIVE_INTEGER_PATTERN = /^\d+$/u;

export type LarkPlatformEventNormalizationResult =
  | {
      envelope: MessageChannelIngressEnvelope;
      status: "enqueue";
    }
  | {
      reasonCode: string;
      status: "ignored" | "rejected";
    };
type NormalizedProviderEventResult =
  | { event: NormalizedMessageChannelEvent; status: "normalized" }
  | { reasonCode: string; status: "ignored" | "rejected" };

export function normalizeLarkPlatformEvent(input: {
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  gatewayRequestId: string;
  payload: JsonObject;
  receivedAtMs: number;
  surface: "callbacks" | "events";
}): LarkPlatformEventNormalizationResult {
  const header = readObject(input.payload, "header");
  const event = readObject(input.payload, "event");
  if (!(header && event)) {
    return {
      reasonCode: "message_channel.webhook_event_invalid",
      status: "rejected",
    };
  }
  const providerEventId = readString(header, "event_id");
  if (!providerEventId) {
    return {
      reasonCode: "message_channel.webhook_event_id_missing",
      status: "rejected",
    };
  }
  const eventType = readString(header, "event_type");
  const normalizedEvent = normalizeProviderEvent({
    connection: input.connection,
    event,
    eventType,
    header,
    providerEventId,
    surface: input.surface,
  });
  if (normalizedEvent.status !== "normalized") {
    return normalizedEvent;
  }
  return {
    envelope: messageChannelIngressEnvelopeSchema.parse({
      connectionId: input.connection.connectionId,
      event: normalizedEvent.event,
      gatewayRequestId: input.gatewayRequestId,
      kind: "remote_agent_message_channel_event",
      provider: input.connection.provider,
      providerEventId,
      receivedAtMs: input.receivedAtMs,
      v: 1,
    }),
    status: "enqueue",
  };
}

function normalizeProviderEvent(input: {
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  event: JsonObject;
  eventType: string | null;
  header: JsonObject;
  providerEventId: string;
  surface: "callbacks" | "events";
}): NormalizedProviderEventResult {
  if (
    input.eventType === "im.message.receive_v1" &&
    input.surface === "events"
  ) {
    return normalizeMessageEvent({
      connection: input.connection,
      event: input.event,
    });
  }
  if (
    input.eventType === "card.action.trigger" &&
    input.surface === "callbacks"
  ) {
    return normalizeCardActionEvent(input);
  }
  return {
    reasonCode: "message_channel.webhook_event_unsupported",
    status: "ignored",
  };
}

function normalizeCardActionEvent(input: {
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  event: JsonObject;
  header: JsonObject;
  providerEventId: string;
}): NormalizedProviderEventResult {
  const action = readObject(input.event, "action");
  const context = readObject(input.event, "context");
  const operator = readObject(input.event, "operator");
  // Ordinary buttons identify their callback through value; name is a form-only field.
  const actionName =
    readString(action, "name") ??
    (readNestedString(action, "value", "openmeld_action") === "control"
      ? "openmeld.center_agent.control"
      : null);
  if (
    actionName !== "openmeld.center_agent.submit" &&
    actionName !== "openmeld.center_agent.control"
  ) {
    return {
      reasonCode: "message_channel.webhook_card_action_unsupported",
      status: "ignored",
    };
  }
  let actionValue = readNestedString(action, "value", "prompt");
  if (actionName === "openmeld.center_agent.control") {
    const { openmeld_action: _routing, ...value } =
      (action ? readObject(action, "value") : null) ?? {};
    const control = messageChannelCardControlSchema.safeParse(
      value?.action === "reply"
        ? {
            ...value,
            text: readNestedString(action, "form_value", "follow_up"),
          }
        : value
    );
    actionValue = control.success ? JSON.stringify(control.data) : null;
  }
  const chatId = readString(context, "open_chat_id");
  const messageId = readString(context, "open_message_id");
  const occurredAtMs = readTimestampMs(input.header, "create_time");
  const senderId =
    readString(operator, "open_id") ??
    readNestedString(operator, "operator_id", "open_id");
  if (
    !(actionValue && chatId && messageId && occurredAtMs !== null && senderId)
  ) {
    return {
      reasonCode: "message_channel.webhook_card_action_invalid",
      status: "rejected",
    };
  }
  const normalized = normalizedMessageChannelEventSchema.safeParse({
    actionId: input.providerEventId,
    actionName,
    actionValue,
    kind: "card_action",
    locator: {
      appId: input.connection.appId,
      chatId,
      connectionId: input.connection.connectionId,
      provider: input.connection.provider,
      rootMessageId: messageId,
      tenantKey: input.connection.tenantKey,
      threadId: null,
    },
    occurredAtMs,
    senderId,
  });
  return normalized.success
    ? { event: normalized.data, status: "normalized" }
    : {
        reasonCode: "message_channel.webhook_card_action_invalid",
        status: "rejected",
      };
}

function normalizeMessageEvent(input: {
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  event: JsonObject;
}): NormalizedProviderEventResult {
  const sender = readObject(input.event, "sender");
  const senderId = readNestedString(sender, "sender_id", "open_id");
  const message = readObject(input.event, "message");
  if (!(senderId && message)) {
    return {
      reasonCode: "message_channel.webhook_message_identity_invalid",
      status: "rejected",
    };
  }
  const messageType = readString(message, "message_type");
  const content = parseJsonObject(readString(message, "content"));
  const normalizedContent = normalizeMessageContent({
    content,
    messageType,
  });
  if (normalizedContent.status !== "normalized") {
    return normalizedContent;
  }
  const messageId = readString(message, "message_id");
  const chatId = readString(message, "chat_id");
  const sentAtMs = readTimestampMs(message, "create_time");
  if (!(messageId && chatId && sentAtMs !== null)) {
    return {
      reasonCode: "message_channel.webhook_message_locator_invalid",
      status: "rejected",
    };
  }
  const botMentionKeys = readBotMentionKeys({
    botOpenId: input.connection.botOpenId,
    mentions: message.mentions,
  });
  const text = stripBotMentions(normalizedContent.text, botMentionKeys);
  if (!text) {
    return {
      reasonCode: "message_channel.webhook_message_text_missing",
      status: "ignored",
    };
  }
  const chatType = readString(message, "chat_type");
  let mention: "direct_message" | "group_mention" | "group_message";
  if (chatType === "p2p") {
    mention = "direct_message";
  } else if (botMentionKeys.length > 0) {
    mention = "group_mention";
  } else {
    mention = "group_message";
  }
  const rootMessageId = readString(message, "root_id") ?? messageId;
  const event = normalizedMessageChannelEventSchema.safeParse({
    kind: "message",
    locator: {
      appId: input.connection.appId,
      chatId,
      connectionId: input.connection.connectionId,
      provider: input.connection.provider,
      rootMessageId,
      tenantKey: input.connection.tenantKey,
      threadId: readString(message, "thread_id"),
    },
    mention,
    messageId,
    resources: normalizedContent.resources,
    senderId,
    senderTenantKey: readString(sender, "tenant_key"),
    sentAtMs,
    text,
  });
  return event.success
    ? { event: event.data, status: "normalized" }
    : {
        reasonCode: "message_channel.webhook_message_invalid",
        status: "rejected",
      };
}

function normalizeMessageContent(input: {
  content: JsonObject | null;
  messageType: string | null;
}):
  | {
      resources: MessageChannelResourceDescriptor[];
      status: "normalized";
      text: string;
    }
  | { reasonCode: string; status: "ignored" | "rejected" } {
  if (input.messageType === "text") {
    const text = readString(input.content, "text");
    return text
      ? { resources: [], status: "normalized", text }
      : {
          reasonCode: "message_channel.webhook_message_text_missing",
          status: "ignored",
        };
  }
  if (input.messageType === "post") {
    const post = readLarkPlatformPostContent(input.content);
    return post
      ? { ...post, status: "normalized" }
      : {
          reasonCode: "message_channel.webhook_post_content_invalid",
          status: "rejected",
        };
  }
  const resourceType = resolveMessageResourceType(input.messageType);
  if (!resourceType) {
    return {
      reasonCode: "message_channel.webhook_message_type_unsupported",
      status: "ignored",
    };
  }
  const fileKey =
    resourceType === "image"
      ? readString(input.content, "image_key")
      : readString(input.content, "file_key");
  if (!fileKey) {
    return {
      reasonCode: "message_channel.webhook_message_resource_invalid",
      status: "rejected",
    };
  }
  const fileName = readString(input.content, "file_name");
  return {
    resources: [
      {
        fileKey,
        fileName,
        mimeType: null,
        sizeBytes: null,
        type: resourceType,
      },
    ],
    status: "normalized",
    text: buildResourceMessageText({ fileName, resourceType }),
  };
}

function resolveMessageResourceType(
  messageType: string | null
): "audio" | "file" | "image" | "sticker" | "video" | null {
  if (messageType === "image") {
    return "image";
  }
  if (messageType === "file") {
    return "file";
  }
  if (messageType === "audio") {
    return "audio";
  }
  if (messageType === "media") {
    return "video";
  }
  if (messageType === "sticker") {
    return "sticker";
  }
  return null;
}

function buildResourceMessageText(input: {
  fileName: string | null;
  resourceType: "audio" | "file" | "image" | "sticker" | "video";
}): string {
  let label: string = input.resourceType;
  if (input.resourceType === "audio") {
    label = "audio file";
  } else if (input.resourceType === "file" && input.fileName) {
    label = `the file "${input.fileName}"`;
  }
  return `Please review the attached ${label}.`;
}

function readBotMentionKeys(input: {
  botOpenId: string | null;
  mentions: unknown;
}): string[] {
  if (!(input.botOpenId && Array.isArray(input.mentions))) {
    return [];
  }
  const keys: string[] = [];
  for (const mention of input.mentions) {
    if (!isJsonObject(mention)) {
      continue;
    }
    const mentionedOpenId = readNestedString(mention, "id", "open_id");
    const key = readString(mention, "key");
    if (mentionedOpenId === input.botOpenId && key) {
      keys.push(key);
    }
  }
  return [...new Set(keys)];
}

function stripBotMentions(
  text: string,
  mentionKeys: readonly string[]
): string {
  let result = text;
  for (const key of mentionKeys) {
    result = result.replaceAll(key, " ");
  }
  return result.trim();
}

function parseJsonObject(value: string | null): JsonObject | null {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readTimestampMs(object: JsonObject, key: string): number | null {
  const value = readString(object, key);
  if (!(value && NONNEGATIVE_INTEGER_PATTERN.test(value))) {
    return null;
  }
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null;
}

function readObject(object: JsonObject, key: string): JsonObject | null {
  const value = object[key];
  return isJsonObject(value) ? value : null;
}

function readNestedString(
  object: JsonObject | null,
  parentKey: string,
  key: string
): string | null {
  const parent = object ? readObject(object, parentKey) : null;
  return parent ? readString(parent, key) : null;
}

function readString(object: JsonObject | null, key: string): string | null {
  const value = object?.[key];
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
