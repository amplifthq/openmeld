import {
  type MessageSearchResponse,
  type MessageSearchRpcInput,
  messageSearchCursorSchema,
  messageSearchRpcInputSchema,
  spaceMessageSearchResponseSchema,
} from "@openmeld/schemas";
import {
  type InboxItemRow,
  mapInboxItemRow,
} from "../inbox/application/inbox-service";
import { buildCurrentInboxSourceAccessSql } from "../inbox/application/inbox-source-access";
import { type CoreBindings, inboxDb, localStateDb } from "../lib/bindings";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError, readCoreRpcHttpStatus } from "../rpc/errors";
import { rpcListSignals } from "../rpc/methods";

type Candidate = {
  space_id: string;
  space_name: string | null;
  direct_message: number;
  center_agent: number;
};

/** Bounded federation: the directory selects candidates; each Space authorizes and searches its own current messages. */
export async function rpcSearchMessages(
  env: CoreBindings,
  raw: MessageSearchRpcInput
): Promise<MessageSearchResponse> {
  const input = messageSearchRpcInputSchema.parse(raw);
  const membership = await resolveActiveOrganizationMembership({
    env,
    context: input.context,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      status: membership.status,
      reason: membership.message,
    });
  }
  const db = searchDatabase(env, input.scope);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Message search is temporarily unavailable.",
    });
  }
  const cursor = readCursor(input.cursor);
  if (shouldSearchActivities(input.scope, cursor.activitiesDone)) {
    return searchInboxActivities(
      db,
      membership,
      input.q,
      cursor.activityBefore
    );
  }
  const ids = cursor.pending.map((item) => item.spaceId);
  const selectedSpaceId = input.spaceId ?? null;
  const rows = await db
    .prepare(`SELECT s.space_id, s.space_name,
    (s.direct_message_pair_key IS NOT NULL AND s.direct_message_converted_at_ms IS NULL) AS direct_message,
    EXISTS (SELECT 1 FROM center_agent_designations cad
      JOIN space_index_memberships cm ON cm.profile_id = cad.agent_profile_id AND cm.space_id = s.space_id
      WHERE cad.organization_id = s.organization_id AND cm.status = 'active'
        AND s.direct_message_pair_key IS NOT NULL AND s.direct_message_converted_at_ms IS NULL) AS center_agent
    FROM space_index_spaces s WHERE s.organization_id = ? AND s.status = 'active'
      AND (? IS NOT NULL OR EXISTS (SELECT 1 FROM space_index_memberships m WHERE m.space_id = s.space_id AND m.status = 'active' AND m.owner_user_id_snapshot = ?))
      AND (? IS NULL OR s.space_id = ?)
      AND ${ids.length ? `s.space_id IN (${ids.map(() => "?").join(",")})` : "s.space_id > ?"}
    ORDER BY s.space_id LIMIT 4`)
    .bind(
      membership.organizationId,
      selectedSpaceId,
      membership.userId,
      selectedSpaceId,
      selectedSpaceId,
      ...(ids.length ? ids : [cursor.afterSpaceId])
    )
    .all<Candidate>();
  const pages = await Promise.all(
    rows.results.map(async (space) => {
      const previous = cursor.pending.find(
        (item) => item.spaceId === space.space_id
      )?.cursor;
      try {
        const page = spaceMessageSearchResponseSchema.parse(
          await rpcListSignals(env, {
            spaceId: space.space_id,
            q: input.q,
            cursor: previous,
            limit: 30,
            context: input.context,
          })
        );
        return { space, page, previous };
      } catch (error) {
        const status = readCoreRpcHttpStatus(error);
        if (status === 403 || status === 404) {
          return null;
        }
        throw error;
      }
    })
  );
  const matches: MessageSearchResponse["matches"] = [];
  const pending: typeof cursor.pending = [];
  let indexing = false;
  for (const result of pages) {
    if (!result) {
      continue;
    }
    const { space, page, previous } = result;
    indexing ||= page.searchIndexing;
    if (page.searchIndexing || page.nextCursor) {
      pending.push({
        spaceId: space.space_id,
        cursor: page.searchIndexing ? previous : (page.nextCursor ?? undefined),
      });
    }
    matches.push(
      ...(await matchPage({ db, scope: input.scope, membership, space, page }))
    );
  }
  const afterSpaceId = ids.length
    ? cursor.afterSpaceId
    : (rows.results.at(-1)?.space_id ?? cursor.afterSpaceId);
  return {
    activities: [],
    matches,
    indexing,
    nextCursor: hasMoreSearchPages(
      pending.length,
      input.spaceId,
      ids.length,
      rows.results.length
    )
      ? JSON.stringify({ afterSpaceId, pending, activitiesDone: true })
      : null,
  };
}

function searchDatabase(
  env: CoreBindings,
  scope: MessageSearchRpcInput["scope"]
) {
  return scope === "inbox" ? inboxDb(env) : localStateDb(env);
}

function shouldSearchActivities(
  scope: MessageSearchRpcInput["scope"],
  complete: boolean
): boolean {
  return scope === "inbox" && !complete;
}

function hasMoreSearchPages(
  pending: number,
  spaceId: string | undefined,
  previousPending: number,
  candidateCount: number
): boolean {
  return (
    pending > 0 || (!spaceId && (previousPending > 0 || candidateCount === 4))
  );
}

function readCursor(
  value: string | undefined
): ReturnType<typeof messageSearchCursorSchema.parse> {
  if (!value) {
    return { afterSpaceId: "", pending: [], activitiesDone: false };
  }
  try {
    return messageSearchCursorSchema.parse(JSON.parse(value));
  } catch {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid message search cursor.",
    });
  }
}

async function searchInboxActivities(
  db: D1Database,
  membership: { organizationId: string; userId: string; role: string },
  query: string,
  before?: number
): Promise<MessageSearchResponse> {
  const rows = await db
    .prepare(`SELECT inbox_items.*, rowid AS search_rowid FROM inbox_items
    WHERE (organization_id = ? OR organization_id IS NULL) AND recipient_user_id = ? AND cleared_at_ms IS NULL
      AND (source_kind != 'space_signal' OR json_extract(source_target_json, '$.signalId') IS NULL)
      AND (? IS NULL OR rowid < ?)
      AND instr(lower(title || ' ' || coalesce(preview, '')), lower(?)) > 0
      AND ${buildCurrentInboxSourceAccessSql("inbox_items", membership.role === "owner" || membership.role === "admin")}
    ORDER BY rowid DESC LIMIT 31`)
    .bind(
      membership.organizationId,
      membership.userId,
      before ?? null,
      before ?? null,
      query
    )
    .all<InboxItemRow & { search_rowid: number }>();
  const page = rows.results.slice(0, 30);
  return {
    matches: [],
    indexing: false,
    activities: page.map(mapInboxItemRow),
    nextCursor: JSON.stringify({
      afterSpaceId: "",
      pending: [],
      activitiesDone: rows.results.length <= 30,
      ...(rows.results.length > 30
        ? { activityBefore: page.at(-1)?.search_rowid }
        : {}),
    }),
  };
}

async function matchPage(input: {
  db: D1Database;
  scope: MessageSearchRpcInput["scope"];
  membership: { organizationId: string; userId: string; role: string };
  space: Candidate;
  page: ReturnType<typeof spaceMessageSearchResponseSchema.parse>;
}): Promise<MessageSearchResponse["matches"]> {
  const { db, scope, membership, space, page } = input;
  let inboxIds = new Map<string, string>();
  if (scope === "inbox" && page.signals.length) {
    const items = await db
      .prepare(`SELECT id, json_extract(source_target_json, '$.signalId') AS signal_id FROM inbox_items
      WHERE organization_id = ? AND recipient_user_id = ? AND cleared_at_ms IS NULL
        AND json_extract(source_target_json, '$.spaceId') = ?
        AND json_extract(source_target_json, '$.signalId') IN (${page.signals.map(() => "?").join(",")})
        AND ${buildCurrentInboxSourceAccessSql("inbox_items", membership.role === "owner" || membership.role === "admin")}`)
      .bind(
        membership.organizationId,
        membership.userId,
        space.space_id,
        ...page.signals.map((signal) => signal.id)
      )
      .all<{ id: string; signal_id: string }>();
    inboxIds = new Map(items.results.map((item) => [item.signal_id, item.id]));
  }
  return page.signals.flatMap((signal) => {
    const inboxItemId = inboxIds.get(signal.id);
    if (scope === "inbox" && !inboxItemId) {
      return [];
    }
    return [
      {
        signal,
        threadRootSignalId: page.threadRoots[signal.id] ?? null,
        spaceName: space.space_name,
        directMessage: Boolean(space.direct_message),
        centerAgent: Boolean(space.center_agent),
        ...(inboxItemId ? { inboxItemId } : {}),
      },
    ];
  });
}
