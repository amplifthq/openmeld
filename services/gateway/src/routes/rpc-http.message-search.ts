import { OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION } from "@openmeld/gateway-contract";
import {
  messageReadPageSchema,
  messageReadQuerySchema,
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
  app.get("/v1/messages/query", (c) => {
    const query = messageReadQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return respondBadRequest({
        c,
        route: "/v1/messages/query",
        method: "GET",
        message: "Use a valid message query and continuation cursor.",
      });
    }
    return executeRpcRoute({
      c,
      route: "/v1/messages/query",
      method: "GET",
      responseSchema: messageReadPageSchema,
      execute: () =>
        c.var.coreRpc.readMessages({
          ...query.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });
  const route = "/v1/messages/search";
  app.get(route, (c) => {
    const query = messageSearchQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return respondBadRequest({
        c,
        route,
        method: "GET",
        message:
          "Enter 1 to 200 characters for a Space search, or 3 to 200 characters otherwise, and use a valid search cursor.",
      });
    }
    return executeRpcRoute({
      c,
      route,
      method: "GET",
      responseSchema: messageSearchResponseSchema,
      execute: () =>
        c.var.coreRpc.searchMessages(
          {
            ...query.data,
            context: buildCoreRpcContext(c),
          },
          OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
        ),
    });
  });
}
