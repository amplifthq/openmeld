import type { NavigationAction } from "@openmeld/schemas";
import {
  CHANNEL_CONTEXT_MAX_MESSAGES,
  CHANNEL_CONTEXT_MESSAGE_TEXT_MAX_CHARS,
  CHANNEL_CONTEXT_TOTAL_TEXT_MAX_CHARS,
  channelContextSchema,
} from "@openmeld/schemas";
import type {
  ChannelContext,
  ChannelContextMessage,
  NormalizedMessageChannelEvent,
} from "@openmeld/schemas/types";
import { readLarkPlatformPostContent } from "./lark-platform-post-content";
import type {
  LarkPlatformMessageChannelProvider,
  MessageChannelCardCreationResult,
  MessageChannelCardMutationResult,
  MessageChannelPublicationResult,
  MessageChannelResourceDownloadResult,
} from "./message-channel-adapters";

const LARK_PLATFORM_API_HOSTS: Record<
  LarkPlatformMessageChannelProvider,
  string
> = {
  feishu: "https://open.feishu.cn",
  lark: "https://open.larksuite.com",
};
const PROVIDER_PUBLICATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NONNEGATIVE_INTEGER_PATTERN = /^\d+$/u;
const SERVER_ERROR_REASON_PATTERN = /_http_5\d\d$/u;
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};
const LARK_PLATFORM_STREAMING_CARD_ELEMENT_ID = "stream_md";
export const LARK_PLATFORM_STREAMING_CARD_MAX_CHARS = 30_000;
const LARK_PLATFORM_TENANT_TOKEN_MAX_LIFETIME_SECONDS = 24 * 60 * 60;
const LARK_PLATFORM_TENANT_TOKEN_MAX_SAFETY_WINDOW_MS = 60_000;

type JsonObject = Record<string, unknown>;
type LarkPlatformTenantAccessTokenResult =
  | { status: "ready"; tenantAccessToken: string }
  | {
      result: Extract<MessageChannelPublicationResult, { status: "failed" }>;
      status: "failed";
    };
type LarkPlatformTenantAccessTokenCacheEntry = {
  appSecret: string;
  expiresAtMs: number;
  tenantAccessToken: string;
};
type LarkPlatformTenantAccessTokenPendingEntry = {
  appSecret: string;
  request: Promise<LarkPlatformTenantAccessTokenResult>;
};
type LarkPlatformMessageEvent = Extract<
  NormalizedMessageChannelEvent,
  { kind: "message" }
>;

const larkPlatformTenantAccessTokenCacheByFetch = new WeakMap<
  typeof fetch,
  Map<string, LarkPlatformTenantAccessTokenCacheEntry>
>();
const larkPlatformTenantAccessTokenPendingByFetch = new WeakMap<
  typeof fetch,
  Map<string, LarkPlatformTenantAccessTokenPendingEntry>
>();

export async function readLarkPlatformChannelContext(input: {
  appId: string;
  appSecret: string;
  conversationId: string;
  currentEvent: LarkPlatformMessageEvent;
  fetchImpl?: typeof fetch;
  provider: LarkPlatformMessageChannelProvider;
}): Promise<ChannelContext> {
  const unavailableContext = (status: ChannelContext["sync"]["status"]) =>
    channelContextSchema.parse({
      conversationId: input.conversationId,
      currentMessageId: input.currentEvent.messageId,
      messages: [],
      provider: input.provider,
      sync: { mode: "snapshot", status },
    });
  if (
    input.currentEvent.locator.provider !== input.provider ||
    !input.conversationId.trim()
  ) {
    return unavailableContext("unavailable");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiHost = getLarkPlatformApiHost(input.provider);
  const token = await requestLarkPlatformTenantAccessToken({
    apiHost,
    appId: input.appId,
    appSecret: input.appSecret,
    fetchImpl,
    provider: input.provider,
  });
  if (token.status !== "ready") {
    return unavailableContext("unavailable");
  }

  const url = new URL("/open-apis/im/v1/messages", apiHost);
  url.searchParams.set("container_id_type", "chat");
  url.searchParams.set("container_id", input.currentEvent.locator.chatId);
  url.searchParams.set(
    "end_time",
    String(Math.floor(input.currentEvent.sentAtMs / 1000))
  );
  url.searchParams.set("sort_type", "ByCreateTimeDesc");
  url.searchParams.set("page_size", String(CHANNEL_CONTEXT_MAX_MESSAGES));
  url.searchParams.set("with_sender_name", "true");

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token.tenantAccessToken}` },
      method: "GET",
    });
  } catch {
    return unavailableContext("unavailable");
  }
  const body = await readJsonObject(response);
  const providerCode = readProviderCode(body);
  const failureStatus = resolveChannelContextFailureStatus({
    providerCode,
    response,
  });
  if (failureStatus) {
    return unavailableContext(failureStatus);
  }

  const data = readObject(body, "data");
  const rawItems = readArray(data, "items");
  const messages: ChannelContextMessage[] = [];
  let truncated = readBoolean(data, "has_more") === true;
  for (const rawItem of rawItems) {
    if (!isJsonObject(rawItem)) {
      truncated = true;
      continue;
    }
    if (!belongsToCurrentConversation(rawItem, input.currentEvent)) {
      continue;
    }
    if (readString(rawItem, "message_id") === input.currentEvent.messageId) {
      continue;
    }
    const normalized = normalizeHistoricalMessage(rawItem);
    if (!normalized) {
      truncated = true;
      continue;
    }
    messages.push(normalized);
  }
  const bounded = boundHistoricalMessages(messages);
  truncated ||= bounded.truncated;
  return channelContextSchema.parse({
    conversationId: input.conversationId,
    currentMessageId: input.currentEvent.messageId,
    messages: bounded.messages,
    provider: input.provider,
    sync: {
      mode: "snapshot",
      status: truncated ? "truncated" : "complete",
    },
  });
}

export async function publishLarkPlatformReply(input: {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  messageId: string;
  provider: LarkPlatformMessageChannelProvider;
  providerPublicationIdempotencyKey: string;
  replyInThread: boolean;
  text: string;
}): Promise<MessageChannelPublicationResult> {
  const validationFailure = validatePublicationInput(input);
  if (validationFailure) {
    return validationFailure;
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiHost = getLarkPlatformApiHost(input.provider);
  const token = await requestLarkPlatformTenantAccessToken({
    apiHost,
    appId: input.appId,
    appSecret: input.appSecret,
    fetchImpl,
    provider: input.provider,
  });
  if (token.status !== "ready") {
    return token.result;
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `${apiHost}/open-apis/im/v1/messages/${encodeURIComponent(
        input.messageId.trim()
      )}/reply`,
      {
        body: JSON.stringify({
          content: JSON.stringify({ text: input.text.trim() }),
          msg_type: "text",
          reply_in_thread: input.replyInThread,
          uuid: input.providerPublicationIdempotencyKey.trim(),
        }),
        headers: {
          ...JSON_HEADERS,
          Authorization: `Bearer ${token.tenantAccessToken}`,
        },
        method: "POST",
      }
    );
  } catch {
    return {
      reasonCode: `${input.provider}.message_reply_outcome_unknown`,
      status: "outcome_unknown",
    };
  }

  const body = await readJsonObject(response);
  const providerCode = readProviderCode(body);
  if (!response.ok || (providerCode !== null && providerCode !== 0)) {
    return {
      reasonCode: buildProviderFailureReason({
        operation: "message_reply",
        provider: input.provider,
        providerCode,
        status: response.status,
      }),
      ...buildProviderRetryMetadata(response),
      status: "failed",
    };
  }
  const messageId = readNestedString(body, "data", "message_id");
  if (!messageId) {
    return {
      reasonCode: `${input.provider}.message_reply_result_missing`,
      status: "outcome_unknown",
    };
  }
  return { resultId: messageId, status: "published" };
}

export async function createLarkPlatformStreamingCard(input: {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  initialText: string;
  provider: LarkPlatformMessageChannelProvider;
}): Promise<MessageChannelCardCreationResult> {
  const validationFailure = validateCardCreationInput(input);
  if (validationFailure) {
    return validationFailure;
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiHost = getLarkPlatformApiHost(input.provider);
  const token = await requestLarkPlatformTenantAccessToken({
    apiHost,
    appId: input.appId,
    appSecret: input.appSecret,
    fetchImpl,
    provider: input.provider,
  });
  if (token.status !== "ready") {
    return token.result;
  }

  let response: Response;
  try {
    response = await fetchImpl(`${apiHost}/open-apis/cardkit/v1/cards`, {
      body: JSON.stringify({
        data: JSON.stringify(buildLarkPlatformStreamingCard(input.initialText)),
        type: "card_json",
      }),
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${token.tenantAccessToken}`,
      },
      method: "POST",
    });
  } catch {
    return {
      reasonCode: `${input.provider}.card_create_outcome_unknown`,
      status: "outcome_unknown",
    };
  }
  const body = await readJsonObject(response);
  const providerCode = readProviderCode(body);
  if (!response.ok || (providerCode !== null && providerCode !== 0)) {
    return {
      reasonCode: buildProviderFailureReason({
        operation: "card_create",
        provider: input.provider,
        providerCode,
        status: response.status,
      }),
      ...buildProviderRetryMetadata(response),
      status: "failed",
    };
  }
  const cardId = readNestedString(body, "data", "card_id");
  if (!cardId) {
    return {
      reasonCode: `${input.provider}.card_create_result_missing`,
      status: "outcome_unknown",
    };
  }
  return { cardId, status: "created" };
}

export async function publishLarkPlatformCardReference(input: {
  appId: string;
  appSecret: string;
  cardId: string;
  fetchImpl?: typeof fetch;
  messageId: string;
  provider: LarkPlatformMessageChannelProvider;
  providerPublicationIdempotencyKey: string;
  replyInThread: boolean;
}): Promise<MessageChannelPublicationResult> {
  const validationFailure = validateCardReferenceInput(input);
  if (validationFailure) {
    return validationFailure;
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiHost = getLarkPlatformApiHost(input.provider);
  const token = await requestLarkPlatformTenantAccessToken({
    apiHost,
    appId: input.appId,
    appSecret: input.appSecret,
    fetchImpl,
    provider: input.provider,
  });
  if (token.status !== "ready") {
    return token.result;
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `${apiHost}/open-apis/im/v1/messages/${encodeURIComponent(
        input.messageId.trim()
      )}/reply`,
      {
        body: JSON.stringify({
          content: JSON.stringify({
            data: { card_id: input.cardId.trim() },
            type: "card",
          }),
          msg_type: "interactive",
          reply_in_thread: input.replyInThread,
          uuid: input.providerPublicationIdempotencyKey.trim(),
        }),
        headers: {
          ...JSON_HEADERS,
          Authorization: `Bearer ${token.tenantAccessToken}`,
        },
        method: "POST",
      }
    );
  } catch {
    return {
      reasonCode: `${input.provider}.card_send_outcome_unknown`,
      status: "outcome_unknown",
    };
  }
  const body = await readJsonObject(response);
  const providerCode = readProviderCode(body);
  if (!response.ok || (providerCode !== null && providerCode !== 0)) {
    return {
      reasonCode: buildProviderFailureReason({
        operation: "card_send",
        provider: input.provider,
        providerCode,
        status: response.status,
      }),
      ...buildProviderRetryMetadata(response),
      status: "failed",
    };
  }
  const messageId = readNestedString(body, "data", "message_id");
  if (!messageId) {
    return {
      reasonCode: `${input.provider}.card_send_result_missing`,
      status: "outcome_unknown",
    };
  }
  return { resultId: messageId, status: "published" };
}

export async function updateLarkPlatformStreamingCardContent(input: {
  appId: string;
  appSecret: string;
  cardId: string;
  fetchImpl?: typeof fetch;
  provider: LarkPlatformMessageChannelProvider;
  providerPublicationIdempotencyKey: string;
  sequence: number;
  text: string;
}): Promise<MessageChannelCardMutationResult> {
  const validationFailure = validateCardMutationInput(input);
  if (validationFailure) {
    return validationFailure;
  }
  return await mutateLarkPlatformCard({
    ...input,
    body: {
      content: input.text,
      sequence: input.sequence,
      uuid: input.providerPublicationIdempotencyKey.trim(),
    },
    method: "PUT",
    operation: "card_update",
    path: `/open-apis/cardkit/v1/cards/${encodeURIComponent(
      input.cardId.trim()
    )}/elements/${LARK_PLATFORM_STREAMING_CARD_ELEMENT_ID}/content`,
  });
}

export async function finalizeLarkPlatformStreamingCard(input: {
  appId: string;
  appSecret: string;
  cardId: string;
  fetchImpl?: typeof fetch;
  provider: LarkPlatformMessageChannelProvider;
  providerPublicationIdempotencyKey: string;
  sequence: number;
  outcome: "completed" | "failed" | "stopped" | "continued";
  text: string;
}): Promise<MessageChannelCardMutationResult> {
  const validationFailure = validateCardMutationInput(input);
  if (validationFailure) {
    return validationFailure;
  }
  return await mutateLarkPlatformCard({
    ...input,
    body: {
      card: {
        data: JSON.stringify(
          buildLarkPlatformTerminalCard(input.text, input.outcome)
        ),
        type: "card_json",
      },
      sequence: input.sequence,
      uuid: input.providerPublicationIdempotencyKey.trim(),
    },
    method: "PUT",
    operation: "card_finalize",
    path: `/open-apis/cardkit/v1/cards/${encodeURIComponent(
      input.cardId.trim()
    )}`,
  });
}

export async function downloadLarkPlatformMessageResource(input: {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  fileKey: string;
  maxBytes: number;
  messageId: string;
  provider: LarkPlatformMessageChannelProvider;
  resourceType: "file" | "image";
}): Promise<MessageChannelResourceDownloadResult> {
  if (
    !(
      input.appId.trim() &&
      input.appSecret.trim() &&
      input.fileKey.trim() &&
      input.messageId.trim() &&
      Number.isSafeInteger(input.maxBytes) &&
      input.maxBytes > 0
    )
  ) {
    return {
      reasonCode: `${input.provider}.message_resource_input_invalid`,
      status: "failed",
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiHost = getLarkPlatformApiHost(input.provider);
  const token = await requestLarkPlatformTenantAccessToken({
    apiHost,
    appId: input.appId,
    appSecret: input.appSecret,
    fetchImpl,
    provider: input.provider,
  });
  if (token.status !== "ready") {
    return {
      reasonCode: token.result.reasonCode,
      status: isRetryableProviderReason(token.result.reasonCode)
        ? "retryable"
        : "failed",
    };
  }
  const url = new URL(
    `/open-apis/im/v1/messages/${encodeURIComponent(
      input.messageId.trim()
    )}/resources/${encodeURIComponent(input.fileKey.trim())}`,
    apiHost
  );
  url.searchParams.set("type", input.resourceType);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token.tenantAccessToken}` },
      method: "GET",
    });
  } catch {
    return {
      reasonCode: `${input.provider}.message_resource_transport_failed`,
      status: "retryable",
    };
  }
  if (!response.ok) {
    return {
      reasonCode: `${input.provider}.message_resource_http_${response.status}`,
      status:
        response.status === 429 || response.status >= 500
          ? "retryable"
          : "failed",
    };
  }
  const declaredLength = readContentLength(response);
  if (declaredLength !== null && declaredLength > input.maxBytes) {
    await response.body?.cancel();
    return {
      reasonCode: `${input.provider}.message_resource_too_large`,
      status: "failed",
    };
  }
  const bytes = await readBoundedResponseBody(response, input.maxBytes);
  if (bytes.status !== "read") {
    return {
      reasonCode: `${input.provider}.${bytes.reasonCode}`,
      status: bytes.status,
    };
  }
  return {
    bytes: bytes.bytes,
    contentType: normalizeContentType(response.headers.get("content-type")),
    status: "downloaded",
  };
}

export async function publishLarkPlatformIdentityLinkCard(input: {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  linkUrl: string;
  organizationName?: string;
  provider: LarkPlatformMessageChannelProvider;
  purpose?: "continue_request" | "optional_setup";
  providerPublicationIdempotencyKey: string;
  providerUserId: string;
  requestedAction?: string;
}): Promise<MessageChannelPublicationResult> {
  const validationFailure = validateIdentityLinkCardInput(input);
  if (validationFailure) {
    return validationFailure;
  }
  return await publishLarkPlatformPrivateCard({
    appId: input.appId,
    appSecret: input.appSecret,
    content: buildLarkPlatformIdentityLinkCard({
      linkUrl: input.linkUrl.trim(),
      organizationName: input.organizationName?.trim() || "your organization",
      purpose: input.purpose ?? "continue_request",
      ...(input.requestedAction
        ? { requestedAction: input.requestedAction }
        : {}),
    }),
    fetchImpl: input.fetchImpl,
    operation: "identity_link_card",
    provider: input.provider,
    providerPublicationIdempotencyKey: input.providerPublicationIdempotencyKey,
    providerUserId: input.providerUserId,
  });
}

export async function publishLarkPlatformNavigationActionCard(input: {
  action: NavigationAction;
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  provider: LarkPlatformMessageChannelProvider;
  providerPublicationIdempotencyKey: string;
  providerUserId: string;
  text: string;
}): Promise<MessageChannelPublicationResult> {
  const validationFailure = validateNavigationActionCardInput(input);
  if (validationFailure) {
    return validationFailure;
  }
  return await publishLarkPlatformPrivateCard({
    appId: input.appId,
    appSecret: input.appSecret,
    content: buildLarkPlatformNavigationActionCard({
      action: input.action,
      text: input.text.trim(),
    }),
    fetchImpl: input.fetchImpl,
    operation: "navigation_action_card",
    provider: input.provider,
    providerPublicationIdempotencyKey: input.providerPublicationIdempotencyKey,
    providerUserId: input.providerUserId,
  });
}

async function publishLarkPlatformPrivateCard(input: {
  appId: string;
  appSecret: string;
  content: JsonObject;
  fetchImpl?: typeof fetch;
  operation: "identity_link_card" | "navigation_action_card";
  provider: LarkPlatformMessageChannelProvider;
  providerPublicationIdempotencyKey: string;
  providerUserId: string;
}): Promise<MessageChannelPublicationResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiHost = getLarkPlatformApiHost(input.provider);
  const token = await requestLarkPlatformTenantAccessToken({
    apiHost,
    appId: input.appId,
    appSecret: input.appSecret,
    fetchImpl,
    provider: input.provider,
  });
  if (token.status !== "ready") {
    return token.result;
  }
  const url = new URL("/open-apis/im/v1/messages", apiHost);
  url.searchParams.set("receive_id_type", "open_id");
  let response: Response;
  try {
    response = await fetchImpl(url, {
      body: JSON.stringify({
        content: JSON.stringify(input.content),
        msg_type: "interactive",
        receive_id: input.providerUserId.trim(),
        uuid: input.providerPublicationIdempotencyKey.trim(),
      }),
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${token.tenantAccessToken}`,
      },
      method: "POST",
    });
  } catch {
    return {
      reasonCode: `${input.provider}.${input.operation}_outcome_unknown`,
      status: "outcome_unknown",
    };
  }
  const body = await readJsonObject(response);
  const providerCode = readProviderCode(body);
  if (!response.ok || (providerCode !== null && providerCode !== 0)) {
    return {
      reasonCode: buildProviderFailureReason({
        operation: input.operation,
        provider: input.provider,
        providerCode,
        status: response.status,
      }),
      ...buildProviderRetryMetadata(response),
      status: "failed",
    };
  }
  const messageId = readNestedString(body, "data", "message_id");
  if (!messageId) {
    return {
      reasonCode: `${input.provider}.${input.operation}_result_missing`,
      status: "outcome_unknown",
    };
  }
  return { resultId: messageId, status: "published" };
}

async function mutateLarkPlatformCard(input: {
  appId: string;
  appSecret: string;
  body: JsonObject;
  fetchImpl?: typeof fetch;
  method: "PUT";
  operation: "card_finalize" | "card_update";
  path: string;
  provider: LarkPlatformMessageChannelProvider;
}): Promise<MessageChannelCardMutationResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiHost = getLarkPlatformApiHost(input.provider);
  const token = await requestLarkPlatformTenantAccessToken({
    apiHost,
    appId: input.appId,
    appSecret: input.appSecret,
    fetchImpl,
    provider: input.provider,
  });
  if (token.status !== "ready") {
    return token.result;
  }
  let response: Response;
  try {
    response = await fetchImpl(`${apiHost}${input.path}`, {
      body: JSON.stringify(input.body),
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${token.tenantAccessToken}`,
      },
      method: input.method,
    });
  } catch {
    return {
      reasonCode: `${input.provider}.${input.operation}_outcome_unknown`,
      status: "outcome_unknown",
    };
  }
  const body = await readJsonObject(response);
  const providerCode = readProviderCode(body);
  if (!response.ok || (providerCode !== null && providerCode !== 0)) {
    return {
      reasonCode: buildProviderFailureReason({
        operation: input.operation,
        provider: input.provider,
        providerCode,
        status: response.status,
      }),
      ...buildProviderRetryMetadata(response),
      status: "failed",
    };
  }
  return { status: "published" };
}

function validateCardCreationInput(input: {
  appId: string;
  appSecret: string;
  initialText: string;
  provider: LarkPlatformMessageChannelProvider;
}): Extract<MessageChannelCardCreationResult, { status: "failed" }> | null {
  if (!(input.appId.trim() && input.appSecret.trim())) {
    return {
      reasonCode: `${input.provider}.connection_credentials_unavailable`,
      status: "failed",
    };
  }
  if (
    !input.initialText.trim() ||
    input.initialText.length > LARK_PLATFORM_STREAMING_CARD_MAX_CHARS
  ) {
    return {
      reasonCode: `${input.provider}.card_create_input_invalid`,
      status: "failed",
    };
  }
  return null;
}

function validateCardReferenceInput(
  input: Parameters<typeof publishLarkPlatformCardReference>[0]
): Extract<MessageChannelPublicationResult, { status: "failed" }> | null {
  if (
    !(
      input.appId.trim() &&
      input.appSecret.trim() &&
      input.cardId.trim() &&
      input.messageId.trim()
    )
  ) {
    return {
      reasonCode: `${input.provider}.card_send_input_invalid`,
      status: "failed",
    };
  }
  if (
    !PROVIDER_PUBLICATION_UUID_PATTERN.test(
      input.providerPublicationIdempotencyKey.trim()
    )
  ) {
    return {
      reasonCode: `${input.provider}.card_send_uuid_invalid`,
      status: "failed",
    };
  }
  return null;
}

function validateCardMutationInput(
  input:
    | Parameters<typeof finalizeLarkPlatformStreamingCard>[0]
    | Parameters<typeof updateLarkPlatformStreamingCardContent>[0]
): Extract<MessageChannelCardMutationResult, { status: "failed" }> | null {
  if (
    !(
      input.appId.trim() &&
      input.appSecret.trim() &&
      input.cardId.trim() &&
      input.text.trim() &&
      Number.isSafeInteger(input.sequence) &&
      input.sequence > 0
    )
  ) {
    return {
      reasonCode: `${input.provider}.card_update_input_invalid`,
      status: "failed",
    };
  }
  if (input.text.length > LARK_PLATFORM_STREAMING_CARD_MAX_CHARS) {
    return {
      reasonCode: `${input.provider}.card_content_too_large`,
      status: "failed",
    };
  }
  if (
    !PROVIDER_PUBLICATION_UUID_PATTERN.test(
      input.providerPublicationIdempotencyKey.trim()
    )
  ) {
    return {
      reasonCode: `${input.provider}.card_update_uuid_invalid`,
      status: "failed",
    };
  }
  return null;
}

function buildLarkPlatformStreamingCard(text: string): JsonObject {
  return {
    body: {
      elements: [
        {
          content: text,
          element_id: LARK_PLATFORM_STREAMING_CARD_ELEMENT_ID,
          tag: "markdown",
        },
      ],
    },
    config: {
      streaming_config: {
        print_frequency_ms: { default: 70 },
        print_step: { default: 1 },
        print_strategy: "fast",
      },
      streaming_mode: true,
      summary: { content: "Request received" },
    },
    schema: "2.0",
  };
}

function buildLarkPlatformTerminalCard(
  text: string,
  outcome: "completed" | "failed" | "stopped" | "continued"
): JsonObject {
  const label = {
    completed: "Response complete",
    failed: "Could not complete this request",
    stopped: "Stopped",
    continued: "Response continues below",
  }[outcome];
  return {
    header: {
      title: { tag: "plain_text", content: label },
      template: outcome === "failed" ? "red" : "grey",
    },
    body: {
      elements: [
        {
          content: text,
          element_id: LARK_PLATFORM_STREAMING_CARD_ELEMENT_ID,
          tag: "markdown",
        },
      ],
    },
    config: {
      streaming_mode: false,
      summary: {
        content: buildCardSummary(
          outcome === "completed" ? text : `${label}: ${text}`
        ),
      },
    },
    schema: "2.0",
  };
}

function buildCardSummary(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return normalized.length <= 50 ? normalized : `${normalized.slice(0, 49)}…`;
}

function validatePublicationInput(
  input: Parameters<typeof publishLarkPlatformReply>[0]
): Extract<MessageChannelPublicationResult, { status: "failed" }> | null {
  if (!(input.appId.trim() && input.appSecret.trim())) {
    return {
      reasonCode: `${input.provider}.connection_credentials_unavailable`,
      status: "failed",
    };
  }
  if (!(input.messageId.trim() && input.text.trim())) {
    return {
      reasonCode: `${input.provider}.message_reply_input_invalid`,
      status: "failed",
    };
  }
  if (
    !PROVIDER_PUBLICATION_UUID_PATTERN.test(
      input.providerPublicationIdempotencyKey.trim()
    )
  ) {
    return {
      reasonCode: `${input.provider}.message_reply_uuid_invalid`,
      status: "failed",
    };
  }
  return null;
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number
): Promise<
  | { bytes: Uint8Array; status: "read" }
  | {
      reasonCode: "message_resource_body_unavailable";
      status: "failed";
    }
  | {
      reasonCode: "message_resource_too_large";
      status: "failed";
    }
  | {
      reasonCode: "message_resource_read_failed";
      status: "retryable";
    }
> {
  if (!response.body) {
    return {
      reasonCode: "message_resource_body_unavailable",
      status: "failed",
    };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return {
          reasonCode: "message_resource_too_large",
          status: "failed",
        };
      }
      chunks.push(result.value);
    }
  } catch {
    return {
      reasonCode: "message_resource_read_failed",
      status: "retryable",
    };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, status: "read" };
}

function readContentLength(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (!(raw && NONNEGATIVE_INTEGER_PATTERN.test(raw))) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeContentType(value: string | null): string | null {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || null;
}

function isRetryableProviderReason(reasonCode: string): boolean {
  return (
    reasonCode.endsWith("_transport_failed") ||
    reasonCode.endsWith("_http_429") ||
    SERVER_ERROR_REASON_PATTERN.test(reasonCode)
  );
}

function validateIdentityLinkCardInput(
  input: Parameters<typeof publishLarkPlatformIdentityLinkCard>[0]
): Extract<MessageChannelPublicationResult, { status: "failed" }> | null {
  let linkUrl: URL;
  try {
    linkUrl = new URL(input.linkUrl);
  } catch {
    return {
      reasonCode: `${input.provider}.identity_link_card_input_invalid`,
      status: "failed",
    };
  }
  if (
    !(
      input.appId.trim() &&
      input.appSecret.trim() &&
      input.providerUserId.trim()
    ) ||
    linkUrl.protocol !== "https:" ||
    !PROVIDER_PUBLICATION_UUID_PATTERN.test(
      input.providerPublicationIdempotencyKey.trim()
    )
  ) {
    return {
      reasonCode: `${input.provider}.identity_link_card_input_invalid`,
      status: "failed",
    };
  }
  return null;
}

function validateNavigationActionCardInput(
  input: Parameters<typeof publishLarkPlatformNavigationActionCard>[0]
): Extract<MessageChannelPublicationResult, { status: "failed" }> | null {
  let actionUrl: URL;
  try {
    actionUrl = new URL(input.action.url);
  } catch {
    return {
      reasonCode: `${input.provider}.navigation_action_card_input_invalid`,
      status: "failed",
    };
  }
  if (
    !(
      input.appId.trim() &&
      input.appSecret.trim() &&
      input.providerUserId.trim() &&
      input.text.trim() &&
      input.action.label.trim()
    ) ||
    (actionUrl.protocol !== "https:" && actionUrl.protocol !== "http:") ||
    !PROVIDER_PUBLICATION_UUID_PATTERN.test(
      input.providerPublicationIdempotencyKey.trim()
    )
  ) {
    return {
      reasonCode: `${input.provider}.navigation_action_card_input_invalid`,
      status: "failed",
    };
  }
  return null;
}

function buildLarkPlatformIdentityLinkCard(input: {
  linkUrl: string;
  organizationName: string;
  purpose: "continue_request" | "optional_setup";
  requestedAction?: string;
}): JsonObject {
  const continuesRequest = input.purpose === "continue_request";
  const actionLabel = continuesRequest
    ? "Connect my account and continue"
    : "Connect my account";
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: "div",
        text: {
          content: buildLarkPlatformIdentityGuidanceText(input),
          tag: "plain_text",
        },
      },
      {
        actions: [
          {
            tag: "button",
            text: {
              content: actionLabel,
              tag: "plain_text",
            },
            type: "primary",
            url: input.linkUrl,
          },
        ],
        tag: "action",
      },
    ],
    header: {
      template: "blue",
      title: {
        content: actionLabel,
        tag: "plain_text",
      },
    },
  };
}

function buildLarkPlatformNavigationActionCard(input: {
  action: NavigationAction;
  text: string;
}): JsonObject {
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: "div",
        text: {
          content: input.text,
          tag: "plain_text",
        },
      },
      {
        actions: [
          {
            tag: "button",
            text: {
              content: input.action.label,
              tag: "plain_text",
            },
            type: "primary",
            url: input.action.url,
          },
        ],
        tag: "action",
      },
    ],
    header: {
      template: "blue",
      title: {
        content: input.action.label,
        tag: "plain_text",
      },
    },
  };
}

function buildLarkPlatformIdentityGuidanceText(input: {
  organizationName: string;
  purpose: "continue_request" | "optional_setup";
  requestedAction?: string;
}): string {
  if (input.purpose === "optional_setup") {
    return `Connect this account to ${input.organizationName} on OpenMeld. This one-time link expires in 24 hours.`;
  }
  const requestedAction = input.requestedAction?.trim().replace(/\s+/gu, " ");
  if (requestedAction) {
    return `To continue with "${requestedAction}", connect this account to ${input.organizationName}. The Center Agent will continue automatically. This one-time link expires in 24 hours.`;
  }
  return `This request needs your personal OpenMeld access. Connect this account to ${input.organizationName}, and the Center Agent will continue automatically. This one-time link expires in 24 hours.`;
}

export function getLarkPlatformApiHost(
  provider: LarkPlatformMessageChannelProvider
): string {
  return LARK_PLATFORM_API_HOSTS[provider];
}

export async function requestLarkPlatformTenantAccessToken(input: {
  apiHost: string;
  appId: string;
  appSecret: string;
  clock?: () => number;
  fetchImpl: typeof fetch;
  provider: LarkPlatformMessageChannelProvider;
}): Promise<LarkPlatformTenantAccessTokenResult> {
  const appId = input.appId.trim();
  const appSecret = input.appSecret.trim();
  const cacheKey = [
    input.provider,
    input.apiHost,
    encodeURIComponent(appId),
  ].join(":");
  const nowMs = (input.clock ?? Date.now)();
  const cache = getLarkPlatformTenantTokenMap(
    larkPlatformTenantAccessTokenCacheByFetch,
    input.fetchImpl
  );
  const cached = cache.get(cacheKey);
  if (cached?.appSecret === appSecret && cached.expiresAtMs > nowMs) {
    return {
      status: "ready",
      tenantAccessToken: cached.tenantAccessToken,
    };
  }
  cache.delete(cacheKey);

  const pending = getLarkPlatformTenantTokenMap(
    larkPlatformTenantAccessTokenPendingByFetch,
    input.fetchImpl
  );
  const existingRequest = pending.get(cacheKey);
  if (existingRequest?.appSecret === appSecret) {
    return await existingRequest.request;
  }
  const request = mintLarkPlatformTenantAccessToken({
    ...input,
    appId,
    appSecret,
  });
  pending.set(cacheKey, { appSecret, request });
  try {
    const minted = await request;
    if (minted.status !== "ready") {
      return minted;
    }
    if (minted.expiresInSeconds > 0) {
      cache.set(cacheKey, {
        appSecret,
        expiresAtMs:
          nowMs +
          resolveTenantAccessTokenCacheLifetimeMs(minted.expiresInSeconds),
        tenantAccessToken: minted.tenantAccessToken,
      });
    }
    return {
      status: "ready",
      tenantAccessToken: minted.tenantAccessToken,
    };
  } finally {
    if (pending.get(cacheKey)?.request === request) {
      pending.delete(cacheKey);
    }
  }
}

async function mintLarkPlatformTenantAccessToken(input: {
  apiHost: string;
  appId: string;
  appSecret: string;
  fetchImpl: typeof fetch;
  provider: LarkPlatformMessageChannelProvider;
}): Promise<
  | {
      expiresInSeconds: number;
      status: "ready";
      tenantAccessToken: string;
    }
  | {
      result: Extract<MessageChannelPublicationResult, { status: "failed" }>;
      status: "failed";
    }
> {
  let response: Response;
  try {
    const fetchImpl = input.fetchImpl;
    response = await fetchImpl(
      `${input.apiHost}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        body: JSON.stringify({
          app_id: input.appId.trim(),
          app_secret: input.appSecret.trim(),
        }),
        headers: JSON_HEADERS,
        method: "POST",
      }
    );
  } catch {
    return {
      result: {
        reasonCode: `${input.provider}.tenant_token_transport_failed`,
        status: "failed",
      },
      status: "failed",
    };
  }
  const body = await readJsonObject(response);
  const providerCode = readProviderCode(body);
  if (!response.ok || providerCode !== 0) {
    return {
      result: {
        reasonCode: buildProviderFailureReason({
          operation: "tenant_token",
          provider: input.provider,
          providerCode,
          status: response.status,
        }),
        ...buildProviderRetryMetadata(response),
        status: "failed",
      },
      status: "failed",
    };
  }
  const tenantAccessToken = readString(body, "tenant_access_token");
  if (!tenantAccessToken) {
    return {
      result: {
        reasonCode: `${input.provider}.tenant_token_result_missing`,
        status: "failed",
      },
      status: "failed",
    };
  }
  return {
    expiresInSeconds: readPositiveInteger(body, "expire") ?? 0,
    status: "ready",
    tenantAccessToken,
  };
}

function getLarkPlatformTenantTokenMap<T>(
  store: WeakMap<typeof fetch, Map<string, T>>,
  fetchImpl: typeof fetch
): Map<string, T> {
  const existing = store.get(fetchImpl);
  if (existing) {
    return existing;
  }
  const created = new Map<string, T>();
  store.set(fetchImpl, created);
  return created;
}

function resolveTenantAccessTokenCacheLifetimeMs(
  expiresInSeconds: number
): number {
  const boundedSeconds = Math.min(
    expiresInSeconds,
    LARK_PLATFORM_TENANT_TOKEN_MAX_LIFETIME_SECONDS
  );
  const lifetimeMs = boundedSeconds * 1000;
  const safetyWindowMs = Math.min(
    LARK_PLATFORM_TENANT_TOKEN_MAX_SAFETY_WINDOW_MS,
    Math.max(1, Math.floor(lifetimeMs / 10))
  );
  return Math.max(1, lifetimeMs - safetyWindowMs);
}

async function readJsonObject(response: Response): Promise<JsonObject | null> {
  try {
    const value: unknown = await response.json();
    return isJsonObject(value) ? value : null;
  } catch {
    return null;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObject(body: JsonObject | null, key: string): JsonObject | null {
  const value = body?.[key];
  return isJsonObject(value) ? value : null;
}

function readArray(body: JsonObject | null, key: string): unknown[] {
  const value = body?.[key];
  return Array.isArray(value) ? value : [];
}

function readBoolean(body: JsonObject | null, key: string): boolean | null {
  const value = body?.[key];
  return typeof value === "boolean" ? value : null;
}

function readPositiveInteger(
  body: JsonObject | null,
  key: string
): number | null {
  const value = body?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function readProviderCode(body: JsonObject | null): number | null {
  const value = body?.code;
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function readString(body: JsonObject | null, key: string): string | null {
  const value = body?.[key];
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readNestedString(
  body: JsonObject | null,
  parentKey: string,
  key: string
): string | null {
  const parent = body?.[parentKey];
  return isJsonObject(parent) ? readString(parent, key) : null;
}

function belongsToCurrentConversation(
  item: JsonObject,
  event: LarkPlatformMessageEvent
): boolean {
  const locator = event.locator;
  if (
    locator.provider === "slack" ||
    readString(item, "chat_id") !== locator.chatId
  ) {
    return false;
  }
  return (
    (readString(item, "root_id") ?? readString(item, "message_id")) ===
    locator.rootMessageId
  );
}

function normalizeHistoricalMessage(
  item: JsonObject
): ChannelContextMessage | null {
  const id = readString(item, "message_id");
  const sentAtMs = readNonnegativeInteger(item, "create_time");
  const body = readObject(item, "body");
  const content = parseJsonObject(readString(body, "content"));
  let rawText: string | null | undefined = null;
  if (readString(item, "msg_type") === "text") {
    rawText = readString(content, "text");
  } else if (readString(item, "msg_type") === "post") {
    rawText = readLarkPlatformPostContent(content)?.text;
  }
  if (!(id && sentAtMs !== null && rawText)) {
    return null;
  }
  const sender = readObject(item, "sender");
  const senderType = readString(sender, "sender_type");
  const text = replaceMentionKeys(rawText, readArray(item, "mentions")).trim();
  if (!text) {
    return null;
  }
  const author: ChannelContextMessage["author"] = {
    kind: resolveChannelContextAuthorKind(senderType),
  };
  const senderId = readString(sender, "id");
  const senderName = readString(sender, "sender_name");
  if (senderId) {
    author.id = senderId;
  }
  if (senderName) {
    author.displayName = senderName;
  }
  return {
    author,
    id,
    sentAtMs,
    text: text.slice(0, CHANNEL_CONTEXT_MESSAGE_TEXT_MAX_CHARS),
  };
}

function replaceMentionKeys(
  text: string,
  mentions: readonly unknown[]
): string {
  let result = text;
  for (const mention of mentions) {
    if (!isJsonObject(mention)) {
      continue;
    }
    const key = readString(mention, "key");
    const name = readString(mention, "name");
    if (key && name) {
      result = result.replaceAll(key, name);
    }
  }
  return result;
}

function boundHistoricalMessages(messages: readonly ChannelContextMessage[]): {
  messages: ChannelContextMessage[];
  truncated: boolean;
} {
  const ordered = [...messages].sort(
    (first, second) =>
      first.sentAtMs - second.sentAtMs || first.id.localeCompare(second.id)
  );
  const selected: ChannelContextMessage[] = [];
  let totalTextCharacters = 0;
  let truncated = ordered.length > CHANNEL_CONTEXT_MAX_MESSAGES;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const message = ordered[index];
    if (!message) {
      continue;
    }
    if (
      selected.length >= CHANNEL_CONTEXT_MAX_MESSAGES ||
      totalTextCharacters + message.text.length >
        CHANNEL_CONTEXT_TOTAL_TEXT_MAX_CHARS
    ) {
      truncated = true;
      continue;
    }
    selected.push(message);
    totalTextCharacters += message.text.length;
  }
  selected.reverse();
  return { messages: selected, truncated };
}

function readNonnegativeInteger(
  object: JsonObject | null,
  key: string
): number | null {
  const value = readString(object, key);
  if (!(value && NONNEGATIVE_INTEGER_PATTERN.test(value))) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function resolveChannelContextFailureStatus(input: {
  providerCode: number | null;
  response: Response;
}): ChannelContext["sync"]["status"] | null {
  if (input.response.ok && input.providerCode === 0) {
    return null;
  }
  if (input.response.status === 403) {
    return "forbidden";
  }
  if (input.response.status === 429) {
    return "rate_limited";
  }
  return "unavailable";
}

function resolveChannelContextAuthorKind(
  senderType: string | null
): ChannelContextMessage["author"]["kind"] {
  if (senderType === "user") {
    return "human";
  }
  if (senderType === "app" || senderType === "bot") {
    return "bot";
  }
  return "unknown";
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

function buildProviderFailureReason(input: {
  operation:
    | "card_create"
    | "card_finalize"
    | "card_send"
    | "card_update"
    | "identity_link_card"
    | "message_reply"
    | "navigation_action_card"
    | "tenant_token";
  provider: LarkPlatformMessageChannelProvider;
  providerCode: number | null;
  status: number;
}): string {
  if (input.providerCode !== null && input.providerCode !== 0) {
    return `${input.provider}.${input.operation}_provider_error_${input.providerCode}`;
  }
  return `${input.provider}.${input.operation}_http_${input.status}`;
}

function buildProviderRetryMetadata(
  response: Response
): { retryAfterMs: number } | Record<string, never> {
  if (response.status !== 429) {
    return {};
  }
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (!retryAfter) {
    return {};
  }
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return {
      retryAfterMs: Math.min(300_000, Math.ceil(seconds * 1000)),
    };
  }
  const retryAtMs = Date.parse(retryAfter);
  if (!Number.isFinite(retryAtMs)) {
    return {};
  }
  return {
    retryAfterMs: Math.min(
      300_000,
      Math.max(0, Math.ceil(retryAtMs - Date.now()))
    ),
  };
}
