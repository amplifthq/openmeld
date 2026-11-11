import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  centerAgentSessionListCursorSchema,
  type ListCenterAgentSessionsResponse,
  listCenterAgentSessionsResponseSchema,
} from "@openmeld/schemas";
import { isMemberAgentsEnabled } from "../../member-agent/member-agents-feature";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { readConversationDeletionDates } from "../../space/application/conversation-history";
import {
  decodeDirectMessageSessionCursor,
  encodeDirectMessageSessionCursor,
} from "../../space/application/direct-message-session-cursor";
import { listDirectMessageSessionIndexRows } from "../../space-index/space-index-repository";
/** The caller resolves these identities from current Core membership/designation. */
export async function listAuthorizedCenterAgentSessions(input: {
  db: PostgresDatabase;
  organizationId: string;
  memberProfileId: string;
  ownerUserId?: string;
  centerAgentProfileId: string;
  pairKey: string;
  limit: number;
  cursor?: string;
}): Promise<ListCenterAgentSessionsResponse> {
  let before:
    | ReturnType<typeof centerAgentSessionListCursorSchema.parse>
    | undefined;
  if (input.cursor !== undefined) {
    try {
      const parsed = centerAgentSessionListCursorSchema.safeParse(
        decodeDirectMessageSessionCursor(input.cursor)
      );
      if (
        !parsed.success ||
        parsed.data.organizationId !== input.organizationId ||
        parsed.data.pairKey !== input.pairKey
      ) {
        throw new Error("Invalid cursor");
      }
      before = parsed.data;
    } catch {
      throw createCoreRpcHttpError({
        code: "invalid_payload",
        status: 400,
        reason: "This chat-list cursor is invalid. Refresh the chat list.",
      });
    }
  }
  const rows = await listDirectMessageSessionIndexRows({
    db: input.db,
    organizationId: input.organizationId,
    pairKeys: [input.pairKey],
    limit: input.limit + 1,
    // Session archive is a MemberAgent-program operation; with the flag off
    // the Center Agent chat list keeps its previous contents.
    ...(isMemberAgentsEnabled() ? { archived: false } : {}),
    ...(before ? { before } : {}),
  });
  const page = rows.slice(0, input.limit);
  const deletionDates = input.ownerUserId
    ? await readConversationDeletionDates(
        input.db,
        input.ownerUserId,
        page.map((row) => row.spaceId)
      )
    : new Map<string, number>();
  const last = page.at(-1);
  const cursor =
    rows.length > input.limit && last
      ? {
          v: 1 as const,
          organizationId: input.organizationId,
          pairKey: input.pairKey,
          createdAtMs: last.createdAtMs ?? 0,
          spaceId: last.spaceId,
        }
      : null;
  const nextCursor =
    cursor === null ? null : encodeDirectMessageSessionCursor(cursor);
  const response = listCenterAgentSessionsResponseSchema.safeParse({
    generatedAt: new Date().toISOString(),
    organizationId: input.organizationId,
    sessions: page
      .filter((row) => {
        const deletedAt = deletionDates.get(row.spaceId);
        return (
          deletedAt === undefined ||
          (row.messagePreview?.timestamp ?? 0) > deletedAt
        );
      })
      .map((row) => ({
        spaceId: row.spaceId,
        name: row.name,
        ...(row.messagePreview !== undefined
          ? { messagePreview: row.messagePreview }
          : {}),
        createdAt:
          row.createdAtMs === null
            ? null
            : new Date(row.createdAtMs).toISOString(),
        centerAgentProfileId: input.centerAgentProfileId,
        memberProfileId: input.memberProfileId,
        organizationId: input.organizationId,
        kind: "center_agent_direct_message_space" as const,
        isCenterAgentDirectMessageSpace: true as const,
      })),
    nextCursor,
  });
  if (!response.success) {
    throw new Error("Invalid Center Agent session index projection.");
  }
  return response.data;
}
