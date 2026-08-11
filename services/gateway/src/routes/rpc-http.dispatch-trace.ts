import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";

const SPACE_DISPATCH_TRACE_ROUTE =
  "/v1/spaces/:spaceId/dispatches/:dispatchId/trace";

export function registerDispatchTraceRoutes(app: Hono<HonoBindings>): void {
  app.get(SPACE_DISPATCH_TRACE_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");
    const dispatchId = String(c.req.param("dispatchId") ?? "").trim();
    const password = readSpacePasswordHeader(c.req.raw.headers);
    if (dispatchId.length === 0) {
      return respondBadRequest({
        c,
        route: SPACE_DISPATCH_TRACE_ROUTE,
        method: "GET",
        message: "dispatchId is required",
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: SPACE_DISPATCH_TRACE_ROUTE,
      method: "GET",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.getSpaceDispatchTrace({
          spaceId,
          dispatchId,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });
}
