import {
  messageSearchQuerySchema,
  messageSearchResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";

export function registerMessageSearchRoutes(app: Hono<HonoBindings>): void {
  const route = "/v1/messages/search";
  app.get(route, (c) => {
    const query = messageSearchQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return respondBadRequest({
        c,
        route,
        method: "GET",
        message: "Enter 3 to 200 characters and use a valid search cursor.",
      });
    }
    return executeRpcRoute({
      c,
      route,
      method: "GET",
      responseSchema: messageSearchResponseSchema,
      execute: () =>
        c.var.coreRpc.searchMessages({
          ...query.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });
}
