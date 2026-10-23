import {
  getMemberAgentPresenceResponseSchema,
  listMemberAgentDirectMessageSessionsQuerySchema,
  listMemberAgentDirectMessageSessionsResponseSchema,
  MEMBER_AGENT_DIRECT_MESSAGE_SESSIONS_ROUTE,
  MEMBER_AGENT_PRESENCE_ROUTE,
  MEMBER_AGENT_SYNC_ROUTE,
  syncMemberAgentsRequestSchema,
  syncMemberAgentsResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  parseJsonBody,
  respondBadRequest,
} from "./rpc-http.helpers";

// MemberAgent catalog sync and derived presence for the signed-in member's
// current Organization. Web calls the sync when the member opens the Agents
// or Direct Message surface, and setup or "add" calls it with the chosen
// Harnesses; both are no-store owner reads/writes.
export function registerMemberAgentRoutes(app: Hono<HonoBindings>): void {
  app.post(MEMBER_AGENT_SYNC_ROUTE, async (c) => {
    // Every Harness turned on in Local agents gets an Agent; `createHarnessKinds`
    // names the ones the member just chose ("add" turns a turned-off one on).
    const parsed = await parseJsonBody(c, syncMemberAgentsRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    return executeRpcRoute({
      c,
      route: MEMBER_AGENT_SYNC_ROUTE,
      method: "POST",
      responseSchema: syncMemberAgentsResponseSchema,
      execute: () =>
        c.var.coreRpc.syncMemberAgents({
          context: buildCoreRpcContext(c),
          createHarnessKinds: parsed.data.createHarnessKinds,
        }),
    });
  });
  app.get(MEMBER_AGENT_PRESENCE_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: MEMBER_AGENT_PRESENCE_ROUTE,
      method: "GET",
      responseSchema: getMemberAgentPresenceResponseSchema,
      execute: () =>
        c.var.coreRpc.getMemberAgentPresence({
          context: buildCoreRpcContext(c),
        }),
    })
  );
  // Every Session with the member's own MemberAgents in one list.
  app.get(MEMBER_AGENT_DIRECT_MESSAGE_SESSIONS_ROUTE, async (c) => {
    const cursor = c.req.query("cursor");
    const limit = c.req.query("limit");
    const parsed = listMemberAgentDirectMessageSessionsQuerySchema.safeParse({
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: MEMBER_AGENT_DIRECT_MESSAGE_SESSIONS_ROUTE,
        method: "GET",
        message: "Provide a valid chat-list cursor and limit.",
      });
    }
    return await executeRpcRoute({
      c,
      route: MEMBER_AGENT_DIRECT_MESSAGE_SESSIONS_ROUTE,
      method: "GET",
      responseSchema: listMemberAgentDirectMessageSessionsResponseSchema,
      execute: async () =>
        await c.var.coreRpc.listMemberAgentDirectMessageSessions({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });
}
