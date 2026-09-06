import {
  centerAgentSessionListCursorSchema,
  type ListCenterAgentSessionsResponse,
  listCenterAgentSessionsResponseSchema,
} from "@openmeld/schemas";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { listCenterAgentSessionIndexRows } from "../../space-index/space-index-repository";

/** The caller resolves these identities from current Core membership/designation. */
export async function listAuthorizedCenterAgentSessions(input: {
  db: D1Database;
  organizationId: string;
  memberProfileId: string;
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
      const bytes = Uint8Array.from(
        atob(input.cursor.replace(/-/g, "+").replace(/_/g, "/")),
        (character) => character.charCodeAt(0)
      );
      const parsed = centerAgentSessionListCursorSchema.safeParse(
        JSON.parse(new TextDecoder().decode(bytes))
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
  const rows = await listCenterAgentSessionIndexRows({
    db: input.db,
    organizationId: input.organizationId,
    pairKey: input.pairKey,
    limit: input.limit + 1,
    ...(before ? { before } : {}),
  });
  const page = rows.slice(0, input.limit);
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
    cursor === null
      ? null
      : btoa(
          String.fromCharCode(
            ...new TextEncoder().encode(JSON.stringify(cursor))
          )
        )
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/g, "");
  const response = listCenterAgentSessionsResponseSchema.safeParse({
    generatedAt: new Date().toISOString(),
    organizationId: input.organizationId,
    sessions: page.map((row) => ({
      spaceId: row.spaceId,
      name: row.name,
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
