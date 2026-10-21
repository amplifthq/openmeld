import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  agentDirectMessageSessionListCursorSchema,
  type ListAgentDirectMessageSessionsResponse,
  listAgentDirectMessageSessionsResponseSchema,
} from "@openmeld/schemas";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { listDirectMessageSessionIndexRows } from "../../space-index/space-index-repository";
import { readConversationDeletionDates } from "./conversation-history";
import {
  decodeDirectMessageSessionCursor,
  encodeDirectMessageSessionCursor,
} from "./direct-message-session-cursor";

/**
 * Sessions of one Human–Agent Direct Message pair. The caller resolves the
 * Human from the authenticated context and the agent Profile from current
 * Organization membership; the cursor is a page boundary, never authority.
 */
export async function listAuthorizedAgentDirectMessageSessions(input: {
  db: PostgresDatabase;
  organizationId: string;
  memberProfileId: string;
  ownerUserId: string;
  agentProfileId: string;
  pairKey: string;
  limit: number;
  archived: boolean;
  cursor?: string;
}): Promise<ListAgentDirectMessageSessionsResponse> {
  let before:
    | ReturnType<typeof agentDirectMessageSessionListCursorSchema.parse>
    | undefined;
  if (input.cursor !== undefined) {
    const parsed = (() => {
      try {
        return agentDirectMessageSessionListCursorSchema.safeParse(
          decodeDirectMessageSessionCursor(input.cursor ?? "")
        );
      } catch {
        return null;
      }
    })();
    if (
      !parsed?.success ||
      parsed.data.organizationId !== input.organizationId ||
      parsed.data.pairKey !== input.pairKey ||
      parsed.data.archived !== input.archived
    ) {
      throw createCoreRpcHttpError({
        code: "invalid_payload",
        status: 400,
        reason: "This chat-list cursor is invalid. Refresh the chat list.",
      });
    }
    before = parsed.data;
  }
  const rows = await listDirectMessageSessionIndexRows({
    db: input.db,
    organizationId: input.organizationId,
    pairKey: input.pairKey,
    limit: input.limit + 1,
    archived: input.archived,
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
          pairKey: input.pairKey,
          archived: input.archived,
          createdAtMs: last.createdAtMs ?? 0,
          spaceId: last.spaceId,
        })
      : null;
  const response = listAgentDirectMessageSessionsResponseSchema.safeParse({
    generatedAt: new Date().toISOString(),
    organizationId: input.organizationId,
    agentProfileId: input.agentProfileId,
    memberProfileId: input.memberProfileId,
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
        organizationId: input.organizationId,
        agentProfileId: input.agentProfileId,
        memberProfileId: input.memberProfileId,
        name: row.name,
        createdAt:
          row.createdAtMs === null
            ? null
            : new Date(row.createdAtMs).toISOString(),
        archivedAt:
          row.archivedAtMs === null
            ? null
            : new Date(row.archivedAtMs).toISOString(),
        ...(row.messagePreview !== undefined
          ? { messagePreview: row.messagePreview }
          : {}),
      })),
    nextCursor,
  });
  if (!response.success) {
    throw new Error("Invalid agent Direct Message Session index projection.");
  }
  return response.data;
}
