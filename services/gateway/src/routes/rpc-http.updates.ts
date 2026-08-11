import { getSpaceUpdatesInputSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";

const SPACE_UPDATES_ROUTE = "/v1/spaces/:spaceId/updates";

export function registerUpdatesRoutes(app: Hono<HonoBindings>): void {
  app.get(SPACE_UPDATES_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const parsed = getSpaceUpdatesInputSchema.safeParse({
      spaceId,
      afterSignalId: c.req.query("afterSignalId"),
      limit: c.req.query("limit"),
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: SPACE_UPDATES_ROUTE,
        method: "GET",
        message:
          parsed.error.issues[0]?.message ?? "space updates query is invalid",
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: SPACE_UPDATES_ROUTE,
      method: "GET",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.getSpaceUpdates({
          spaceId: parsed.data.spaceId,
          afterSignalId: parsed.data.afterSignalId,
          limit: parsed.data.limit,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });
}
