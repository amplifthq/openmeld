import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  type ListMemberAgentDirectMessageSessionsResponse,
  listMemberAgentDirectMessageSessionsResponseSchema,
  memberAgentDirectMessageSessionListCursorSchema,
} from "@openmeld/schemas";
import { buildDirectMessagePairKey } from "@openmeld/space";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { listDirectMessageSessionIndexRows } from "../../space-index/space-index-repository";
import { readConversationDeletionDates } from "./conversation-history";
import {
  decodeDirectMessageSessionCursor,
  encodeDirectMessageSessionCursor,
} from "./direct-message-session-cursor";

/**
 * Sessions of the Human with each of the given agent Profiles, active and
 * archived, newest first, as one list. The caller passes the Human from the
 * authenticated context and the Profiles of that Human's own MemberAgents;
 * the cursor is a page boundary, never authority.
 */
export async function listAuthorizedMemberAgentDirectMessageSessions(input: {
  db: PostgresDatabase;
  organizationId: string;
  memberProfileId: string;
  ownerUserId: string;
  agentProfileIds: readonly string[];
  limit: number;
  cursor?: string;
}): Promise<ListMemberAgentDirectMessageSessionsResponse> {
  const before =
    input.cursor === undefined
      ? undefined
      : parseCursor({
          cursor: input.cursor,
          organizationId: input.organizationId,
          memberProfileId: input.memberProfileId,
        });
  const agentProfileIdByPairKey = new Map(
    input.agentProfileIds.map((agentProfileId) => [
      buildDirectMessagePairKey(input.memberProfileId, agentProfileId),
      agentProfileId,
    ])
  );
  const rows = await listDirectMessageSessionIndexRows({
    db: input.db,
    organizationId: input.organizationId,
    pairKeys: [...agentProfileIdByPairKey.keys()],
    limit: input.limit + 1,
    ...(before ? { before } : {}),
  });
  const page = rows.slice(0, input.limit);
  const deletionDates = await readConversationDeletionDates(
    input.db,
    input.ownerUserId,
    page.map((row) => row.spaceId)
  );
  const last = page.at(-1);
  const nextCursor =
    rows.length > input.limit && last
      ? encodeDirectMessageSessionCursor({
          v: 1,
          organizationId: input.organizationId,
          memberProfileId: input.memberProfileId,
          createdAtMs: last.createdAtMs ?? 0,
          spaceId: last.spaceId,
        })
      : null;
  const response = listMemberAgentDirectMessageSessionsResponseSchema.safeParse(
    {
      generatedAt: new Date().toISOString(),
      organizationId: input.organizationId,
      memberProfileId: input.memberProfileId,
      sessions: page.flatMap((row) => {
        const agentProfileId = agentProfileIdByPairKey.get(row.pairKey);
        const deletedAt = deletionDates.get(row.spaceId);
        const visible =
          deletedAt === undefined ||
          (row.messagePreview?.timestamp ?? 0) > deletedAt;
        return agentProfileId && visible
          ? [
              {
                spaceId: row.spaceId,
                agentProfileId,
                name: row.name,
                archivedAt:
                  row.archivedAtMs === null
                    ? null
                    : new Date(row.archivedAtMs).toISOString(),
              },
            ]
          : [];
      }),
      nextCursor,
    }
  );
  if (!response.success) {
    throw new Error(
      "Invalid MemberAgent Direct Message Session index projection."
    );
  }
  return response.data;
}

function parseCursor(input: {
  cursor: string;
  organizationId: string;
  memberProfileId: string;
}): { createdAtMs: number; spaceId: string } {
  const parsed = (() => {
    try {
      return memberAgentDirectMessageSessionListCursorSchema.safeParse(
        decodeDirectMessageSessionCursor(input.cursor)
      );
    } catch {
      return null;
    }
  })();
  if (
    !parsed?.success ||
    parsed.data.organizationId !== input.organizationId ||
    parsed.data.memberProfileId !== input.memberProfileId
  ) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      status: 400,
      reason: "This chat-list cursor is invalid. Refresh the chat list.",
    });
  }
  return parsed.data;
}
