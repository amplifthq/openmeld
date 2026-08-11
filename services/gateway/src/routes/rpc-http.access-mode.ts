import { spaceAccessModeStateSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import {
  parseSetSpaceAccessModeBody,
  readJsonRequestBody,
} from "./rpc-http.parsers";

const ACCESS_MODE_ROUTE = "/v1/spaces/:spaceId/access-mode";

export function registerSpaceAccessModeRoute(app: Hono<HonoBindings>): void {
  app.put(ACCESS_MODE_ROUTE, async (c) => {
    const spaceId = c.req.param("spaceId");
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: ACCESS_MODE_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
      });
    }

    const parsed = parseSetSpaceAccessModeBody(bodyResult.value);
    if (!parsed.ok) {
      return respondBadRequest({
        c,
        route: ACCESS_MODE_ROUTE,
        method: "PUT",
        ...(parsed.code ? { code: parsed.code } : {}),
        message: parsed.message,
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: ACCESS_MODE_ROUTE,
      method: "PUT",
      spaceId,
      responseSchema: spaceAccessModeStateSchema,
      execute: async () => {
        return await c.var.coreRpc.setSpaceAccessMode({
          spaceId,
          accessMode: parsed.value.accessMode,
          ...(parsed.value.password === undefined
            ? {}
            : { password: parsed.value.password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });
}
