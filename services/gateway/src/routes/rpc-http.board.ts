import { spaceBoardResponseSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import { executeRpcRoute } from "./rpc-http.helpers";

const SPACE_BOARD_ROUTE = "/v1/spaces/:spaceId/board";

export function registerBoardRoute(app: Hono<HonoBindings>): void {
  app.get(SPACE_BOARD_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");

    return executeRpcRoute({
      c,
      route: SPACE_BOARD_ROUTE,
      method: "GET",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.getSpaceBoard({
          spaceId,
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
        });
      },
      responseSchema: spaceBoardResponseSchema,
    });
  });
}
