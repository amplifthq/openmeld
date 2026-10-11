import {
  type MessageReadItem,
  type MessageReadPage,
  type MessageReadQuery,
  signalStatusEnvelopeSchema,
  signalSystemNoticeEnvelopeSchema,
  signalTextEnvelopeSchema,
  spaceMessageReadCursorSchema,
} from "@openmeld/schemas";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import { union } from "zod/v4";
import { createCoreRpcHttpError } from "../../rpc/errors";
import {
  backfillSpaceMessageSearch,
  initializeSpaceMessageSearch,
  querySpaceMessageRows,
} from "../infrastructure/sql/space-message-search-repo";

const encoder = new TextEncoder();
const readableSignalSchema = union([
  signalTextEnvelopeSchema,
  signalStatusEnvelopeSchema,
  signalSystemNoticeEnvelopeSchema,
]);
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

export async function messageReadDigest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(JSON.stringify(value))
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function messageReadSelection(input: MessageReadQuery) {
  return {
    spaceId: input.spaceId,
    q: input.q,
    mode: input.mode,
    fromProfileId: input.fromProfileId,
    afterTs: input.afterTs,
    beforeTs: input.beforeTs,
    threadId: input.threadId,
    signalId: input.signalId,
    includeSystem: input.includeSystem,
  };
}

/** The caller authorizes every page. A cursor freezes membership, not mutable message text. */
export async function readSpaceMessagePage(input: {
  sql: SqlStorage;
  query: MessageReadQuery;
  viewerKey: string;
  spaceName?: string | null;
  afterPosition?: number;
  project: (signal: SignalEnvelope) => SignalEnvelope | undefined;
}): Promise<MessageReadPage> {
  const query = input.query;
  let cursor = await resolveReadCursor(input);
  const page = emptyMessageReadPage(query, JSON.stringify(cursor));
  if (query.q) {
    initializeSpaceMessageSearch(input.sql);
    if (!backfillSpaceMessageSearch(input.sql)) {
      return {
        ...page,
        indexing: true,
        coverage: "indexing",
        nextCursor: JSON.stringify(cursor),
      };
    }
  }
  const rows = querySpaceMessageRows(input.sql, {
    ...query,
    query: query.q,
    before: cursor.before,
    includeBefore: cursor.offset > 0,
    through: cursor.through,
    afterPosition: input.afterPosition,
    limit: Math.min(query.limit, 100),
  });
  if (cursor.offset && rows[0]?.position !== cursor.before) {
    throw changedSource();
  }
  let usedBytes = 0;
  // Reserve room for metadata and both Space and workspace continuation envelopes.
  const contentBudget = query.maxBytes - 1600;
  for (const row of rows) {
    if (page.matches.length >= Math.min(query.limit, 100)) {
      page.nextCursor = JSON.stringify(cursor);
      break;
    }
    const { text, version, offset, itemAt, desiredEnd } = await prepareReadItem(
      input,
      row,
      cursor
    );
    let end = desiredEnd;
    if (page.matches.length && bytes(itemAt(end)) > contentBudget - usedBytes) {
      page.nextCursor = JSON.stringify(cursor);
      break;
    }
    end = fitReadItem(itemAt, text, offset, end, contentBudget - usedBytes);
    const item = itemAt(end);
    page.matches.push(item);
    usedBytes += bytes(item);
    const partial = query.mode === "full" && end < text.length;
    cursor = {
      ...cursor,
      before: row.position,
      offset: partial ? end : 0,
      contentVersion: partial ? version : null,
    };
    if (partial) {
      page.nextCursor = JSON.stringify(cursor);
      break;
    }
  }
  page.returnedCount = page.matches.length;
  page.completeCount = page.matches.filter(
    (item) => item.content.nextOffset === null && query.mode === "full"
  ).length;
  page.coverage = page.nextCursor ? "partial" : "complete";
  return page;
}

function changedSource() {
  return createCoreRpcHttpError({
    status: 409,
    code: "space.read.source_changed",
    reason:
      "The message changed or became unavailable during this read. Start a new read before combining its text.",
  });
}

type ReadInput = Parameters<typeof readSpaceMessagePage>[0];
type ReadCursor = ReturnType<typeof spaceMessageReadCursorSchema.parse>;
async function resolveReadCursor(input: ReadInput): Promise<ReadCursor> {
  const query = input.query;
  const queryKey = await messageReadDigest({
    ...messageReadSelection(query),
    viewer: input.viewerKey,
    deletedThrough: input.afterPosition ?? 0,
  });
  let cursor: ReturnType<typeof spaceMessageReadCursorSchema.parse>;
  try {
    cursor = query.cursor
      ? spaceMessageReadCursorSchema.parse(JSON.parse(query.cursor))
      : {
          version: 1,
          queryKey,
          through: input.sql
            .exec<{ position: number }>(
              "SELECT coalesce(max(rowid), 0) AS position FROM space_signals"
            )
            .one().position,
          before: null,
          offset: 0,
          contentVersion: null,
        };
    if (cursor.queryKey !== queryKey) {
      throw new Error("Changed selection");
    }
  } catch {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.read.invalid_cursor",
      reason:
        "This read cursor belongs to a different query or history boundary. Start a new read.",
    });
  }
  return cursor;
}

async function prepareReadItem(
  input: ReadInput,
  row: ReturnType<typeof querySpaceMessageRows>[number],
  cursor: ReadCursor
) {
  const query = input.query;
  const parsed = readableSignalSchema.safeParse(
    input.project(JSON.parse(row.payload_json))
  );
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 500,
      code: "space.read.invalid_message",
      reason:
        "A message could not be read. No continuation was advanced past it.",
    });
  }
  const signal = parsed.data;
  let text = signal.data.text;
  if (signal.type === "signal.system_notice" && signal.stoppedReplyText) {
    text += `\n\nPartial reply before stop:\n${signal.stoppedReplyText}`;
  }
  // Reactions and avatar updates do not change the text being assembled.
  const version = await messageReadDigest({
    id: signal.id,
    type: signal.type,
    profileId: signal.profile.profileId,
    text,
    status: signal.type === "signal.status" ? signal.data.status : undefined,
    noticeType:
      signal.type === "signal.system_notice"
        ? signal.data.noticeType
        : undefined,
  });
  if (
    cursor.offset > text.length ||
    safeTextBoundary(text, cursor.offset) !== cursor.offset
  ) {
    throw changedSource();
  }
  if (cursor.offset && cursor.contentVersion !== version) {
    throw changedSource();
  }
  let offset =
    cursor.offset ||
    (query.mode === "preview" && query.q
      ? Math.max(
          0,
          text.toLocaleLowerCase().indexOf(query.q.toLocaleLowerCase()) - 100
        )
      : 0);
  const end =
    query.mode === "preview"
      ? Math.min(text.length, offset + 640)
      : text.length;
  offset = safeTextBoundary(text, offset);
  const itemAt = (last: number): MessageReadItem => ({
    signal: {
      v: signal.v,
      id: signal.id,
      spaceId: signal.spaceId,
      ts: signal.ts,
      type: signal.type,
      profile: signal.profile,
      data: {
        text: text.slice(offset, last),
        ...(signal.type === "signal.status"
          ? { status: signal.data.status }
          : {}),
        ...(signal.type === "signal.system_notice"
          ? { noticeType: signal.data.noticeType }
          : {}),
      },
    },
    threadRootSignalId: row.root_signal_id,
    spaceName: input.spaceName ?? null,
    directMessage: false,
    centerAgent: false,
    content: {
      version,
      offset,
      totalChars: text.length,
      nextOffset: last < text.length ? last : null,
      complete: offset === 0 && last === text.length,
    },
  });
  return { text, version, offset, itemAt, desiredEnd: end };
}

function safeTextBoundary(text: string, offset: number) {
  const previous = text.charCodeAt(offset - 1);
  return offset < text.length && previous >= 0xd8_00 && previous <= 0xdb_ff
    ? offset - 1
    : offset;
}

function fitReadItem(
  itemAt: (end: number) => MessageReadItem,
  text: string,
  offset: number,
  end: number,
  budget: number
) {
  let low = offset;
  let high = end;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (bytes(itemAt(mid)) <= budget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  const last = safeTextBoundary(text, low);
  if (
    bytes(itemAt(last)) > budget ||
    (last === offset && text.length > offset)
  ) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.read.budget_too_small",
      reason:
        "The message metadata does not fit this page. Increase maxBytes within the supported budget.",
    });
  }
  return last;
}

export function emptyMessageReadPage(
  query: MessageReadQuery,
  pageCursor: string | null
): MessageReadPage {
  return {
    matches: [],
    nextCursor: null,
    pageCursor,
    indexing: false,
    requestedCount: query.limit,
    returnedCount: 0,
    completeCount: 0,
    limitBytes: query.maxBytes,
    order: "space_then_newest",
    coverage: "complete",
  };
}
