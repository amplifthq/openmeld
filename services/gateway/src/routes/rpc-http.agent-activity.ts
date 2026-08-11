import {
  agentActivitySnapshotQuerySchema,
  agentActivitySnapshotResponseSchema,
  agentActivityStatsQuerySchema,
  agentActivityStatsResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";

const SNAPSHOT_ROUTE = "/v1/organizations/current/agent-activity";
const STATS_ROUTE = "/v1/organizations/current/agent-activity/stats";

export function registerAgentActivityRoutes(app: Hono<HonoBindings>): void {
  app.get(STATS_ROUTE, (c) => {
    const query = agentActivityStatsQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message:
          query.error.issues[0]?.message ??
          "Invalid Agent Activity stats request.",
        method: "GET",
        route: STATS_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.readAgentActivityStats({
          ...query.data,
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: agentActivityStatsResponseSchema,
      route: STATS_ROUTE,
    });
  });

  app.get(SNAPSHOT_ROUTE, (c) => {
    const query = agentActivitySnapshotQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message:
          query.error.issues[0]?.message ?? "Invalid Agent Activity request.",
        method: "GET",
        route: SNAPSHOT_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.readAgentActivitySnapshot({
          ...query.data,
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: agentActivitySnapshotResponseSchema,
      route: SNAPSHOT_ROUTE,
    });
  });
}
