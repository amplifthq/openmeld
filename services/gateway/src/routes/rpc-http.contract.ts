import {
  patchSpaceContractBodySchema,
  putSpaceContractBodySchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

export function registerContractRoutes(app: Hono<HonoBindings>): void {
  app.get("/v1/spaces/:spaceId/contract", (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);

    return executeRpcRoute({
      c,
      route: "/v1/spaces/:spaceId/contract",
      method: "GET",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.getSpaceContract({
          spaceId,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });

  app.put("/v1/spaces/:spaceId/contract", async (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/contract",
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
      });
    }

    const parsed = putSpaceContractBodySchema.safeParse(bodyResult.value);
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/contract",
        method: "PUT",
        message:
          parsed.error.issues[0]?.message ?? "space contract body is invalid",
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: "/v1/spaces/:spaceId/contract",
      method: "PUT",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.putSpaceContract({
          spaceId,
          contract: parsed.data,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });

  app.patch("/v1/spaces/:spaceId/contract", async (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/contract",
        method: "PATCH",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
      });
    }

    const parsed = patchSpaceContractBodySchema.safeParse(bodyResult.value);
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/contract",
        method: "PATCH",
        message:
          parsed.error.issues[0]?.message ??
          "space contract patch body is invalid",
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: "/v1/spaces/:spaceId/contract",
      method: "PATCH",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.patchSpaceContract({
          spaceId,
          contractPatch: parsed.data,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });
}
