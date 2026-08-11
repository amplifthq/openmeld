import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import {
  parseUpsertSpacePasswordBody,
  readJsonRequestBody,
} from "./rpc-http.parsers";

const PASSWORD_ROUTE = "/v1/spaces/:spaceId/password";

export function registerSpacePasswordRoute(app: Hono<HonoBindings>): void {
  app.put(PASSWORD_ROUTE, async (c) => {
    const spaceId = c.req.param("spaceId");
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: PASSWORD_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
      });
    }

    const parsed = parseUpsertSpacePasswordBody(bodyResult.value);
    if (!parsed.ok) {
      return respondBadRequest({
        c,
        route: PASSWORD_ROUTE,
        method: "PUT",
        ...(parsed.code ? { code: parsed.code } : {}),
        message: parsed.message,
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: PASSWORD_ROUTE,
      method: "PUT",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.upsertSpacePassword({
          spaceId,
          password: parsed.value.password,
          context: buildCoreRpcContext(c),
        });
      },
    });
  });

  app.delete(PASSWORD_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");

    return executeRpcRoute({
      c,
      route: PASSWORD_ROUTE,
      method: "DELETE",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.clearSpacePassword({
          spaceId,
          context: buildCoreRpcContext(c),
        });
      },
    });
  });
}
