import { getSpaceStatusResponseSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import {
  executePublicRpcRoute,
  formatAuditValue,
  respondPublicBadRequest,
} from "./rpc-http.helpers";
import { parseSpaceRouteParams } from "./rpc-http.parsers";

const SPACE_STATUS_ROUTE = "/v1/spaces/:spaceId/status";

export function registerStatusRoutes(app: Hono<HonoBindings>): void {
  app.get(SPACE_STATUS_ROUTE, (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondPublicBadRequest({
        c,
        route: SPACE_STATUS_ROUTE,
        method: "GET",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;

    return executePublicRpcRoute({
      c,
      route: SPACE_STATUS_ROUTE,
      method: "GET",
      execute: async () => {
        return await c.var.coreRpc.getSpaceStatus({
          spaceId,
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
        });
      },
      responseSchema: getSpaceStatusResponseSchema,
    });
  });
}
