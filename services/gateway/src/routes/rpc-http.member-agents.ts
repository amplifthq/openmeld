import {
  getMemberAgentPresenceResponseSchema,
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
} from "./rpc-http.helpers";

// MemberAgent catalog sync and derived presence for the signed-in member's
// current Organization. Web calls the sync when the member opens the Agents
// or Direct Message surface, and setup or "add" calls it with the chosen
// Harnesses; both are no-store owner reads/writes.
export function registerMemberAgentRoutes(app: Hono<HonoBindings>): void {
  app.post(MEMBER_AGENT_SYNC_ROUTE, async (c) => {
    // An empty body finishes existing Agents; `createHarnessKinds` adds the
    // Harnesses the member chose.
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
}
