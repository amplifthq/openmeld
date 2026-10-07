import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
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
import type { CoreBindings } from "../lib/bindings";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError, readCoreRpcHttpStatus } from "../rpc/errors";
import { rpcListSignals } from "../rpc/methods";

type Candidate = {
  space_id: string;
  space_name: string | null;
  direct_message: boolean;
  center_agent: boolean;
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
  const db = getPostgresDatabase(env);
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
  const rows = await db.query<Candidate>({
    text: `SELECT s.space_id, s.space_name,
    (s.direct_message_pair_key IS NOT NULL AND s.direct_message_converted_at_ms IS NULL) AS direct_message,
    EXISTS (SELECT 1 FROM "openmeld"."center_agent_designations" cad
      JOIN "openmeld"."space_index_memberships" cm ON cm.profile_id = cad.agent_profile_id AND cm.space_id = s.space_id
      WHERE cad.organization_id = s.organization_id AND cm.status = 'active'
        AND s.direct_message_pair_key IS NOT NULL AND s.direct_message_converted_at_ms IS NULL) AS center_agent
    FROM "openmeld"."space_index_spaces" s WHERE s.organization_id = $1 AND s.status = 'active'
      AND ($2::text IS NOT NULL OR EXISTS (SELECT 1 FROM "openmeld"."space_index_memberships" m WHERE m.space_id = s.space_id AND m.status = 'active' AND m.owner_user_id_snapshot = $3))
      AND ($4::text IS NULL OR s.space_id = $5)
      AND ($6::text[] IS NULL OR s.space_id = ANY($6))
      AND ($6::text[] IS NOT NULL OR s.space_id > $7)
    ORDER BY s.space_id LIMIT 4`,
    values: [
      membership.organizationId,
      selectedSpaceId,
      membership.userId,
      selectedSpaceId,
      selectedSpaceId,
      ids.length ? ids : null,
      cursor.afterSpaceId,
    ],
  });
  const pages = await Promise.all(
    rows.rows.map(async (space) => {
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
    : (rows.rows.at(-1)?.space_id ?? cursor.afterSpaceId);
  return {
    activities: [],
    matches,
    indexing,
    nextCursor: hasMoreSearchPages(
      pending.length,
      input.spaceId,
      ids.length,
      rows.rows.length
    )
      ? JSON.stringify({ afterSpaceId, pending, activitiesDone: true })
      : null,
  };
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
  db: PostgresDatabase,
  membership: {
    organizationId: string;
    userId: string;
    role: string;
  },
  query: string,
  before?: number
): Promise<MessageSearchResponse> {
  const rows = await db.query<
    InboxItemRow & {
      search_sequence: number;
    }
  >({
    text: `SELECT inbox_items.*, sequence AS search_sequence FROM "openmeld"."inbox_items"
    WHERE (organization_id = $1 OR organization_id IS NULL) AND recipient_user_id = $2 AND cleared_at_ms IS NULL
      AND (source_kind != 'space_signal' OR ((source_target_json)::jsonb #>> '{signalId}') IS NULL)
      AND ($3::bigint IS NULL OR sequence < $4)
      AND strpos(lower(title || ' ' || coalesce(preview, '')), lower($5)) > 0
      AND ${buildCurrentInboxSourceAccessSql("inbox_items", membership.role === "owner" || membership.role === "admin")}
    ORDER BY sequence DESC NULLS LAST LIMIT 31`,
    values: [
      membership.organizationId,
      membership.userId,
      before ?? null,
      before ?? null,
      query,
    ],
  });
  const page = rows.rows.slice(0, 30);
  return {
    matches: [],
    indexing: false,
    activities: page.map(mapInboxItemRow),
    nextCursor: JSON.stringify({
      afterSpaceId: "",
      pending: [],
      activitiesDone: rows.rows.length <= 30,
      ...(rows.rows.length > 30
        ? { activityBefore: page.at(-1)?.search_sequence }
        : {}),
    }),
  };
}
async function matchPage(input: {
  db: PostgresDatabase;
  scope: MessageSearchRpcInput["scope"];
  membership: {
    organizationId: string;
    userId: string;
    role: string;
  };
  space: Candidate;
  page: ReturnType<typeof spaceMessageSearchResponseSchema.parse>;
}): Promise<MessageSearchResponse["matches"]> {
  const { db, scope, membership, space, page } = input;
  let inboxIds = new Map<string, string>();
  if (scope === "inbox" && page.signals.length) {
    const items = await db.query<{
      id: string;
      signal_id: string;
    }>({
      text: `SELECT id, ((source_target_json)::jsonb #>> '{signalId}') AS signal_id FROM "openmeld"."inbox_items"
      WHERE organization_id = $1 AND recipient_user_id = $2 AND cleared_at_ms IS NULL
        AND ((source_target_json)::jsonb #>> '{spaceId}') = $3
        AND ((source_target_json)::jsonb #>> '{signalId}') = ANY($4::text[])
        AND ${buildCurrentInboxSourceAccessSql("inbox_items", membership.role === "owner" || membership.role === "admin")}`,
      values: [
        membership.organizationId,
        membership.userId,
        space.space_id,
        page.signals.map((signal) => signal.id),
      ],
    });
    inboxIds = new Map(items.rows.map((item) => [item.signal_id, item.id]));
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
