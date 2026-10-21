import {
  deleteAgentDirectMessageSessionResponseSchema,
  listAgentDirectMessageSessionsQuerySchema,
  listAgentDirectMessageSessionsResponseSchema,
  updateAgentDirectMessageSessionBodySchema,
  updateAgentDirectMessageSessionResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  buildCoreRpcCredential,
  executeRpcRoute,
  parseJsonBody,
  respondBadRequest,
} from "./rpc-http.helpers";

// Agent Direct Message Sessions: list one Human–Agent pair's Sessions and the
// dedicated rename, archive, and delete operations (MemberAgent program).
const DIRECT_MESSAGE_SESSIONS_ROUTE =
  "/v1/organizations/current/direct-message-sessions";
const DIRECT_MESSAGE_SESSION_ROUTE = `${DIRECT_MESSAGE_SESSIONS_ROUTE}/:spaceId`;

export function registerDirectMessageSessionRoutes(
  app: Hono<HonoBindings>
): void {
  app.get(DIRECT_MESSAGE_SESSIONS_ROUTE, async (c) => {
    const cursor = c.req.query("cursor");
    const limit = c.req.query("limit");
    const archived = c.req.query("archived");
    const parsed = listAgentDirectMessageSessionsQuerySchema.safeParse({
      agentProfileId: c.req.query("agentProfileId"),
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
      ...(archived === undefined ? {} : { archived: archived === "true" }),
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: DIRECT_MESSAGE_SESSIONS_ROUTE,
        method: "GET",
        message: "Provide a valid Agent, chat-list cursor and limit.",
      });
    }
    return await executeRpcRoute({
      c,
      route: DIRECT_MESSAGE_SESSIONS_ROUTE,
      method: "GET",
      responseSchema: listAgentDirectMessageSessionsResponseSchema,
      execute: async () =>
        await c.var.coreRpc.listAgentDirectMessageSessions({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.patch(DIRECT_MESSAGE_SESSION_ROUTE, async (c) => {
    const parsed = await parseJsonBody(
      c,
      updateAgentDirectMessageSessionBodySchema
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    const spaceId = c.req.param("spaceId");
    return await executeRpcRoute({
      c,
      route: DIRECT_MESSAGE_SESSION_ROUTE,
      method: "PATCH",
      spaceId,
      responseSchema: updateAgentDirectMessageSessionResponseSchema,
      execute: async () =>
        await c.var.coreRpc.updateAgentDirectMessageSession({
          requestCredential: await buildCoreRpcCredential(c),
          spaceId,
          update: parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.delete(DIRECT_MESSAGE_SESSION_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");
    return executeRpcRoute({
      c,
      route: DIRECT_MESSAGE_SESSION_ROUTE,
      method: "DELETE",
      spaceId,
      responseSchema: deleteAgentDirectMessageSessionResponseSchema,
      execute: async () =>
        await c.var.coreRpc.deleteAgentDirectMessageSession({
          requestCredential: await buildCoreRpcCredential(c),
          spaceId,
          context: buildCoreRpcContext(c),
        }),
    });
  });
}
