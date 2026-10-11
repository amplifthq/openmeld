import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  type MessageReadPage,
  type MessageReadRpcInput,
  messageReadPageSchema,
  messageReadRpcInputSchema,
  workspaceMessageReadCursorSchema,
} from "@openmeld/schemas";
import type { CoreBindings } from "../lib/bindings";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { requireRemoteAgentToolCaller } from "../remote-agent/application/remote-agent-tool-caller";
import { createCoreRpcHttpError, readCoreRpcHttpStatus } from "../rpc/errors";
import { rpcListSignals } from "../rpc/methods";
import {
  emptyMessageReadPage,
  messageReadDigest,
  messageReadSelection,
} from "../space/application/message-read";

export async function rpcRemoteAgentReadMessages(
  env: CoreBindings,
  raw: MessageReadRpcInput
) {
  const caller = await requireRemoteAgentToolCaller({
    env,
    context: raw.context,
  });
  const input = parseReadRequest({ ...raw, context: caller.context });
  if (caller.context.actorContext.ownerUserId) {
    return rpcReadMessages(env, input);
  }
  // Center is an Organization-owned Profile, not a Human account member.
  // Its designation was verified above; Space still authorizes every page.
  return readAuthorizedMessages(env, input, {
    organizationId: caller.activeOrganization.organizationId,
    userId: null,
  });
}

/** Shared human/Agent reader. Discovery is not authority: the owning Space checks every read. */
export async function rpcReadMessages(
  env: CoreBindings,
  raw: MessageReadRpcInput
): Promise<MessageReadPage> {
  const input = parseReadRequest(raw);
  const membership = await resolveActiveOrganizationMembership({
    env,
    context: input.context,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      status: membership.status,
      code: membership.code,
      reason: membership.message,
    });
  }
  return readAuthorizedMessages(env, input, membership);
}

async function readAuthorizedMessages(
  env: CoreBindings,
  input: MessageReadRpcInput,
  membership: { organizationId: string; userId: string | null }
): Promise<MessageReadPage> {
  let query = input;
  // Bound source work while avoiding one model/tool round for every empty Space.
  for (let scanned = 0; ; scanned++) {
    const page = await readOneSpacePage(env, query, membership);
    if (
      page.matches.length ||
      page.indexing ||
      !page.nextCursor ||
      scanned === 3
    ) {
      return page;
    }
    query = { ...input, cursor: page.nextCursor };
  }
}

async function readOneSpacePage(
  env: CoreBindings,
  input: MessageReadRpcInput,
  membership: { organizationId: string; userId: string | null }
): Promise<MessageReadPage> {
  const cursor = await resolveWorkspaceCursor(
    input,
    membership.organizationId,
    membership.userId
  );
  const db = getPostgresDatabase(env);
  const agent = input.context.actorContext.profileKind === "agent";
  const candidates = await db.query<{
    space_id: string;
    space_name: string | null;
    direct_message: boolean;
    center_agent: boolean;
  }>({
    text: `SELECT s.space_id, s.space_name, (s.direct_message_pair_key IS NOT NULL AND s.direct_message_converted_at_ms IS NULL) AS direct_message,
      EXISTS (SELECT 1 FROM "openmeld"."center_agent_designations" cad JOIN "openmeld"."space_index_memberships" cm ON cm.profile_id = cad.agent_profile_id AND cm.space_id = s.space_id WHERE cad.organization_id = s.organization_id AND cm.status = 'active' AND s.direct_message_pair_key IS NOT NULL AND s.direct_message_converted_at_ms IS NULL) AS center_agent
      FROM "openmeld"."space_index_spaces" s WHERE s.organization_id = $1 AND s.status IN ('active', 'deleted')
      AND ($2::text IS NOT NULL OR EXISTS (SELECT 1 FROM "openmeld"."space_index_memberships" m WHERE m.space_id = s.space_id AND m.status = 'active' AND ${agent ? "m.profile_id" : "m.owner_user_id_snapshot"} = $3))
      AND ($2::text IS NULL OR s.space_id = $2)
      AND (($4::text IS NOT NULL AND s.space_id >= $4) OR ($4::text IS NULL AND s.space_id > $5))
      ORDER BY s.space_id LIMIT 2`,
    values: [
      membership.organizationId,
      input.spaceId ?? null,
      agent ? input.context.actorContext.openMeldProfileId : membership.userId,
      cursor.pendingSpaceId,
      cursor.afterSpaceId,
    ],
  });
  const space = candidates.rows[0];
  if (!space) {
    if (input.spaceId) {
      throw createCoreRpcHttpError({
        status: 404,
        code: "space.not_found",
        reason: "This conversation is unavailable.",
      });
    }
    return emptyMessageReadPage(input, JSON.stringify(cursor));
  }
  let page: MessageReadPage;
  try {
    const result = await rpcListSignals(env, {
      spaceId: space.space_id,
      context: input.context,
      messageRead: {
        ...messageReadSelection(input),
        spaceId: space.space_id,
        mode: input.mode,
        limit: input.limit,
        maxBytes: input.maxBytes,
        beforeTs: cursor.beforeTs,
        ...(cursor.pendingSpaceId === space.space_id && cursor.spaceCursor
          ? { cursor: cursor.spaceCursor }
          : {}),
      },
    });
    page = messageReadPageSchema.parse(result.messagePage);
  } catch (error) {
    if (
      input.spaceId ||
      ![403, 404].includes(readCoreRpcHttpStatus(error) ?? 0)
    ) {
      throw error;
    }
    page = emptyMessageReadPage(input, null);
  }
  const hasMore = Boolean(page.nextCursor || candidates.rows.length > 1);
  const nextCursor = hasMore
    ? JSON.stringify({
        ...cursor,
        afterSpaceId: space.space_id,
        pendingSpaceId: page.nextCursor ? space.space_id : null,
        spaceCursor: page.nextCursor,
      })
    : null;
  const coverage = nextCursor ? "partial" : "complete";
  const response: MessageReadPage = {
    ...page,
    matches: page.matches.map((match) => ({
      ...match,
      directMessage: space.direct_message,
      centerAgent: space.center_agent,
    })),
    nextCursor,
    pageCursor: JSON.stringify({
      ...cursor,
      pendingSpaceId: space.space_id,
      spaceCursor: page.pageCursor,
    }),
    coverage: page.indexing ? "indexing" : coverage,
  };
  if (
    new TextEncoder().encode(JSON.stringify(response)).length > input.maxBytes
  ) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.read.budget_too_small",
      reason:
        "The response metadata does not fit this budget. Increase maxBytes or narrow this read. No checkpoint advanced.",
    });
  }
  return response;
}

async function resolveWorkspaceCursor(
  input: MessageReadRpcInput,
  organizationId: string,
  userId: string | null
) {
  const queryKey = await messageReadDigest({
    ...messageReadSelection(input),
    organizationId,
    profileId: input.context.actorContext.openMeldProfileId,
    userId,
  });
  let cursor: ReturnType<typeof workspaceMessageReadCursorSchema.parse>;
  try {
    cursor = input.cursor
      ? workspaceMessageReadCursorSchema.parse(JSON.parse(input.cursor))
      : {
          version: 1,
          queryKey,
          afterSpaceId: "",
          pendingSpaceId: null,
          spaceCursor: null,
          beforeTs: Math.min(input.beforeTs ?? Date.now(), Date.now()),
        };
    if (cursor.queryKey !== queryKey) {
      throw new Error("Changed selection");
    }
  } catch {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.read.invalid_cursor",
      reason:
        "This cursor belongs to a different query or account. Start a new read.",
    });
  }
  return cursor;
}

function parseReadRequest(raw: MessageReadRpcInput) {
  const parsed = messageReadRpcInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.read.invalid_query",
      reason: "Use a valid message query and continuation cursor.",
    });
  }
  const input = parsed.data;
  if (!input.spaceId && (!input.q || [...input.q].length < 3)) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.read.scope_required",
      reason:
        "Choose a Space to browse history, or enter at least 3 characters to search conversations.",
    });
  }
  return input;
}
