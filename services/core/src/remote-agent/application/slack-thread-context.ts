import {
  CHANNEL_CONTEXT_MESSAGE_TEXT_MAX_CHARS,
  CHANNEL_CONTEXT_TOTAL_TEXT_MAX_CHARS,
  channelContextSchema,
} from "@openmeld/schemas";
import type { ChannelContext } from "@openmeld/schemas/types";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import {
  advanceSlackThreadContextCursor,
  readSlackThreadContextCursor,
  type SlackThreadContextCursorKey,
} from "../infrastructure/d1/slack-thread-context-cursor-repo";
import {
  readSlackChannelHistory,
  readSlackThreadMessages,
  SlackApiError,
  type SlackThreadMessage,
} from "./slack-client";

const SLACK_THREAD_CONTEXT_LOOKUP_TIMEOUT_MS = 3000;
const SLACK_ROOT_CHANNEL_CONTEXT_PAGE_LIMIT = 8;
const SLACK_TIMESTAMP_PATTERN = /^(\d+)\.(\d{1,6})$/u;
const SLACK_FORBIDDEN_ERROR_CODES = new Set([
  "access_denied",
  "channel_is_limited_access",
  "channel_not_found",
  "ekm_access_denied",
  "enterprise_is_restricted",
  "missing_scope",
  "no_permission",
  "not_in_channel",
  "not_allowed_token_type",
  "team_access_not_granted",
]);

export type ResolvedSlackThreadContext = {
  channelContext: ChannelContext;
  cursorAdvance: {
    syncedThroughEpochMicros: number;
    syncedThroughTs: string;
  } | null;
  cursorKey: SlackThreadContextCursorKey;
};

type ParsedSlackThreadMessage = {
  epochMicros: number;
  message: SlackThreadMessage;
};

export async function resolveSlackThreadContext(input: {
  botToken: string;
  connectionCreatedAtMs: number;
  conversationId: string;
  currentMessageTs: string;
  db: D1Database;
  includeRecentChannelMessages: boolean;
  organizationId: string;
  slackChannelId: string;
  slackTeamId: string;
  slackThreadTs: string;
}): Promise<ResolvedSlackThreadContext> {
  const cursorKey: SlackThreadContextCursorKey = {
    connectionCreatedAtMs: input.connectionCreatedAtMs,
    organizationId: input.organizationId,
    slackChannelId: input.slackChannelId,
    slackTeamId: input.slackTeamId,
    slackThreadTs: input.slackThreadTs,
  };
  const syncedThroughTs = await readSlackThreadContextCursor({
    db: input.db,
    ...cursorKey,
  });
  const mode = syncedThroughTs ? "delta" : "snapshot";

  let page: Awaited<ReturnType<typeof readSlackThreadMessages>>;
  try {
    page = await readSlackThreadMessages({
      botToken: input.botToken,
      channelId: input.slackChannelId,
      latestTs: input.currentMessageTs,
      oldestTs: syncedThroughTs,
      signal: AbortSignal.timeout(SLACK_THREAD_CONTEXT_LOOKUP_TIMEOUT_MS),
      threadTs: input.slackThreadTs,
    });
  } catch (error) {
    const status = classifySlackContextFailure(error);
    console.warn("[core.remote_agent.slack_thread_context.unavailable]", {
      channelId: input.slackChannelId,
      error: toErrorMessage(error),
      errorCode: error instanceof SlackApiError ? error.errorCode : null,
      event: CORE_LOG_EVENTS.coreInternalError,
      retryAfterSeconds:
        error instanceof SlackApiError ? error.retryAfterSeconds : null,
      slackTeamId: input.slackTeamId,
      status,
      threadTs: input.slackThreadTs,
    });
    return {
      channelContext: channelContextSchema.parse({
        provider: "slack",
        conversationId: input.conversationId,
        currentMessageId: input.currentMessageTs,
        sync: { mode, status },
        messages: [],
      }),
      cursorAdvance: null,
      cursorKey,
    };
  }

  const parsedThreadMessages = selectSlackThreadMessages({
    currentMessageTs: input.currentMessageTs,
    messages: page.messages,
    syncedThroughTs,
  });
  const recentChannelMessages = input.includeRecentChannelMessages
    ? await readRecentSlackChannelContext({
        botToken: input.botToken,
        channelId: input.slackChannelId,
        currentMessageTs: input.currentMessageTs,
        slackTeamId: input.slackTeamId,
      })
    : { messages: [], truncated: false };
  const boundedContext = buildBoundedChannelMessages({
    currentMessageTs: input.currentMessageTs,
    parsedMessages: [
      ...parsedThreadMessages,
      ...recentChannelMessages.messages,
    ].sort((left, right) => left.epochMicros - right.epochMicros),
    providerTruncated: page.hasMore || recentChannelMessages.truncated,
  });
  const lastParsedMessage = parsedThreadMessages.at(-1);
  return {
    channelContext: channelContextSchema.parse({
      provider: "slack",
      conversationId: input.conversationId,
      currentMessageId: input.currentMessageTs,
      sync: {
        mode,
        status: boundedContext.truncated ? "truncated" : "complete",
      },
      messages: boundedContext.messages,
    }),
    cursorAdvance: lastParsedMessage
      ? {
          syncedThroughEpochMicros: lastParsedMessage.epochMicros,
          syncedThroughTs: lastParsedMessage.message.ts,
        }
      : null,
    cursorKey,
  };
}

async function readRecentSlackChannelContext(input: {
  botToken: string;
  channelId: string;
  currentMessageTs: string;
  slackTeamId: string;
}): Promise<{ messages: ParsedSlackThreadMessage[]; truncated: boolean }> {
  try {
    const page = await readSlackChannelHistory({
      botToken: input.botToken,
      channelId: input.channelId,
      latestTs: input.currentMessageTs,
      limit: SLACK_ROOT_CHANNEL_CONTEXT_PAGE_LIMIT,
      signal: AbortSignal.timeout(SLACK_THREAD_CONTEXT_LOOKUP_TIMEOUT_MS),
    });
    return {
      messages: selectRecentSlackChannelMessages({
        currentMessageTs: input.currentMessageTs,
        messages: page.messages,
      }),
      truncated: page.nextCursor !== null,
    };
  } catch (error) {
    const status = classifySlackContextFailure(error);
    console.warn("[core.remote_agent.slack_channel_context.unavailable]", {
      channelId: input.channelId,
      error: toErrorMessage(error),
      errorCode: error instanceof SlackApiError ? error.errorCode : null,
      event: CORE_LOG_EVENTS.coreInternalError,
      retryAfterSeconds:
        error instanceof SlackApiError ? error.retryAfterSeconds : null,
      slackTeamId: input.slackTeamId,
      status,
    });
    return { messages: [], truncated: true };
  }
}

function buildBoundedChannelMessages(input: {
  currentMessageTs: string;
  parsedMessages: readonly ParsedSlackThreadMessage[];
  providerTruncated: boolean;
}): { messages: ChannelContext["messages"]; truncated: boolean } {
  let truncated = input.providerTruncated;
  let totalTextCharacters = 0;
  const seenMessageIds = new Set<string>();
  const messages: ChannelContext["messages"] = [];
  for (const { epochMicros, message } of input.parsedMessages) {
    if (
      message.ts === input.currentMessageTs ||
      seenMessageIds.has(message.ts)
    ) {
      continue;
    }
    seenMessageIds.add(message.ts);
    const normalizedText = buildSlackContextMessageText(message);
    if (!normalizedText) {
      continue;
    }
    const perMessageText = truncateText(
      normalizedText,
      CHANNEL_CONTEXT_MESSAGE_TEXT_MAX_CHARS
    );
    if (perMessageText.truncated) {
      truncated = true;
    }
    const remainingCharacters =
      CHANNEL_CONTEXT_TOTAL_TEXT_MAX_CHARS - totalTextCharacters;
    if (remainingCharacters <= 0) {
      truncated = true;
      break;
    }
    const boundedText = truncateText(perMessageText.text, remainingCharacters);
    if (boundedText.truncated) {
      truncated = true;
    }
    messages.push({
      id: message.ts,
      author: buildChannelContextAuthor(message),
      sentAtMs: Math.floor(epochMicros / 1000),
      text: boundedText.text,
    });
    totalTextCharacters += boundedText.text.length;
  }
  return { messages, truncated };
}

function buildSlackContextMessageText(
  message: SlackThreadMessage
): string | null {
  const text = normalizeOptionalText(message.text);
  const fileEvidence = message.files.map((file) =>
    [
      "Slack file attached",
      `fileId=${file.fileId}`,
      ...(file.name ? [`name=${file.name}`] : []),
      ...(file.mimeType ? [`mimeType=${file.mimeType}`] : []),
      ...(file.sizeBytes === null ? [] : [`sizeBytes=${file.sizeBytes}`]),
      ...(file.permalink ? [`permalink=${file.permalink}`] : []),
    ].join("; ")
  );
  if (fileEvidence.length === 0) {
    return text;
  }
  return [text, ...fileEvidence].filter(Boolean).join("\n");
}

function selectSlackThreadMessages(input: {
  currentMessageTs: string;
  messages: readonly SlackThreadMessage[];
  syncedThroughTs: string | null;
}): ParsedSlackThreadMessage[] {
  const currentMessageEpochMicros = parseSlackTimestampToEpochMicros(
    input.currentMessageTs
  );
  const cursorEpochMicros = input.syncedThroughTs
    ? parseSlackTimestampToEpochMicros(input.syncedThroughTs)
    : null;
  return input.messages
    .flatMap((message) => {
      const epochMicros = parseSlackTimestampToEpochMicros(message.ts);
      return epochMicros === null ? [] : [{ epochMicros, message }];
    })
    .filter(
      ({ epochMicros }) =>
        (cursorEpochMicros === null || epochMicros > cursorEpochMicros) &&
        (currentMessageEpochMicros === null ||
          epochMicros <= currentMessageEpochMicros)
    )
    .sort((left, right) => left.epochMicros - right.epochMicros);
}

function selectRecentSlackChannelMessages(input: {
  currentMessageTs: string;
  messages: readonly SlackThreadMessage[];
}): ParsedSlackThreadMessage[] {
  const currentMessageEpochMicros = parseSlackTimestampToEpochMicros(
    input.currentMessageTs
  );
  return input.messages
    .flatMap((message) => {
      const epochMicros = parseSlackTimestampToEpochMicros(message.ts);
      return epochMicros === null ? [] : [{ epochMicros, message }];
    })
    .filter(
      ({ epochMicros }) =>
        currentMessageEpochMicros === null ||
        epochMicros < currentMessageEpochMicros
    )
    .sort((left, right) => left.epochMicros - right.epochMicros);
}

export async function commitSlackThreadContextCursor(input: {
  db: D1Database;
  nowMs: number;
  resolution: ResolvedSlackThreadContext;
}): Promise<void> {
  if (!input.resolution.cursorAdvance) {
    return;
  }
  await advanceSlackThreadContextCursor({
    db: input.db,
    nowMs: input.nowMs,
    ...input.resolution.cursorKey,
    ...input.resolution.cursorAdvance,
  });
}

function buildChannelContextAuthor(
  message: SlackThreadMessage
): ChannelContext["messages"][number]["author"] {
  if (message.botId) {
    return {
      kind: "bot",
      id: message.botId,
      ...(message.displayName ? { displayName: message.displayName } : {}),
    };
  }
  if (message.userId) {
    return {
      kind: "human",
      id: message.userId,
      ...(message.displayName ? { displayName: message.displayName } : {}),
    };
  }
  return {
    kind: message.subtype ? "system" : "unknown",
    ...(message.displayName ? { displayName: message.displayName } : {}),
  };
}

export function classifySlackContextFailure(
  error: unknown
): "forbidden" | "rate_limited" | "unavailable" {
  if (!(error instanceof SlackApiError)) {
    return "unavailable";
  }
  if (error.status === 429 || error.errorCode === "ratelimited") {
    return "rate_limited";
  }
  return SLACK_FORBIDDEN_ERROR_CODES.has(error.errorCode)
    ? "forbidden"
    : "unavailable";
}

function parseSlackTimestampToEpochMicros(value: string): number | null {
  const match = SLACK_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const seconds = Number(match[1]);
  const micros = Number(match[2]?.padEnd(6, "0"));
  const epochMicros = seconds * 1_000_000 + micros;
  return Number.isSafeInteger(epochMicros) && epochMicros > 0
    ? epochMicros
    : null;
}

function truncateText(
  value: string,
  maxCharacters: number
): { text: string; truncated: boolean } {
  if (value.length <= maxCharacters) {
    return { text: value, truncated: false };
  }
  if (maxCharacters <= 1) {
    return { text: "…".slice(0, maxCharacters), truncated: true };
  }
  let text = value.slice(0, maxCharacters - 1);
  const finalCodeUnit = text.charCodeAt(text.length - 1);
  if (finalCodeUnit >= 0xd8_00 && finalCodeUnit <= 0xdb_ff) {
    text = text.slice(0, -1);
  }
  return { text: `${text}…`, truncated: true };
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
