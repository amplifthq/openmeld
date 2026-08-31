import { OPENMELD_SPACE_ADDRESSING_VERSION } from "@openmeld/gateway-contract";
import { getSpaceDispatchResultInputSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";

const SPACE_RESULT_ROUTE = "/v1/spaces/:spaceId/result";

export function registerResultRoutes(app: Hono<HonoBindings>): void {
  app.get(SPACE_RESULT_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const parsed = getSpaceDispatchResultInputSchema.safeParse({
      spaceId,
      dispatchId: c.req.query("dispatchId"),
      resultRef: c.req.query("resultRef"),
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: SPACE_RESULT_ROUTE,
        method: "GET",
        message:
          parsed.error.issues[0]?.message ??
          "space dispatch result query is invalid",
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: SPACE_RESULT_ROUTE,
      method: "GET",
      spaceId,
      includeLegacySpaceAddressingWireFields: true,
      execute: async () => {
        return await c.var.coreRpc.getSpaceDispatchResult(
          {
            spaceId: parsed.data.spaceId,
            ...(parsed.data.dispatchId
              ? { dispatchId: parsed.data.dispatchId }
              : {}),
            ...(parsed.data.resultRef
              ? { resultRef: parsed.data.resultRef }
              : {}),
            ...(password === undefined ? {} : { password }),
            context: buildCoreRpcContext(c),
          },
          OPENMELD_SPACE_ADDRESSING_VERSION
        );
      },
    });
  });
}
