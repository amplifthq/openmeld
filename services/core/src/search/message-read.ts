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
import { authorizeRemoteAgentExecutionAccess } from "../remote-agent/application/remote-agent-execution-access";
import { requireRemoteAgentToolCaller } from "../remote-agent/application/remote-agent-tool-caller";
import { createCoreRpcHttpError, readCoreRpcHttpStatus } from "../rpc/errors";
import { rpcGetSpaceMemberDirectory, rpcListSignals } from "../rpc/methods";
import {
  emptyMessageReadPage,
  messageReadDigest,
  messageReadSelection,
} from "../space/application/message-read";

const WORKSPACE_SCAN_LIMIT = 4;
const SPACE_READ_CONCURRENCY = 4;
type WorkspaceCursor = ReturnType<
  typeof workspaceMessageReadCursorSchema.parse
>;
type SpaceCandidate = {
  space_id: string;
  space_name: string | null;
  direct_message: boolean;
  center_agent: boolean;
};

export async function rpcRemoteAgentReadMessages(
  env: CoreBindings,
  raw: MessageReadRpcInput
) {
  const caller = await requireRemoteAgentToolCaller({
    env,
    context: raw.context,
  });
  const input = parseReadRequest({ ...raw, context: caller.context });
  const { scope } = await authorizeRemoteAgentExecutionAccess(env, {
    context: caller.context,
    submissionId: caller.context.agentControllerConversationId,
    effect: "read",
  });
  if (
    ("personalExecution" in caller || scope.principal.kind === "agent") &&
    input.spaceId !== scope.spaceId
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "space.read.execution_scope_required",
      reason: "This execution can read only its admitted conversation.",
    });
  }
  return readAuthorizedMessages(env, input, {
    organizationId: caller.activeOrganization.organizationId,
    userId: scope.principal.kind === "agent" ? null : scope.principal.userId,
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
  const cursor = await resolveWorkspaceCursor(
    input,
    membership.organizationId,
    membership.userId
  );
  const db = getPostgresDatabase(env);
  const agent = input.context.actorContext.profileKind === "agent";
  const candidates = await db.query<SpaceCandidate>({
    text: `SELECT s.space_id, s.space_name, (s.direct_message_pair_key IS NOT NULL AND s.direct_message_converted_at_ms IS NULL) AS direct_message,
      EXISTS (SELECT 1 FROM "openmeld"."center_agent_designations" cad JOIN "openmeld"."space_index_memberships" cm ON cm.profile_id = cad.agent_profile_id AND cm.space_id = s.space_id WHERE cad.organization_id = s.organization_id AND cm.status = 'active' AND s.direct_message_pair_key IS NOT NULL AND s.direct_message_converted_at_ms IS NULL) AS center_agent
      FROM "openmeld"."space_index_spaces" s WHERE s.organization_id = $1 AND s.status IN ('active', 'deleted')
      AND ($2::text IS NOT NULL OR EXISTS (SELECT 1 FROM "openmeld"."space_index_memberships" m WHERE m.space_id = s.space_id AND m.status = 'active' AND ${agent ? "m.profile_id" : "m.owner_user_id_snapshot"} = $3))
      AND ($2::text IS NULL OR s.space_id = $2)
      AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM "openmeld"."space_index_memberships" r WHERE r.space_id = s.space_id AND r.status = 'active' AND r.owner_user_id_snapshot = $6))
      AND (($4::text IS NOT NULL AND s.space_id >= $4) OR ($4::text IS NULL AND s.space_id > $5))
      ORDER BY s.space_id LIMIT $7`,
    values: [
      membership.organizationId,
      input.spaceId ?? null,
      agent ? input.context.actorContext.openMeldProfileId : membership.userId,
      cursor.pendingSpaceId,
      cursor.afterSpaceId,
      agent ? membership.userId : null,
      WORKSPACE_SCAN_LIMIT + 1,
    ],
  });
  if (!candidates.rows.length) {
    if (input.spaceId) {
      throw createCoreRpcHttpError({
        status: 404,
        code: "space.not_found",
        reason: "This conversation is unavailable.",
      });
    }
    return emptyMessageReadPage(input, JSON.stringify(cursor));
  }
  const scanCount = Math.min(candidates.rows.length, WORKSPACE_SCAN_LIMIT);
  for (let start = 0; start < scanCount; ) {
    const continuingSpace =
      start === 0 && cursor.pendingSpaceId === candidates.rows[0]?.space_id;
    const end = Math.min(
      start + (continuingSpace ? 1 : SPACE_READ_CONCURRENCY),
      scanCount
    );
    // Settle the whole wave before returning: PostgreSQL connections belong to
    // this request. Consume in directory order, never in completion order.
    const results = await Promise.allSettled(
      candidates.rows.slice(start, end).map((space, offset) => {
        const index = start + offset;
        const previous = candidates.rows[index - 1];
        return readOneSpacePage(env, input, membership.userId, space, {
          cursor: previous
            ? {
                ...cursor,
                afterSpaceId: previous.space_id,
                pendingSpaceId: null,
                spaceCursor: null,
              }
            : cursor,
          hasNextSpace: index + 1 < candidates.rows.length,
        });
      })
    );
    for (const [offset, result] of results.entries()) {
      if (result.status === "rejected") {
        throw result.reason;
      }
      const { page, hasSpaceContinuation } = result.value;
      if (
        page.matches.length ||
        page.indexing ||
        !page.nextCursor ||
        start + offset + 1 === scanCount ||
        hasSpaceContinuation
      ) {
        return page;
      }
    }
    start = end;
  }
  throw new Error("Expected at least one message read candidate");
}

async function readOneSpacePage(
  env: CoreBindings,
  input: MessageReadRpcInput,
  userId: string | null,
  space: SpaceCandidate,
  options: { cursor: WorkspaceCursor; hasNextSpace: boolean }
): Promise<{ page: MessageReadPage; hasSpaceContinuation: boolean }> {
  const { cursor, hasNextSpace } = options;
  let page: MessageReadPage;
  try {
    const context = await resolveMessageViewer(
      env,
      input.context,
      space.space_id,
      userId
    );
    const result = await rpcListSignals(env, {
      spaceId: space.space_id,
      context,
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
  const hasMore = Boolean(page.nextCursor || hasNextSpace);
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
  assertReadResponseBudget(response, input.maxBytes);
  return { page: response, hasSpaceContinuation: Boolean(page.nextCursor) };
}

function assertReadResponseBudget(response: MessageReadPage, maxBytes: number) {
  if (new TextEncoder().encode(JSON.stringify(response)).length > maxBytes) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.read.budget_too_small",
      reason:
        "The response metadata does not fit this budget. Increase maxBytes or narrow this read. No checkpoint advanced.",
    });
  }
}

async function resolveMessageViewer(
  env: CoreBindings,
  context: MessageReadRpcInput["context"],
  spaceId: string,
  userId: string | null
): Promise<MessageReadRpcInput["context"]> {
  if (context.actorContext.profileKind !== "agent" || !userId) {
    return context;
  }
  // Space authorizes the Agent first, then reads with the requester's current
  // Human Profile and history boundary. Discovery alone cannot grant access.
  const directory = await rpcGetSpaceMemberDirectory(env, { spaceId, context });
  const requester = directory.members.find(
    (member) => member.profileKind === "human" && member.ownerUserId === userId
  );
  if (!requester) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "space.read.requester_access_required",
      reason: "The requester no longer has access to this conversation.",
    });
  }
  return {
    activeOrganizationId: context.activeOrganizationId,
    actorContext: {
      requestId: context.actorContext.requestId,
      callerPrincipalId: userId,
      ownerUserId: userId,
      openMeldProfileId: requester.profileId,
      profileKind: "human",
    },
  };
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
