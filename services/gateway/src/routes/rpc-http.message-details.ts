import {
  getSpaceMessageDetailsInputSchema,
  getSpaceMessageDetailsResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";

const SPACE_MESSAGE_DETAILS_ROUTE = "/v1/spaces/:spaceId/message-details";

export function registerMessageDetailsRoutes(app: Hono<HonoBindings>): void {
  app.get(SPACE_MESSAGE_DETAILS_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");
    const parsed = getSpaceMessageDetailsInputSchema.safeParse({
      spaceId,
      signalId: c.req.query("signalId"),
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: SPACE_MESSAGE_DETAILS_ROUTE,
        method: "GET",
        message:
          parsed.error.issues[0]?.message ?? "message details query is invalid",
        spaceId,
      });
    }

    const password = readSpacePasswordHeader(c.req.raw.headers);
    return executeRpcRoute({
      c,
      route: SPACE_MESSAGE_DETAILS_ROUTE,
      method: "GET",
      spaceId,
      responseSchema: getSpaceMessageDetailsResponseSchema,
      execute: async () => {
        return await c.var.coreRpc.getSpaceMessageDetails({
          spaceId: parsed.data.spaceId,
          signalId: parsed.data.signalId,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });
}
