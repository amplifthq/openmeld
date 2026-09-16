import {
  getSpaceEntryResolutionInputSchema,
  getSpaceEntryResolutionResponseSchema,
  spaceReadContextSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import {
  executePublicRpcRoute,
  formatAuditValue,
  respondPublicBadRequest,
} from "./rpc-http.helpers";

const SPACE_ENTRY_RESOLUTION_ROUTE = "/v1/spaces/:spaceId/entry-resolution";

export function registerSpaceEntryResolutionRoute(
  app: Hono<HonoBindings>
): void {
  app.get("/v1/spaces/:spaceId/context", (c) => {
    const parsed = getSpaceEntryResolutionInputSchema.safeParse({
      spaceId: c.req.param("spaceId"),
      signalId: c.req.query("signalId"),
      threadRootSignalId: c.req.query("threadRootSignalId"),
    });
    if (!parsed.success) {
      return c.json({ message: "Invalid Space target." }, 400);
    }
    const spaceId = parsed.data.spaceId;
    return executePublicRpcRoute({
      c,
      route: "/v1/spaces/:spaceId/context",
      method: "GET",
      responseSchema: spaceReadContextSchema,
      execute: async () => {
        const spaceAccess = buildGatewaySpaceAccessContext(c, spaceId);
        // A blocked entry response is intentionally non-disclosing; the content
        // read enforces the same permission and error contract as other reads.
        await c.var.coreRpc.getSpaceBoard({ spaceId, spaceAccess });
        const entry = await c.var.coreRpc.getSpaceEntryResolution({
          ...parsed.data,
          spaceAccess,
        });
        const base = `/v1/spaces/${spaceId}`;
        return {
          target: entry.target,
          resources: [
            ...[
              "board",
              "threads",
              "files",
              "tasks",
              "message-pins",
              "file-pins",
              "history-navigation",
            ].map((rel) => ({ rel, href: `${base}/${rel}` })),
            { rel: "messages", href: `${base}/signals?limit=80` },
            ...(entry.target.signalId
              ? [
                  {
                    rel: "target-context",
                    href: `${base}/signals?aroundSignalId=${encodeURIComponent(entry.target.signalId)}&beforeCount=30&afterCount=30`,
                  },
                ]
              : []),
          ],
          instructions: [
            "These links read current shared Space content. Each request checks access. This document is a directory, not a complete transcript.",
            "Messages are bounded pages. Follow the HTTP Link rel=next URL until absent; nextCursor=null completes that traversal. New messages may arrive afterward. Anchor windows are partial; use messages to traverse the full history.",
            "Thread IDs and rootSignalId identify relationships. Read threads/{threadId}/signals for replies and placements. A reply-only entry target resolves its threadRootSignalId.",
            "Files lists a folder. Follow folders with files?parentId={id}; read files/{id}/content for bytes and files/{id}/revisions for revisions. File links and task sourceSignalId/threadId refer to the same Space records.",
            "Anonymous access is read-only. It creates no account or membership. Private linked Spaces and unpublished Agent internals are not shared. Public reading does not permit indexing or imply consent to model training.",
          ],
        };
      },
    });
  });
  app.get(SPACE_ENTRY_RESOLUTION_ROUTE, (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsed = getSpaceEntryResolutionInputSchema.safeParse({
      spaceId: rawSpaceId,
      signalId: c.req.query("signalId"),
      threadRootSignalId: c.req.query("threadRootSignalId"),
    });
    if (!parsed.success) {
      return respondPublicBadRequest({
        c,
        route: SPACE_ENTRY_RESOLUTION_ROUTE,
        method: "GET",
        code: "invalid_space_id",
        message:
          parsed.error.issues[0]?.message ?? "Invalid Space entry target",
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    return executePublicRpcRoute({
      c,
      route: SPACE_ENTRY_RESOLUTION_ROUTE,
      method: "GET",
      execute: async () => {
        return await c.var.coreRpc.getSpaceEntryResolution({
          ...parsed.data,
          spaceAccess: buildGatewaySpaceAccessContext(c, parsed.data.spaceId),
        });
      },
      responseSchema: getSpaceEntryResolutionResponseSchema,
    });
  });
}
