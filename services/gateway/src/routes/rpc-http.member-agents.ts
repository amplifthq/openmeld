import {
  getMemberAgentPresenceResponseSchema,
  MEMBER_AGENT_PRESENCE_ROUTE,
  MEMBER_AGENT_SYNC_ROUTE,
  syncMemberAgentsResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { buildCoreRpcContext, executeRpcRoute } from "./rpc-http.helpers";

// MemberAgent catalog sync and derived presence for the signed-in member's
// current Organization. Web calls the sync when the member opens the Agents
// or Direct Message surface; both are no-store owner reads/writes.
export function registerMemberAgentRoutes(app: Hono<HonoBindings>): void {
  app.post(MEMBER_AGENT_SYNC_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: MEMBER_AGENT_SYNC_ROUTE,
      method: "POST",
      responseSchema: syncMemberAgentsResponseSchema,
      execute: () =>
        c.var.coreRpc.syncMemberAgents({ context: buildCoreRpcContext(c) }),
    })
  );
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
}
