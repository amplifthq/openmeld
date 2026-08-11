import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";

const SPACE_DISPATCH_LOOKUP_ROUTE = "/v1/spaces/:spaceId/dispatches/lookup";

export function registerDispatchLookupRoutes(app: Hono<HonoBindings>): void {
  app.get(SPACE_DISPATCH_LOOKUP_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");
    const sourceSignalId = String(c.req.query("sourceSignalId") ?? "").trim();
    const clientMessageId = String(c.req.query("clientMessageId") ?? "").trim();
    const targetProfileId = String(c.req.query("targetProfileId") ?? "").trim();
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const selectorCount =
      Number(sourceSignalId.length > 0) + Number(clientMessageId.length > 0);
    if (selectorCount !== 1) {
      return respondBadRequest({
        c,
        route: SPACE_DISPATCH_LOOKUP_ROUTE,
        method: "GET",
        message: "exactly one of sourceSignalId or clientMessageId is required",
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: SPACE_DISPATCH_LOOKUP_ROUTE,
      method: "GET",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.getSpaceDispatchLookup({
          spaceId,
          ...(sourceSignalId.length > 0 ? { sourceSignalId } : {}),
          ...(clientMessageId.length > 0 ? { clientMessageId } : {}),
          ...(targetProfileId.length > 0 ? { targetProfileId } : {}),
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });
}
