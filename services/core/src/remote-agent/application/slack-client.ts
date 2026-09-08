import {
  CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES,
  CENTER_AGENT_SLACK_SEARCH_CONTENT_MAX_CHARS,
  CENTER_AGENT_SLACK_SEARCH_CONTEXT_MESSAGES_MAX,
  slackMessagePermalinkSchema,
} from "@openmeld/schemas";
import { toSlackMrkdwn } from "./slack-mrkdwn";

type FetchLike = typeof fetch;

type SlackApiFile = {
  channels?: string[] | null;
  groups?: string[] | null;
  id?: string | null;
  ims?: string[] | null;
  mimetype?: string | null;
  name?: string | null;
  permalink?: string | null;
  shares?: {
    private?: Record<string, unknown> | null;
    public?: Record<string, unknown> | null;
  } | null;
  size?: number | null;
  url_private?: string | null;
  url_private_download?: string | null;
};

type SlackApiResponse = {
  channel?: {
    id?: string | null;
    is_ext_shared?: boolean | null;
    is_im?: boolean | null;
    is_member?: boolean | null;
    is_mpim?: boolean | null;
    is_org_shared?: boolean | null;
    is_private?: boolean | null;
    is_shared?: boolean | null;
    name?: string | null;
  } | null;
  channels?: Array<{
    id?: string | null;
    is_archived?: boolean | null;
    is_member?: boolean | null;
    is_private?: boolean | null;
    name?: string | null;
    num_members?: number | null;
  }> | null;
  error?: string;
  file?: SlackApiFile | null;
  file_id?: string | null;
  files?: SlackApiFile[] | null;
  has_more?: boolean;
  message_ts?: string;
  messages?: Array<{
    attachments?: Array<{
      text?: string;
      fallback?: string;
      title?: string;
      from_url?: string;
      [key: string]: unknown;
    }>;
    blocks?: unknown[] | null;
    bot_id?: string | null;
    bot_profile?: {
      name?: string | null;
    } | null;
    subtype?: string | null;
    files?: SlackApiFile[] | null;
    text?: string | null;
    ts?: string | null;
    user?: string | null;
    username?: string | null;
    metadata?: {
      event_payload?: Record<string, unknown> | null;
      event_type?: string | null;
    } | null;
  }> | null;
  members?: Array<
    | string
    | {
        deleted?: boolean | null;
        id?: string | null;
        is_admin?: boolean | null;
        is_app_user?: boolean | null;
        is_bot?: boolean | null;
        is_owner?: boolean | null;
        is_restricted?: boolean | null;
        is_ultra_restricted?: boolean | null;
        name?: string | null;
        profile?: {
          display_name?: string | null;
          email?: string | null;
          real_name?: string | null;
          title?: string | null;
        } | null;
        real_name?: string | null;
      }
  > | null;
  ok?: boolean;
  permalink?: string | null;
  response_metadata?: {
    next_cursor?: string | null;
  } | null;
  view?: {
    hash?: string | null;
    id?: string | null;
  } | null;
  results?: {
    messages?: Array<{
      author_name?: string | null;
      author_user_id?: string | null;
      channel_id?: string | null;
      channel_name?: string | null;
      content?: string | null;
      is_author_bot?: boolean | null;
      message_ts?: string | null;
      permalink?: string | null;
      team_id?: string | null;
      context_messages?: {
        after?: Array<{
          author_name?: string | null;
          is_author_bot?: boolean | null;
          text?: string | null;
          ts?: string | null;
          user_id?: string | null;
        }> | null;
        before?: Array<{
          author_name?: string | null;
          is_author_bot?: boolean | null;
          text?: string | null;
          ts?: string | null;
          user_id?: string | null;
        }> | null;
      } | null;
    }> | null;
  } | null;
  ts?: string;
  upload_url?: string | null;
  user?: {
    deleted?: boolean | null;
    is_restricted?: boolean | null;
    is_stranger?: boolean | null;
    is_ultra_restricted?: boolean | null;
    name?: string | null;
    profile?: {
      display_name?: string | null;
      email?: string | null;
      real_name?: string | null;
    } | null;
    real_name?: string | null;
    team_id?: string | null;
  } | null;
};

const SLACK_API_BASE_URL = "https://slack.com/api";
const SLACK_CHANNEL_LIST_PAGE_LIMIT = 200;
const SLACK_CHANNEL_LIST_MAX_PAGES = 100;
const SLACK_CHANNEL_NAME_PREFIX_PATTERN = /^#+/u;
const SLACK_CONVERSATION_ID_PATTERN = /^[CDG][A-Z0-9]+$/u;
const SLACK_MESSAGE_TIMESTAMP_PATTERN = /^\d+\.\d+$/u;
const SLACK_SEARCH_TRUNCATED_HIGH_SURROGATE_PATTERN = /[\uD800-\uDBFF]$/;
const SLACK_THREAD_CONTEXT_PAGE_LIMIT = 15;
const SLACK_WORKSPACE_MEMBER_PAGE_LIMIT = 200;
const SLACKBOT_USER_ID = "USLACKBOT";
const SLACK_BLOCK_VALIDATION_ERROR_CODES = new Set([
  "invalid_blocks",
  "invalid_blocks_format",
  "msg_blocks_too_long",
]);

export type SlackBlockKitBlock = Record<string, unknown>;
export type SlackChannel = {
  channelId: string;
  channelName: string;
  isMember: boolean;
  isPrivate: boolean;
  memberCount: number | null;
};
export type SlackChannelMessageTarget = {
  channelId: string;
  channelName: string;
  isMember: boolean;
  isPrivate: boolean;
};
export type SlackMessagePublicationOutcome = "not_published" | "unknown";
export type SlackUserIdentity = {
  displayName: string | null;
  email: string | null;
  isDeleted: boolean | null;
  isRestricted: boolean | null;
  isStranger: boolean | null;
  isUltraRestricted: boolean | null;
  teamId: string | null;
};
export type SlackThreadMessage = {
  richContent?: { text: string; incomplete: boolean };
  botId: string | null;
  displayName: string | null;
  files: SlackFileMetadata[];
  subtype: string | null;
  text: string | null;
  ts: string;
  userId: string | null;
};
export type SlackMessageHistoryObservation = {
  matchingMessageCount: number;
  messageCount: number;
  messages: Array<{
    blocksCount: number;
    fieldNames: string[];
    filesCount: number;
    fileFieldNames: string[][];
    textLen: number;
    tsMatches: boolean;
  }>;
};
export type SlackFileMetadata = {
  fileId: string;
  mimeType: string | null;
  name: string | null;
  permalink: string | null;
  sizeBytes: number | null;
};
export type SlackFileRead = {
  bytes: Uint8Array;
  file: SlackFileMetadata;
};
export type SlackSearchMessage = {
  authorName: string;
  authorUserId: string;
  channelId: string;
  channelName: string;
  content: string;
  contextMessages: Omit<SlackSearchMessage, "contextMessages">[];
  isAuthorBot: boolean;
  messageTs: string;
  permalink: string;
};
export type SlackWorkspaceMember = {
  displayName: string;
  email: string | null;
  isAdmin: boolean;
  isGuest: boolean;
  isOwner: boolean;
  realName: string | null;
  slackUserId: string;
  title: string | null;
};

export async function getSlackMessagePermalink(input: {
  botToken: string;
  channelId: string;
  fetchImpl?: FetchLike;
  messageTs: string;
  signal?: AbortSignal;
}): Promise<string> {
  const params = new URLSearchParams({
    channel: input.channelId,
    message_ts: input.messageTs,
  });
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/chat.getPermalink?${params.toString()}`,
    {
      headers: buildSlackHeaders(input.botToken),
      method: "GET",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "chat.getPermalink");
  const permalink = slackMessagePermalinkSchema.safeParse(data.permalink);
  if (!permalink.success) {
    throw new Error("Slack chat.getPermalink returned an invalid permalink");
  }
  return permalink.data;
}

export class SlackMessagePublicationError extends Error {
  readonly errorCode: string | null;
  readonly publicationOutcome: SlackMessagePublicationOutcome;

  constructor(input: {
    cause?: unknown;
    errorCode?: string | null;
    message: string;
    publicationOutcome: SlackMessagePublicationOutcome;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause }
    );
    this.name = "SlackMessagePublicationError";
    this.errorCode = input.errorCode ?? null;
    this.publicationOutcome = input.publicationOutcome;
  }
}

export class SlackApiError extends Error {
  readonly errorCode: string;
  readonly retryAfterSeconds: number | null;
  readonly status: number;

  constructor(input: {
    errorCode: string;
    methodName: string;
    retryAfterSeconds?: number | null;
    status: number;
  }) {
    super(`Slack ${input.methodName} failed: ${input.errorCode}`);
    this.name = "SlackApiError";
    this.errorCode = input.errorCode;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
    this.status = input.status;
  }
}

export async function listSlackChannels(input: {
  botToken: string;
  cursor?: string;
  fetchImpl?: FetchLike;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{
  channels: SlackChannel[];
  nextCursor: string | null;
}> {
  const params = new URLSearchParams({
    exclude_archived: "true",
    limit: String(input.limit ?? SLACK_CHANNEL_LIST_PAGE_LIMIT),
    types: "public_channel,private_channel",
  });
  const cursor = normalizeOptionalText(input.cursor);
  if (cursor) {
    params.set("cursor", cursor);
  }
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/conversations.list?${params.toString()}`,
    {
      headers: buildSlackHeaders(input.botToken),
      method: "GET",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "conversations.list");
  return {
    channels: (data.channels ?? []).flatMap((channel) => {
      const channelId = normalizeOptionalText(channel.id);
      const channelName = normalizeOptionalText(channel.name);
      if (!(channelId && channelName) || channel.is_archived === true) {
        return [];
      }
      return [
        {
          channelId,
          channelName,
          isMember: channel.is_member === true,
          isPrivate: channel.is_private === true,
          memberCount:
            Number.isInteger(channel.num_members) &&
            (channel.num_members ?? -1) >= 0
              ? (channel.num_members ?? null)
              : null,
        },
      ];
    }),
    nextCursor: normalizeOptionalText(data.response_metadata?.next_cursor),
  };
}

export async function listSlackChannelMemberIds(input: {
  botToken: string;
  channelId: string;
  cursor?: string;
  fetchImpl?: FetchLike;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{
  memberIds: string[];
  nextCursor: string | null;
}> {
  const params = new URLSearchParams({
    channel: input.channelId,
    limit: String(input.limit ?? SLACK_WORKSPACE_MEMBER_PAGE_LIMIT),
  });
  const cursor = normalizeOptionalText(input.cursor);
  if (cursor) {
    params.set("cursor", cursor);
  }
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/conversations.members?${params.toString()}`,
    {
      headers: buildSlackHeaders(input.botToken),
      method: "GET",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "conversations.members");
  return {
    memberIds: (data.members ?? []).flatMap((member) => {
      if (typeof member !== "string") {
        return [];
      }
      const memberId = normalizeOptionalText(member);
      return memberId ? [memberId] : [];
    }),
    nextCursor: normalizeOptionalText(data.response_metadata?.next_cursor),
  };
}

export async function listSlackWorkspaceMembers(input: {
  botToken: string;
  cursor?: string;
  fetchImpl?: FetchLike;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{
  members: SlackWorkspaceMember[];
  nextCursor: string | null;
}> {
  const params = new URLSearchParams({
    limit: String(input.limit ?? SLACK_WORKSPACE_MEMBER_PAGE_LIMIT),
  });
  const cursor = normalizeOptionalText(input.cursor);
  if (cursor) {
    params.set("cursor", cursor);
  }
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/users.list?${params.toString()}`,
    {
      headers: buildSlackHeaders(input.botToken),
      method: "GET",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "users.list");
  return {
    members: (data.members ?? []).flatMap((member) => {
      if (typeof member === "string") {
        return [];
      }
      const slackUserId = normalizeOptionalText(member.id);
      if (
        !slackUserId ||
        slackUserId === SLACKBOT_USER_ID ||
        member.deleted === true ||
        member.is_bot === true ||
        member.is_app_user === true
      ) {
        return [];
      }
      const realName =
        normalizeOptionalText(member.profile?.real_name) ??
        normalizeOptionalText(member.real_name);
      const displayName =
        normalizeOptionalText(member.profile?.display_name) ??
        realName ??
        normalizeOptionalText(member.name);
      if (!displayName) {
        return [];
      }
      return [
        {
          displayName,
          email: normalizeOptionalText(member.profile?.email),
          isAdmin: member.is_admin === true,
          isGuest:
            member.is_restricted === true ||
            member.is_ultra_restricted === true,
          isOwner: member.is_owner === true,
          realName,
          slackUserId,
          title: normalizeOptionalText(member.profile?.title),
        },
      ];
    }),
    nextCursor: normalizeOptionalText(data.response_metadata?.next_cursor),
  };
}

export async function searchSlackPublicMessages(input: {
  actionToken: string;
  botToken: string;
  fetchImpl?: FetchLike;
  includeBots: boolean;
  includeContextMessages?: boolean;
  limit: number;
  query: string;
  signal?: AbortSignal;
}): Promise<{
  messages: SlackSearchMessage[];
  moreResultsAvailable: boolean;
}> {
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/assistant.search.context`,
    {
      body: JSON.stringify({
        action_token: input.actionToken,
        channel_types: ["public_channel"],
        content_types: ["messages"],
        include_bots: input.includeBots,
        include_context_messages: input.includeContextMessages ?? false,
        limit: input.limit,
        query: input.query,
      }),
      headers: buildSlackHeaders(input.botToken),
      method: "POST",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "assistant.search.context");
  return {
    messages: (data.results?.messages ?? []).flatMap((message) => {
      const normalized = normalizeSlackSearchEvidenceItem(message);
      if (!normalized) {
        return [];
      }
      return [
        {
          ...normalized,
          contextMessages: [
            ...(message.context_messages?.before ?? []),
            ...(message.context_messages?.after ?? []),
          ]
            .flatMap((contextMessage) => {
              const context = normalizeSlackSearchContextEvidenceItem({
                contextMessage,
                parent: normalized,
              });
              return context ? [context] : [];
            })
            .slice(0, CENTER_AGENT_SLACK_SEARCH_CONTEXT_MESSAGES_MAX),
        },
      ];
    }),
    moreResultsAvailable: Boolean(
      normalizeOptionalText(data.response_metadata?.next_cursor)
    ),
  };
}

function normalizeSlackSearchContextEvidenceItem(input: {
  contextMessage: {
    author_name?: string | null;
    is_author_bot?: boolean | null;
    text?: string | null;
    ts?: string | null;
    user_id?: string | null;
  };
  parent: Omit<SlackSearchMessage, "contextMessages">;
}): Omit<SlackSearchMessage, "contextMessages"> | null {
  const authorName = normalizeOptionalText(input.contextMessage.author_name);
  const authorUserId = normalizeOptionalText(input.contextMessage.user_id);
  const content = normalizeSlackSearchContent(input.contextMessage.text);
  const messageTs = normalizeOptionalText(input.contextMessage.ts);
  const permalink = messageTs
    ? buildSlackContextMessagePermalink({
        channelId: input.parent.channelId,
        messageTs,
        parentPermalink: input.parent.permalink,
      })
    : null;
  if (!(authorName && authorUserId && content && messageTs && permalink)) {
    return null;
  }
  return {
    authorName,
    authorUserId,
    channelId: input.parent.channelId,
    channelName: input.parent.channelName,
    content,
    isAuthorBot: input.contextMessage.is_author_bot === true,
    messageTs,
    permalink,
  };
}

function buildSlackContextMessagePermalink(input: {
  channelId: string;
  messageTs: string;
  parentPermalink: string;
}): string | null {
  if (!SLACK_MESSAGE_TIMESTAMP_PATTERN.test(input.messageTs)) {
    return null;
  }
  try {
    const parent = new URL(input.parentPermalink);
    parent.pathname = `/archives/${encodeURIComponent(input.channelId)}/p${input.messageTs.replace(".", "")}`;
    parent.search = "";
    parent.hash = "";
    return normalizeSlackPermalink(parent.toString());
  } catch {
    return null;
  }
}

function normalizeSlackSearchEvidenceItem(message: {
  author_name?: string | null;
  author_user_id?: string | null;
  channel_id?: string | null;
  channel_name?: string | null;
  content?: string | null;
  is_author_bot?: boolean | null;
  message_ts?: string | null;
  permalink?: string | null;
}): Omit<SlackSearchMessage, "contextMessages"> | null {
  const authorName = normalizeOptionalText(message.author_name);
  const authorUserId = normalizeOptionalText(message.author_user_id);
  const channelId = normalizeOptionalText(message.channel_id);
  const channelName = normalizeOptionalText(message.channel_name);
  const content = normalizeSlackSearchContent(message.content);
  const messageTs = normalizeOptionalText(message.message_ts);
  const permalink = normalizeSlackPermalink(message.permalink);
  if (
    !(
      authorName &&
      authorUserId &&
      channelId &&
      channelName &&
      content &&
      messageTs &&
      permalink
    )
  ) {
    return null;
  }
  return {
    authorName,
    authorUserId,
    channelId,
    channelName,
    content,
    isAuthorBot: message.is_author_bot === true,
    messageTs,
    permalink,
  };
}

export async function postSlackThreadMessage(input: {
  blocks?: readonly SlackBlockKitBlock[];
  botToken: string;
  channelId: string;
  fetchImpl?: FetchLike;
  metadata?: {
    eventPayload: Record<string, string>;
    eventType: string;
  };
  replyBroadcast?: boolean;
  signal?: AbortSignal;
  text: string;
  threadTs: string;
}): Promise<{ id: string }> {
  return await postSlackMessage({
    ...input,
    threadTs: input.threadTs,
  });
}

export async function findSlackThreadMessageByMetadata(input: {
  botToken: string;
  channelId: string;
  eventPayloadKey: string;
  eventPayloadValue: string;
  eventType: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  threadTs: string;
}): Promise<{ id: string } | null> {
  return await findSlackMessageByMetadata({
    ...input,
    methodName: "conversations.replies",
    params: new URLSearchParams({
      channel: input.channelId,
      include_all_metadata: "true",
      limit: "100",
      ts: input.threadTs,
    }),
  });
}

export async function findSlackTopLevelMessageByMetadata(input: {
  botToken: string;
  channelId: string;
  eventPayloadKey: string;
  eventPayloadValue: string;
  eventType: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<{ id: string } | null> {
  return await findSlackMessageByMetadata({
    ...input,
    methodName: "conversations.history",
    params: new URLSearchParams({
      channel: input.channelId,
      include_all_metadata: "true",
      limit: "100",
    }),
  });
}

async function findSlackMessageByMetadata(input: {
  botToken: string;
  eventPayloadKey: string;
  eventPayloadValue: string;
  eventType: string;
  fetchImpl?: FetchLike;
  methodName: "conversations.history" | "conversations.replies";
  params: URLSearchParams;
  signal?: AbortSignal;
}): Promise<{ id: string } | null> {
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams(input.params);
    if (cursor) {
      params.set("cursor", cursor);
    }
    const response = await (input.fetchImpl ?? fetch)(
      `${SLACK_API_BASE_URL}/${input.methodName}?${params.toString()}`,
      {
        headers: buildSlackHeaders(input.botToken),
        method: "GET",
        signal: input.signal,
      }
    );
    const data = await readSlackApiResponse(response);
    assertSlackOk(response, data, input.methodName);
    const match = (data.messages ?? []).find(
      (message) =>
        message.metadata?.event_type === input.eventType &&
        message.metadata.event_payload?.[input.eventPayloadKey] ===
          input.eventPayloadValue
    );
    const id = normalizeOptionalText(match?.ts);
    if (id) {
      return { id };
    }
    cursor = normalizeOptionalText(data.response_metadata?.next_cursor);
    if (!cursor) {
      return null;
    }
  }
  throw new Error("Slack recovery metadata scan exceeded the page limit");
}

export async function readSlackThreadMessages(input: {
  botToken: string;
  channelId: string;
  fetchImpl?: FetchLike;
  latestTs: string;
  oldestTs?: string | null;
  signal?: AbortSignal;
  threadTs: string;
}): Promise<{
  hasMore: boolean;
  messages: SlackThreadMessage[];
}> {
  const params = new URLSearchParams({
    channel: input.channelId,
    inclusive: "true",
    latest: input.latestTs,
    limit: String(SLACK_THREAD_CONTEXT_PAGE_LIMIT),
    ts: input.threadTs,
  });
  const oldestTs = normalizeOptionalText(input.oldestTs);
  if (oldestTs) {
    params.set("oldest", oldestTs);
  }
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/conversations.replies?${params.toString()}`,
    {
      headers: buildSlackHeaders(input.botToken),
      method: "GET",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "conversations.replies");
  return {
    hasMore: data.has_more === true,
    messages: toSlackThreadMessages(data.messages),
  };
}

export async function readSlackChannelHistory(input: {
  botToken: string;
  channelId: string;
  cursor?: string;
  fetchImpl?: FetchLike;
  latestTs?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{
  messages: SlackThreadMessage[];
  nextCursor: string | null;
}> {
  const params = new URLSearchParams({
    channel: input.channelId,
    limit: String(input.limit ?? SLACK_THREAD_CONTEXT_PAGE_LIMIT),
  });
  const cursor = normalizeOptionalText(input.cursor);
  if (cursor) {
    params.set("cursor", cursor);
  }
  const latestTs = normalizeOptionalText(input.latestTs);
  if (latestTs) {
    params.set("latest", latestTs);
  }
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/conversations.history?${params.toString()}`,
    {
      headers: buildSlackHeaders(input.botToken),
      method: "GET",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "conversations.history");
  return {
    messages: toSlackThreadMessages(data.messages),
    nextCursor: normalizeOptionalText(data.response_metadata?.next_cursor),
  };
}

export async function readSlackMessageByTimestamp(input: {
  botToken: string;
  channelId: string;
  fetchImpl?: FetchLike;
  messageTs: string;
  signal?: AbortSignal;
  threadTs?: string;
}): Promise<{
  message: SlackThreadMessage | null;
  observation: SlackMessageHistoryObservation;
}> {
  const params = new URLSearchParams({
    channel: input.channelId,
    inclusive: "true",
    latest: input.messageTs,
    limit: "1",
    oldest: input.messageTs,
  });
  const method =
    input.threadTs && input.threadTs !== input.messageTs
      ? "conversations.replies"
      : "conversations.history";
  if (input.threadTs && method === "conversations.replies") {
    params.set("ts", input.threadTs);
  }
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/${method}?${params.toString()}`,
    {
      headers: buildSlackHeaders(input.botToken),
      method: "GET",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, method);
  const messages = data.messages ?? [];
  return {
    message:
      toSlackThreadMessages(messages).find(
        (message) => message.ts === input.messageTs
      ) ?? null,
    observation: buildSlackMessageHistoryObservation(messages, input.messageTs),
  };
}

export async function readSlackFile(input: {
  botToken: string;
  expectedChannelId: string;
  fetchImpl?: FetchLike;
  fileId: string;
  signal?: AbortSignal;
}): Promise<SlackFileRead> {
  const params = new URLSearchParams({ file: input.fileId });
  const fetchImpl = input.fetchImpl ?? fetch;
  const infoResponse = await fetchImpl(
    `${SLACK_API_BASE_URL}/files.info?${params.toString()}`,
    {
      headers: buildSlackHeaders(input.botToken),
      method: "GET",
      signal: input.signal,
    }
  );
  const info = await readSlackApiResponse(infoResponse);
  assertSlackOk(infoResponse, info, "files.info");
  const file = requireSlackFileMetadata(info.file);
  if (file.fileId !== input.fileId) {
    throw new Error("Slack files.info returned a different file identity.");
  }
  if (!slackFileIsSharedInChannel(info.file, input.expectedChannelId)) {
    throw new Error(
      "Slack files.info did not confirm that this file belongs to the requested conversation."
    );
  }
  if (
    file.sizeBytes !== null &&
    file.sizeBytes > CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES
  ) {
    throw new Error(
      `Slack file ${file.fileId} is larger than the ${CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES}-byte Center Agent limit.`
    );
  }
  const downloadUrl = requireSlackPrivateFileDownloadUrl(info.file);
  const downloadResponse = await fetchImpl(downloadUrl, {
    headers: { authorization: `Bearer ${input.botToken}` },
    method: "GET",
    signal: input.signal,
  });
  if (!downloadResponse.ok) {
    throw new Error(
      `Slack file download failed with HTTP ${downloadResponse.status}.`
    );
  }
  const bytes = await readBoundedResponseBytes(
    downloadResponse,
    CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES
  );
  if (file.sizeBytes !== null && bytes.byteLength !== file.sizeBytes) {
    throw new Error("Slack file download size did not match files.info.");
  }
  return { bytes, file };
}

export async function postSlackTopLevelMessage(input: {
  blocks?: readonly SlackBlockKitBlock[];
  botToken: string;
  channelId: string;
  fetchImpl?: FetchLike;
  metadata?: {
    eventPayload: Record<string, string>;
    eventType: string;
  };
  signal?: AbortSignal;
  text: string;
}): Promise<{ id: string }> {
  return await postSlackMessage({
    blocks: input.blocks,
    botToken: input.botToken,
    channelId: input.channelId,
    fetchImpl: input.fetchImpl,
    metadata: input.metadata,
    signal: input.signal,
    text: input.text,
  });
}

export async function postSlackDirectMessage(input: {
  blocks?: readonly SlackBlockKitBlock[];
  botToken: string;
  fetchImpl?: FetchLike;
  metadata?: {
    eventPayload: Record<string, string>;
    eventType: string;
  };
  recipientUserId: string;
  signal?: AbortSignal;
  text: string;
}): Promise<{ id: string }> {
  return await postSlackTopLevelMessage({
    blocks: input.blocks,
    botToken: input.botToken,
    channelId: input.recipientUserId,
    fetchImpl: input.fetchImpl,
    metadata: input.metadata,
    signal: input.signal,
    text: input.text,
  });
}

export async function openSlackDirectMessage(input: {
  botToken: string;
  fetchImpl?: FetchLike;
  recipientUserId: string;
  signal?: AbortSignal;
}): Promise<{ channelId: string }> {
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/conversations.open`,
    {
      body: JSON.stringify({ users: [input.recipientUserId] }),
      headers: buildSlackHeaders(input.botToken),
      method: "POST",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "conversations.open");
  const channelId = normalizeOptionalText(data.channel?.id);
  if (!channelId) {
    throw new SlackApiError({
      errorCode: "missing_channel",
      methodName: "conversations.open",
      status: response.status,
    });
  }
  return { channelId };
}

export async function openSlackModal(input: {
  botToken: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  triggerId: string;
  view: Record<string, unknown>;
}): Promise<{ hash: string; viewId: string }> {
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/views.open`,
    {
      body: JSON.stringify({
        trigger_id: input.triggerId,
        view: input.view,
      }),
      headers: buildSlackHeaders(input.botToken),
      method: "POST",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "views.open");
  return readSlackModalIdentity(response, data, "views.open");
}

export async function updateSlackModal(input: {
  botToken: string;
  fetchImpl?: FetchLike;
  hash: string;
  signal?: AbortSignal;
  view: Record<string, unknown>;
  viewId: string;
}): Promise<{ hash: string }> {
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/views.update`,
    {
      body: JSON.stringify({
        hash: input.hash,
        view: input.view,
        view_id: input.viewId,
      }),
      headers: buildSlackHeaders(input.botToken),
      method: "POST",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "views.update");
  return {
    hash: readSlackModalIdentity(response, data, "views.update").hash,
  };
}

function readSlackModalIdentity(
  response: Response,
  data: SlackApiResponse,
  methodName: "views.open" | "views.update"
): { hash: string; viewId: string } {
  const viewId = normalizeOptionalText(data.view?.id);
  if (!viewId) {
    throw new SlackApiError({
      errorCode: "missing_view_id",
      methodName,
      status: response.status,
    });
  }
  const hash = normalizeOptionalText(data.view?.hash);
  if (!hash) {
    throw new SlackApiError({
      errorCode: "missing_view_hash",
      methodName,
      status: response.status,
    });
  }
  return { hash, viewId };
}

export async function setSlackThreadStatus(input: {
  botToken: string;
  channelId: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  status: string;
  threadTs: string;
}): Promise<void> {
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(
      `${SLACK_API_BASE_URL}/assistant.threads.setStatus`,
      {
        body: JSON.stringify({
          channel_id: input.channelId,
          status: input.status,
          thread_ts: input.threadTs,
        }),
        headers: buildSlackHeaders(input.botToken),
        method: "POST",
        signal: input.signal,
      }
    );
  } catch (error) {
    throw new Error(
      `Slack assistant.threads.setStatus failed: ${toErrorMessage(error)}`,
      { cause: error }
    );
  }

  let data: SlackApiResponse;
  try {
    data = await readSlackApiResponse(response);
  } catch (error) {
    throw new Error(
      `Slack assistant.threads.setStatus failed: ${toErrorMessage(error)}`,
      { cause: error }
    );
  }
  assertSlackOk(response, data, "assistant.threads.setStatus");
}

export async function postSlackChannelMessageByName(input: {
  blocks?: readonly SlackBlockKitBlock[];
  botToken: string;
  channelName: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  text: string;
  threadTs?: string;
}): Promise<{
  channelId: string;
  channelName: string;
  joinedChannel: boolean;
  messageTs: string;
}> {
  const target = await resolveSlackChannelMessageTarget({
    botToken: input.botToken,
    channelName: input.channelName,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  });
  const publication = await postSlackChannelMessage({
    ...input,
    target,
    text: await toSlackMrkdwn(input.text),
  });
  return {
    channelId: target.channelId,
    channelName: target.channelName,
    ...publication,
  };
}

export async function resolveSlackChannelMessageTarget(input: {
  botToken: string;
  channelName: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<SlackChannelMessageTarget> {
  const channelName = normalizeSlackChannelName(input.channelName);
  const channel = await findSlackChannelByName({
    botToken: input.botToken,
    channelName,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  });
  if (!channel) {
    throw new Error(
      `I couldn't find #${channelName} in the connected Slack workspace. If it is private, invite the OpenMeld app to that channel first.`
    );
  }
  if (!channel.isMember && channel.isPrivate) {
    throw new Error(
      `I can't join #${channelName} because it is private. Invite the OpenMeld app to that channel first.`
    );
  }
  return {
    channelId: channel.id,
    channelName: channel.name,
    isMember: channel.isMember,
    isPrivate: channel.isPrivate,
  };
}

export async function resolveSlackConversationMessageTargetById(input: {
  botToken: string;
  conversationId: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<SlackChannelMessageTarget> {
  const conversationId = normalizeSlackConversationId(input.conversationId);
  if (!conversationId) {
    throw new Error("Slack conversation ID is invalid.");
  }
  const params = new URLSearchParams({ channel: conversationId });
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/conversations.info?${params.toString()}`,
    {
      headers: buildSlackHeaders(input.botToken),
      method: "GET",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "conversations.info");
  const resolvedChannelId = normalizeOptionalText(data.channel?.id);
  if (resolvedChannelId !== conversationId) {
    throw new Error(
      "Slack conversations.info returned a different conversation identity."
    );
  }
  const isDirectConversation =
    data.channel?.is_im === true || data.channel?.is_mpim === true;
  return {
    channelId: resolvedChannelId,
    channelName:
      normalizeOptionalText(data.channel?.name)?.toLowerCase() ??
      resolvedChannelId,
    isMember: data.channel?.is_member === true || isDirectConversation,
    isPrivate: data.channel?.is_private === true || isDirectConversation,
  };
}

export async function postSlackChannelMessage(input: {
  blocks?: readonly SlackBlockKitBlock[];
  botToken: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  target: SlackChannelMessageTarget;
  text: string;
  threadTs?: string;
}): Promise<{ joinedChannel: boolean; messageTs: string }> {
  let joinedChannel = false;
  if (!input.target.isMember) {
    if (input.target.isPrivate) {
      throw new Error(
        `I can't join #${input.target.channelName} because it is private. Invite the OpenMeld app to that channel first.`
      );
    }
    try {
      await joinSlackPublicChannel({
        botToken: input.botToken,
        channelId: input.target.channelId,
        fetchImpl: input.fetchImpl,
        signal: input.signal,
      });
    } catch (error) {
      throw new SlackMessagePublicationError({
        cause: error,
        errorCode: error instanceof SlackApiError ? error.errorCode : null,
        message: `Slack conversations.join failed before a message was published: ${toErrorMessage(error)}`,
        publicationOutcome: "not_published",
      });
    }
    joinedChannel = true;
  }

  const publication = await postSlackMessage({
    blocks: input.blocks,
    botToken: input.botToken,
    channelId: input.target.channelId,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
    text: input.text,
    ...(input.threadTs ? { threadTs: input.threadTs } : {}),
  });
  return {
    joinedChannel,
    messageTs: publication.id,
  };
}

export async function postSlackFile(input: {
  botToken: string;
  bytes: Uint8Array;
  fetchImpl?: FetchLike;
  initialComment?: string;
  signal?: AbortSignal;
  target: SlackChannelMessageTarget;
  threadTs?: string;
  title?: string;
  fileName: string;
}): Promise<{ fileId: string; joinedChannel: boolean }> {
  if (
    input.bytes.byteLength < 1 ||
    input.bytes.byteLength > CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES
  ) {
    throw new SlackMessagePublicationError({
      message: `Slack files must be between 1 and ${CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES} bytes.`,
      publicationOutcome: "not_published",
    });
  }
  const joinedChannel = await ensureSlackChannelJoinedForPublication(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  let uploadUrl: string;
  let fileId: string;
  try {
    const uploadUrlResponse = await fetchImpl(
      `${SLACK_API_BASE_URL}/files.getUploadURLExternal`,
      {
        body: new URLSearchParams({
          filename: input.fileName,
          length: String(input.bytes.byteLength),
        }),
        headers: {
          authorization: `Bearer ${input.botToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
        signal: input.signal,
      }
    );
    const uploadUrlData = await readSlackApiResponse(uploadUrlResponse);
    assertSlackOk(
      uploadUrlResponse,
      uploadUrlData,
      "files.getUploadURLExternal"
    );
    uploadUrl = requireSlackUploadUrl(uploadUrlData.upload_url);
    fileId = requireSlackFileId(uploadUrlData.file_id);
  } catch (error) {
    throw createNotPublishedSlackFileError(
      "Slack could not prepare the file upload",
      error
    );
  }

  try {
    const uploadBody = new ArrayBuffer(input.bytes.byteLength);
    new Uint8Array(uploadBody).set(input.bytes);
    const uploadResponse = await fetchImpl(uploadUrl, {
      body: uploadBody,
      headers: { "content-type": "application/octet-stream" },
      method: "POST",
      signal: input.signal,
    });
    if (!uploadResponse.ok) {
      throw new Error(`HTTP ${uploadResponse.status}`);
    }
  } catch (error) {
    throw createNotPublishedSlackFileError(
      "Slack did not accept the file bytes",
      error
    );
  }

  let completeResponse: Response;
  try {
    completeResponse = await fetchImpl(
      `${SLACK_API_BASE_URL}/files.completeUploadExternal`,
      {
        body: JSON.stringify({
          channel_id: input.target.channelId,
          files: [
            {
              id: fileId,
              ...(input.title ? { title: input.title } : {}),
            },
          ],
          ...(input.initialComment
            ? { initial_comment: await toSlackMrkdwn(input.initialComment) }
            : {}),
          ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
        }),
        headers: buildSlackHeaders(input.botToken),
        method: "POST",
        signal: input.signal,
      }
    );
  } catch (error) {
    throw createUnknownSlackFilePublicationError(toErrorMessage(error));
  }
  let completed: SlackApiResponse;
  try {
    completed = await readSlackApiResponse(completeResponse);
  } catch (error) {
    throw createUnknownSlackFilePublicationError(toErrorMessage(error));
  }
  if (!(completeResponse.ok && completed.ok === true)) {
    if (completed.ok === false) {
      const error =
        normalizeOptionalText(completed.error) ??
        `HTTP ${completeResponse.status}`;
      throw new SlackMessagePublicationError({
        errorCode: error,
        message: `Slack files.completeUploadExternal failed: ${error}`,
        publicationOutcome: "not_published",
      });
    }
    throw createUnknownSlackFilePublicationError(
      `HTTP ${completeResponse.status}`
    );
  }
  return { fileId, joinedChannel };
}

async function postSlackMessage(input: {
  blocks?: readonly SlackBlockKitBlock[];
  botToken: string;
  channelId: string;
  fetchImpl?: FetchLike;
  metadata?: {
    eventPayload: Record<string, string>;
    eventType: string;
  };
  replyBroadcast?: boolean;
  signal?: AbortSignal;
  text: string;
  threadTs?: string;
}): Promise<{ id: string }> {
  try {
    return await postSlackMessageOnce(input);
  } catch (error) {
    if (input.blocks && isSlackPresentationValidationError(error)) {
      return await postSlackMessageOnce({
        ...input,
        blocks: undefined,
      });
    }
    throw error;
  }
}

async function postSlackMessageOnce(input: {
  blocks?: readonly SlackBlockKitBlock[];
  botToken: string;
  channelId: string;
  fetchImpl?: FetchLike;
  metadata?: {
    eventPayload: Record<string, string>;
    eventType: string;
  };
  replyBroadcast?: boolean;
  signal?: AbortSignal;
  text: string;
  threadTs?: string;
}): Promise<{ id: string }> {
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(
      `${SLACK_API_BASE_URL}/chat.postMessage`,
      {
        body: JSON.stringify({
          ...(input.blocks ? { blocks: input.blocks } : {}),
          channel: input.channelId,
          ...(input.metadata
            ? {
                metadata: {
                  event_payload: input.metadata.eventPayload,
                  event_type: input.metadata.eventType,
                },
              }
            : {}),
          ...(input.replyBroadcast ? { reply_broadcast: true } : {}),
          text: input.text,
          ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
        }),
        headers: buildSlackHeaders(input.botToken),
        method: "POST",
        signal: input.signal,
      }
    );
  } catch (error) {
    throw createUnknownSlackPublicationError(toErrorMessage(error));
  }

  let data: SlackApiResponse;
  try {
    data = await readSlackApiResponse(response);
  } catch (error) {
    throw createUnknownSlackPublicationError(toErrorMessage(error));
  }
  if (response.ok && data.ok === true) {
    const id = normalizeOptionalText(data.ts);
    if (!id) {
      throw createUnknownSlackPublicationError(
        "Slack returned ok without a message timestamp"
      );
    }
    return { id };
  }
  if (data.ok === false) {
    const error =
      normalizeOptionalText(data.error) ?? `HTTP ${response.status}`;
    throw new SlackMessagePublicationError({
      errorCode: error,
      message: `Slack chat.postMessage failed: ${error}`,
      publicationOutcome: "not_published",
    });
  }
  throw createUnknownSlackPublicationError(`HTTP ${response.status}`);
}

function isSlackPresentationValidationError(
  error: unknown
): error is SlackMessagePublicationError {
  return (
    error instanceof SlackMessagePublicationError &&
    error.publicationOutcome === "not_published" &&
    (error.errorCode === "invalid_blocks" ||
      error.errorCode === "invalid_blocks_format" ||
      error.errorCode === "msg_blocks_too_long")
  );
}

async function findSlackChannelByName(input: {
  botToken: string;
  channelName: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<{
  id: string;
  isMember: boolean;
  isPrivate: boolean;
  name: string;
} | null> {
  let cursor: string | null = null;
  for (let page = 0; page < SLACK_CHANNEL_LIST_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      exclude_archived: "true",
      limit: String(SLACK_CHANNEL_LIST_PAGE_LIMIT),
      types: "public_channel,private_channel",
    });
    if (cursor) {
      params.set("cursor", cursor);
    }
    const response = await (input.fetchImpl ?? fetch)(
      `${SLACK_API_BASE_URL}/conversations.list?${params.toString()}`,
      {
        headers: buildSlackHeaders(input.botToken),
        method: "GET",
        signal: input.signal,
      }
    );
    const data = await readSlackApiResponse(response);
    assertSlackOk(response, data, "conversations.list");
    for (const channel of data.channels ?? []) {
      const name = normalizeOptionalText(channel.name)?.toLowerCase();
      const id = normalizeOptionalText(channel.id);
      const matchesName = name === input.channelName;
      const matchesSlackMentionId =
        id?.toLowerCase() === input.channelName.toLowerCase();
      if (
        !(matchesName || matchesSlackMentionId) ||
        channel.is_archived === true
      ) {
        continue;
      }
      if (!(id && name)) {
        throw new Error(
          "Slack conversations.list returned a channel without an ID or name"
        );
      }
      return {
        id,
        isMember: channel.is_member === true,
        isPrivate: channel.is_private === true,
        name,
      };
    }
    cursor = normalizeOptionalText(data.response_metadata?.next_cursor);
    if (!cursor) {
      return null;
    }
  }
  throw new Error(
    `Slack conversations.list exceeded ${SLACK_CHANNEL_LIST_MAX_PAGES} pages while looking for #${input.channelName}`
  );
}

export async function joinSlackPublicChannel(input: {
  botToken: string;
  channelId: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/conversations.join`,
    {
      body: JSON.stringify({ channel: input.channelId }),
      headers: buildSlackHeaders(input.botToken),
      method: "POST",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "conversations.join");
}

export async function postSlackEphemeralMessage(input: {
  blocks?: readonly SlackBlockKitBlock[];
  botToken: string;
  channelId: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  text: string;
  threadTs?: string;
  userId: string;
}): Promise<{ id: string | null }> {
  try {
    return await postSlackEphemeralMessageOnce(input);
  } catch (error) {
    if (
      !(
        input.blocks &&
        error instanceof SlackApiError &&
        SLACK_BLOCK_VALIDATION_ERROR_CODES.has(error.errorCode)
      )
    ) {
      throw error;
    }
    return await postSlackEphemeralMessageOnce({
      botToken: input.botToken,
      channelId: input.channelId,
      fetchImpl: input.fetchImpl,
      signal: input.signal,
      text: input.text,
      ...(input.threadTs ? { threadTs: input.threadTs } : {}),
      userId: input.userId,
    });
  }
}

async function postSlackEphemeralMessageOnce(input: {
  blocks?: readonly SlackBlockKitBlock[];
  botToken: string;
  channelId: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  text: string;
  threadTs?: string;
  userId: string;
}): Promise<{ id: string | null }> {
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/chat.postEphemeral`,
    {
      body: JSON.stringify({
        channel: input.channelId,
        user: input.userId,
        text: input.text,
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
        ...(input.blocks ? { blocks: input.blocks } : {}),
      }),
      headers: buildSlackHeaders(input.botToken),
      method: "POST",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "chat.postEphemeral");
  return { id: normalizeOptionalText(data.message_ts ?? data.ts) };
}

export async function readSlackUserIdentity(input: {
  botToken: string;
  fetchImpl?: FetchLike;
  userId: string;
}): Promise<SlackUserIdentity> {
  const params = new URLSearchParams({ user: input.userId });
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/users.info?${params.toString()}`,
    {
      headers: buildSlackHeaders(input.botToken),
      method: "GET",
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "users.info");
  const displayName =
    normalizeOptionalText(data.user?.profile?.display_name) ??
    normalizeOptionalText(data.user?.profile?.real_name) ??
    normalizeOptionalText(data.user?.real_name) ??
    normalizeOptionalText(data.user?.name);
  return {
    displayName,
    email: normalizeOptionalText(data.user?.profile?.email),
    isDeleted:
      typeof data.user?.deleted === "boolean" ? data.user.deleted : null,
    isRestricted:
      typeof data.user?.is_restricted === "boolean"
        ? data.user.is_restricted
        : null,
    isStranger:
      typeof data.user?.is_stranger === "boolean"
        ? data.user.is_stranger
        : null,
    isUltraRestricted:
      typeof data.user?.is_ultra_restricted === "boolean"
        ? data.user.is_ultra_restricted
        : null,
    teamId: normalizeOptionalText(data.user?.team_id),
  };
}

export function isSlackFullWorkspaceMember(input: {
  identity: SlackUserIdentity;
  slackTeamId: string;
}): boolean {
  return (
    input.identity.isDeleted !== true &&
    input.identity.isRestricted !== true &&
    input.identity.isStranger !== true &&
    input.identity.isUltraRestricted !== true &&
    input.identity.teamId === input.slackTeamId
  );
}

export type SlackConversationInfo = {
  channelName: string | null;
  interactionEnvironment:
    | "externally_shared"
    | "organization_shared"
    | "requester_private";
};

export async function readSlackConversationInfo(input: {
  botToken: string;
  channelId: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<SlackConversationInfo> {
  const params = new URLSearchParams({ channel: input.channelId });
  const response = await (input.fetchImpl ?? fetch)(
    `${SLACK_API_BASE_URL}/conversations.info?${params.toString()}`,
    {
      headers: buildSlackHeaders(input.botToken),
      method: "GET",
      signal: input.signal,
    }
  );
  const data = await readSlackApiResponse(response);
  assertSlackOk(response, data, "conversations.info");
  return {
    channelName: normalizeOptionalText(data.channel?.name),
    interactionEnvironment: resolveSlackInteractionEnvironment(data.channel),
  };
}

function resolveSlackInteractionEnvironment(
  channel: SlackApiResponse["channel"]
): SlackConversationInfo["interactionEnvironment"] {
  if (!channel) {
    return "externally_shared";
  }
  if (
    channel.is_ext_shared === true ||
    (channel?.is_shared === true && channel.is_org_shared !== true)
  ) {
    return "externally_shared";
  }
  if (channel?.is_im === true) {
    return "requester_private";
  }
  return "organization_shared";
}

export async function readSlackUserEmail(input: {
  botToken: string;
  fetchImpl?: FetchLike;
  userId: string;
}): Promise<string | null> {
  return (
    await readSlackUserIdentity({
      botToken: input.botToken,
      fetchImpl: input.fetchImpl,
      userId: input.userId,
    })
  ).email;
}

function toSlackThreadMessages(
  messages: SlackApiResponse["messages"]
): SlackThreadMessage[] {
  return (messages ?? []).flatMap((message) => {
    const ts = normalizeOptionalText(message.ts);
    if (!ts) {
      return [];
    }
    return [
      {
        ...normalizeSlackRichContent(message),
        botId: normalizeOptionalText(message.bot_id),
        displayName:
          normalizeOptionalText(message.bot_profile?.name) ??
          normalizeOptionalText(message.username),
        files: (message.files ?? []).flatMap((file) => {
          const fileId = normalizeOptionalText(file.id);
          if (!fileId) {
            return [];
          }
          return [
            {
              fileId,
              mimeType: normalizeOptionalText(file.mimetype),
              name: normalizeOptionalText(file.name),
              permalink: normalizeOptionalText(file.permalink),
              sizeBytes:
                typeof file.size === "number" &&
                Number.isSafeInteger(file.size) &&
                file.size >= 0
                  ? file.size
                  : null,
            },
          ];
        }),
        subtype: normalizeOptionalText(message.subtype),
        text: normalizeOptionalText(message.text),
        ts,
        userId: normalizeOptionalText(message.user),
      },
    ];
  });
}

// Slack attachment text/fallback are documented provider content, never a new
// request. Preserve their provenance; unknown rich structures stay incomplete.
function normalizeSlackRichContent(
  message: NonNullable<SlackApiResponse["messages"]>[number]
): Pick<SlackThreadMessage, "richContent"> {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) {
    return message.blocks?.length && !normalizeOptionalText(message.text)
      ? { richContent: { text: "", incomplete: true } }
      : {};
  }
  const text = attachments
    .slice(0, 10)
    .map((attachment) => {
      const content =
        normalizeOptionalText(attachment.text) ??
        normalizeOptionalText(attachment.fallback);
      return [
        normalizeOptionalText(attachment.title),
        content,
        normalizeOptionalText(attachment.from_url),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
  // Text is recoverable, but attachments can also contain images, nested files,
  // blocks, and provider-specific previews. Do not call this a complete copy.
  return { richContent: { text, incomplete: true } };
}

function buildSlackMessageHistoryObservation(
  messages: NonNullable<SlackApiResponse["messages"]>,
  messageTs: string
): SlackMessageHistoryObservation {
  return {
    matchingMessageCount: messages.filter(
      (message) => normalizeOptionalText(message.ts) === messageTs
    ).length,
    messageCount: messages.length,
    messages: messages.slice(0, 3).map((message) => ({
      blocksCount: Array.isArray(message.blocks) ? message.blocks.length : 0,
      fieldNames: Object.keys(message).sort().slice(0, 32),
      filesCount: Array.isArray(message.files) ? message.files.length : 0,
      fileFieldNames: (message.files ?? [])
        .slice(0, 10)
        .map((file) => Object.keys(file).sort().slice(0, 32)),
      textLen: typeof message.text === "string" ? message.text.length : 0,
      tsMatches: normalizeOptionalText(message.ts) === messageTs,
    })),
  };
}

function buildSlackHeaders(botToken: string): HeadersInit {
  return {
    authorization: `Bearer ${botToken}`,
    "content-type": "application/json; charset=utf-8",
  };
}

async function readSlackApiResponse(
  response: Response
): Promise<SlackApiResponse> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as SlackApiResponse;
  } catch {
    throw new Error("Slack API returned invalid JSON");
  }
}

function assertSlackOk(
  response: Response,
  data: SlackApiResponse,
  methodName: string
): void {
  if (response.ok && data.ok === true) {
    return;
  }
  const error = normalizeOptionalText(data.error) ?? `HTTP ${response.status}`;
  throw new SlackApiError({
    errorCode: error,
    methodName,
    retryAfterSeconds: parseRetryAfterSeconds(
      response.headers.get("retry-after")
    ),
    status: response.status,
  });
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number.parseInt(value, 10);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSlackSearchContent(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  if (
    !normalized ||
    normalized.length <= CENTER_AGENT_SLACK_SEARCH_CONTENT_MAX_CHARS
  ) {
    return normalized;
  }
  const body = normalized.slice(
    0,
    CENTER_AGENT_SLACK_SEARCH_CONTENT_MAX_CHARS - 1
  );
  const safeBody = SLACK_SEARCH_TRUNCATED_HIGH_SURROGATE_PATTERN.test(body)
    ? body.slice(0, -1)
    : body;
  return `${safeBody}…`;
}

function normalizeSlackPermalink(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  const parsed = slackMessagePermalinkSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function normalizeSlackChannelName(value: string): string {
  const normalized = value
    .trim()
    .replace(SLACK_CHANNEL_NAME_PREFIX_PATTERN, "")
    .toLowerCase();
  if (!normalized) {
    throw new Error("Slack channel name is required");
  }
  return normalized;
}

function normalizeSlackConversationId(value: string): string | null {
  const normalized = value
    .trim()
    .replace(SLACK_CHANNEL_NAME_PREFIX_PATTERN, "");
  return SLACK_CONVERSATION_ID_PATTERN.test(normalized) ? normalized : null;
}

async function ensureSlackChannelJoinedForPublication(input: {
  botToken: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  target: SlackChannelMessageTarget;
}): Promise<boolean> {
  if (input.target.isMember) {
    return false;
  }
  if (input.target.isPrivate) {
    throw new SlackMessagePublicationError({
      message: `I can't join #${input.target.channelName} because it is private. Invite the OpenMeld app to that channel first.`,
      publicationOutcome: "not_published",
    });
  }
  try {
    await joinSlackPublicChannel({
      botToken: input.botToken,
      channelId: input.target.channelId,
      fetchImpl: input.fetchImpl,
      signal: input.signal,
    });
  } catch (error) {
    throw new SlackMessagePublicationError({
      cause: error,
      errorCode: error instanceof SlackApiError ? error.errorCode : null,
      message: `Slack conversations.join failed before a file was published: ${toErrorMessage(error)}`,
      publicationOutcome: "not_published",
    });
  }
  return true;
}

function requireSlackFileMetadata(
  file: SlackApiFile | null | undefined
): SlackFileMetadata {
  const fileId = normalizeOptionalText(file?.id);
  if (!fileId) {
    throw new Error("Slack files.info returned no file identity.");
  }
  return {
    fileId,
    mimeType: normalizeOptionalText(file?.mimetype),
    name: normalizeOptionalText(file?.name),
    permalink: normalizeHttpsUrl(file?.permalink),
    sizeBytes:
      typeof file?.size === "number" &&
      Number.isSafeInteger(file.size) &&
      file.size >= 0
        ? file.size
        : null,
  };
}

function requireSlackPrivateFileDownloadUrl(
  file: SlackApiFile | null | undefined
): string {
  const url = requireSlackOwnedHttpsUrl(
    file?.url_private_download ?? file?.url_private,
    "Slack files.info returned no safe private download URL."
  );
  return url.toString();
}

function slackFileIsSharedInChannel(
  file: SlackApiFile | null | undefined,
  expectedChannelId: string
): boolean {
  const canonicalShares = file?.shares;
  if (
    Object.hasOwn(canonicalShares?.public ?? {}, expectedChannelId) ||
    Object.hasOwn(canonicalShares?.private ?? {}, expectedChannelId)
  ) {
    return true;
  }
  return [file?.channels, file?.groups, file?.ims].some(
    (conversationIds) => conversationIds?.includes(expectedChannelId) === true
  );
}

function requireSlackUploadUrl(value: unknown): string {
  return requireSlackOwnedHttpsUrl(
    value,
    "Slack files.getUploadURLExternal returned no safe upload URL."
  ).toString();
}

function requireSlackOwnedHttpsUrl(value: unknown, errorMessage: string): URL {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(errorMessage);
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(errorMessage);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !(url.hostname === "slack.com" || url.hostname.endsWith(".slack.com"))
  ) {
    throw new Error(errorMessage);
  }
  return url;
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function requireSlackFileId(value: unknown): string {
  const fileId = normalizeOptionalText(value);
  if (!fileId) {
    throw new Error(
      "Slack files.getUploadURLExternal returned no file identity."
    );
  }
  return fileId;
}

async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Slack file is larger than the ${maxBytes}-byte limit.`);
  }
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Slack file is larger than the ${maxBytes}-byte limit.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function createNotPublishedSlackFileError(
  message: string,
  error: unknown
): SlackMessagePublicationError {
  return new SlackMessagePublicationError({
    cause: error,
    errorCode:
      error instanceof SlackApiError ||
      error instanceof SlackMessagePublicationError
        ? error.errorCode
        : null,
    message: `${message}: ${toErrorMessage(error)}`,
    publicationOutcome: "not_published",
  });
}

function createUnknownSlackPublicationError(
  detail: string
): SlackMessagePublicationError {
  return new SlackMessagePublicationError({
    message: `Slack chat.postMessage outcome is unknown: ${detail}`,
    publicationOutcome: "unknown",
  });
}

function createUnknownSlackFilePublicationError(
  detail: string
): SlackMessagePublicationError {
  return new SlackMessagePublicationError({
    message: `Slack file publication outcome is unknown: ${detail}`,
    publicationOutcome: "unknown",
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
