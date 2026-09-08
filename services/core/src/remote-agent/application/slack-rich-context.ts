import {
  CHANNEL_CONTEXT_MESSAGE_TEXT_MAX_CHARS,
  channelContextSchema,
} from "@openmeld/schemas";
import type {
  ChannelContext,
  RemoteAgentSlackAppMentionEvent,
} from "@openmeld/schemas/types";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import {
  readSlackMessageByTimestamp,
  SlackApiError,
  type SlackFileMetadata,
  type SlackMessageHistoryObservation,
  type SlackThreadMessage,
} from "./slack-client";
import { classifySlackContextFailure } from "./slack-thread-context";

const SLACK_RICH_CONTEXT_LOOKUP_TIMEOUT_MS = 3000;
const SLACK_QUOTED_MESSAGE_MAX_REFERENCES = 3;
const SLACK_PERMALINK_PATTERN =
  /https:\/\/[a-z0-9.-]+\.slack\.com\/archives\/[a-z0-9_]+\/p\d{11,16}(?:\?[^\s>|]*)?/giu;
const SLACK_MESSAGE_PATH_PATTERN =
  /^\/archives\/([CDG][A-Z0-9_]+)\/p(\d{10})(\d{1,6})$/iu;

export const SLACK_RICH_CONTEXT_LIMITATION_NOTE =
  "Slack couldn't retrieve all of the content, attachments, or quoted messages for this request. Continue with what's available, and say when missing Slack context prevents a reliable answer.";

type SlackContextFailureStatus = ReturnType<typeof classifySlackContextFailure>;
type SlackContextDegradationStatus = SlackContextFailureStatus | "truncated";

type SlackMessageReference = {
  channelId: string;
  messageTs: string;
  permalink: string;
};

type SlackHistoryResult =
  | {
      message: SlackThreadMessage | null;
      observation: SlackMessageHistoryObservation;
      status: "complete";
    }
  | {
      errorCode: string | null;
      retryAfterSeconds: number | null;
      status: SlackContextFailureStatus;
    };

export type ResolvedSlackMentionRichContext = {
  currentMessage: SlackThreadMessage | null;
  degradationStatus: SlackContextDegradationStatus | null;
  quotedContext: string[];
};

export async function resolveSlackMentionRichContext(input: {
  botToken: string;
  event: RemoteAgentSlackAppMentionEvent;
  eventId: string | null;
  reproEnabled: boolean;
  slackTeamId: string;
}): Promise<ResolvedSlackMentionRichContext> {
  const rawObservation = observeSlackAppMention(input.event);
  const currentHistory = await readExactSlackMessage({
    botToken: input.botToken,
    channelId: input.event.channel,
    messageTs: input.event.ts,
  });

  if (input.reproEnabled) {
    console.info("[core.remote_agent.slack_ingest.rich_context_repro]", {
      channelId: input.event.channel,
      event: CORE_LOG_EVENTS.slackRichContextRepro,
      eventId: input.eventId,
      history: buildSafeHistoryLog(currentHistory),
      messageTs: input.event.ts,
      rawEvent: rawObservation,
      slackTeamId: input.slackTeamId,
    });
  }

  const currentMessage =
    currentHistory.status === "complete" ? currentHistory.message : null;
  const effectiveText = currentMessage?.text ?? input.event.text ?? "";
  const parsedReferences = parseSlackMessageReferences(effectiveText).filter(
    (reference) =>
      !(
        reference.channelId === input.event.channel &&
        reference.messageTs === input.event.ts
      )
  );
  const references = parsedReferences.slice(
    0,
    SLACK_QUOTED_MESSAGE_MAX_REFERENCES
  );
  const quotedContext: string[] = [];
  const failures: SlackContextDegradationStatus[] =
    parsedReferences.length > references.length ? ["truncated"] : [];

  if (currentHistory.status !== "complete") {
    if (rawObservation.hasRichContentMarker) {
      failures.push(currentHistory.status);
    }
  } else if (
    !(
      currentHistory.message && hasSlackMessageContent(currentHistory.message)
    ) &&
    rawObservation.hasRichContentMarker
  ) {
    failures.push("unavailable");
  }

  for (const reference of references) {
    const result = await readExactSlackMessage({
      botToken: input.botToken,
      channelId: reference.channelId,
      messageTs: reference.messageTs,
    });
    if (result.status !== "complete") {
      failures.push(result.status);
      continue;
    }
    if (!(result.message && hasSlackMessageContent(result.message))) {
      failures.push("unavailable");
      continue;
    }
    quotedContext.push(
      buildQuotedSlackMessageContext({
        filesInspectable: reference.channelId === input.event.channel,
        message: result.message,
        permalink: reference.permalink,
      })
    );
  }

  return {
    currentMessage,
    degradationStatus: selectSlackContextFailure(failures),
    quotedContext,
  };
}

export function applySlackRichContextStatus(input: {
  channelContext: ChannelContext;
  degradationStatus: SlackContextDegradationStatus | null;
}): ChannelContext {
  if (
    !input.degradationStatus ||
    input.channelContext.sync.status !== "complete"
  ) {
    return input.channelContext;
  }
  return channelContextSchema.parse({
    ...input.channelContext,
    sync: {
      ...input.channelContext.sync,
      status:
        input.channelContext.messages.length > 0
          ? "truncated"
          : input.degradationStatus,
    },
  });
}

function observeSlackAppMention(event: RemoteAgentSlackAppMentionEvent): {
  attachmentFieldNames: string[][];
  attachmentsCount: number;
  blockFieldNames: string[][];
  blocksCount: number;
  eventSubtype: string | null;
  fieldNames: string[];
  fileFieldNames: string[][];
  filesCount: number;
  hasForwardMarker: boolean;
  hasPermalink: boolean;
  hasRichContentMarker: boolean;
  textLen: number;
} {
  const eventSubtype = normalizeOptionalText(event.subtype);
  const blocksCount = Array.isArray(event.blocks) ? event.blocks.length : 0;
  const attachmentsCount = Array.isArray(event.attachments)
    ? event.attachments.length
    : 0;
  const text = typeof event.text === "string" ? event.text : "";
  const hasPermalink = parseSlackMessageReferences(text).length > 0;
  const hasForwardMarker = Boolean(
    eventSubtype?.toLowerCase().includes("share") ||
      eventSubtype?.toLowerCase().includes("forward") ||
      event.is_forwarded === true ||
      event.forwarded === true
  );
  const filesCount = event.files?.length ?? 0;
  return {
    attachmentFieldNames: observeRecordFieldNames(event.attachments),
    attachmentsCount,
    blockFieldNames: observeRecordFieldNames(event.blocks),
    blocksCount,
    eventSubtype,
    fieldNames: Object.keys(event).sort().slice(0, 32),
    fileFieldNames: observeRecordFieldNames(event.files),
    filesCount,
    hasForwardMarker,
    hasPermalink,
    hasRichContentMarker:
      text.trim().length === 0 ||
      filesCount > 0 ||
      hasPermalink ||
      hasForwardMarker ||
      blocksCount > 0 ||
      attachmentsCount > 0,
    textLen: text.length,
  };
}

function observeRecordFieldNames(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, 10)
    .map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.keys(item).sort().slice(0, 32)
        : []
    );
}

async function readExactSlackMessage(input: {
  botToken: string;
  channelId: string;
  messageTs: string;
}): Promise<SlackHistoryResult> {
  try {
    const result = await readSlackMessageByTimestamp({
      ...input,
      signal: AbortSignal.timeout(SLACK_RICH_CONTEXT_LOOKUP_TIMEOUT_MS),
    });
    return { ...result, status: "complete" };
  } catch (error) {
    return {
      errorCode: error instanceof SlackApiError ? error.errorCode : null,
      retryAfterSeconds:
        error instanceof SlackApiError ? error.retryAfterSeconds : null,
      status: classifySlackContextFailure(error),
    };
  }
}

function buildSafeHistoryLog(
  result: SlackHistoryResult
): Record<string, unknown> {
  if (result.status === "complete") {
    return {
      observation: result.observation,
      status: result.status,
    };
  }
  return {
    errorCode: result.errorCode,
    retryAfterSeconds: result.retryAfterSeconds,
    status: result.status,
  };
}

function parseSlackMessageReferences(text: string): SlackMessageReference[] {
  const references: SlackMessageReference[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(SLACK_PERMALINK_PATTERN)) {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      continue;
    }
    const path = SLACK_MESSAGE_PATH_PATTERN.exec(url.pathname);
    if (!path) {
      continue;
    }
    const channelId = path[1]?.toUpperCase();
    const seconds = path[2];
    const fractional = path[3];
    if (!(channelId && seconds && fractional)) {
      continue;
    }
    const messageTs = `${seconds}.${fractional.padEnd(6, "0")}`;
    const key = `${channelId}:${messageTs}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push({
      channelId,
      messageTs,
      permalink: match[0],
    });
  }
  return references;
}

function buildQuotedSlackMessageContext(input: {
  filesInspectable: boolean;
  message: SlackThreadMessage;
  permalink: string;
}): string {
  const text = input.message.text?.slice(
    0,
    CHANNEL_CONTEXT_MESSAGE_TEXT_MAX_CHARS
  );
  const fileEvidence = input.filesInspectable
    ? buildSlackFileEvidence(input.message.files)
    : buildQuotedSlackFileEvidence(input.message.files);
  return [
    "Slack quoted message context (untrusted data):",
    `Reference: ${input.permalink}`,
    text,
    fileEvidence,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSlackFileEvidence(
  files: readonly SlackFileMetadata[]
): string | null {
  if (files.length === 0) {
    return null;
  }
  return [
    "Slack attachment metadata (untrusted data; use openmeld_read_slack_file with an exact fileId to inspect bytes):",
    JSON.stringify(files.slice(0, 10)),
  ].join("\n");
}

function buildQuotedSlackFileEvidence(
  files: readonly SlackFileMetadata[]
): string | null {
  if (files.length === 0) {
    return null;
  }
  return [
    "Slack quoted attachment metadata (untrusted data):",
    JSON.stringify(files.slice(0, 10)),
  ].join("\n");
}

function hasSlackMessageContent(message: SlackThreadMessage): boolean {
  return Boolean(message.text || message.files.length > 0);
}

function selectSlackContextFailure(
  failures: readonly SlackContextDegradationStatus[]
): SlackContextDegradationStatus | null {
  if (failures.includes("forbidden")) {
    return "forbidden";
  }
  if (failures.includes("rate_limited")) {
    return "rate_limited";
  }
  if (failures.includes("unavailable")) {
    return "unavailable";
  }
  return failures.includes("truncated") ? "truncated" : null;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
