import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";
import {
  parsePatchSpaceMetaBody,
  readJsonRequestBody,
} from "./rpc-http.parsers";

export function registerMetaRoutes(app: Hono<HonoBindings>): void {
  app.get("/v1/spaces/:spaceId/meta", (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);

    return executeRpcRoute({
      c,
      route: "/v1/spaces/:spaceId/meta",
      method: "GET",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.getSpaceMeta({
          spaceId,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });

  app.patch("/v1/spaces/:spaceId/meta", async (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/meta",
        method: "PATCH",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
      });
    }

    const parsed = parsePatchSpaceMetaBody(bodyResult.value);
    if (!parsed.ok) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/meta",
        method: "PATCH",
        ...(parsed.message === "Invalid JSON" ? { code: "invalid_json" } : {}),
        message: parsed.message,
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: "/v1/spaces/:spaceId/meta",
      method: "PATCH",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.updateSpaceMeta({
          spaceId,
          ...parsed.value,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });
}
