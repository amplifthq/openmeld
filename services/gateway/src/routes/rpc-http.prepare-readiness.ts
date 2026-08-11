import {
  getPrepareReadinessQuerySchema,
  getPrepareReadinessResponseSchema,
  prepareReadinessRouteParamsSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";

const PREPARE_READINESS_ROUTE = "/v1/devices/:deviceId/prepare-readiness";

export function registerPrepareReadinessRoutes(app: Hono<HonoBindings>): void {
  app.get(PREPARE_READINESS_ROUTE, (c) => {
    const routeParams = prepareReadinessRouteParamsSchema.safeParse({
      deviceId: c.req.param("deviceId"),
    });
    if (!routeParams.success) {
      return respondBadRequest({
        c,
        route: PREPARE_READINESS_ROUTE,
        method: "GET",
        code: "invalid_device_id",
        message: routeParams.error.issues[0]?.message ?? "deviceId is invalid",
      });
    }

    const searchParams = new URL(c.req.url).searchParams;
    const query = getPrepareReadinessQuerySchema.safeParse({
      agentControllerRefs: searchParams.getAll("agentControllerRef"),
      lane: c.req.query("lane"),
      openMeldServiceRuntimeId: c.req.query("openMeldServiceRuntimeId"),
    });
    if (!query.success) {
      return respondBadRequest({
        c,
        route: PREPARE_READINESS_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message:
          query.error.issues[0]?.message ??
          "prepare readiness query is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: PREPARE_READINESS_ROUTE,
      method: "GET",
      responseSchema: getPrepareReadinessResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getPrepareReadiness({
          agentControllerRefs: query.data.agentControllerRefs ?? [],
          deviceId: routeParams.data.deviceId,
          lane: query.data.lane,
          ...(query.data.openMeldServiceRuntimeId === undefined
            ? {}
            : {
                openMeldServiceRuntimeId: query.data.openMeldServiceRuntimeId,
              }),
          context: buildCoreRpcContext(c),
        }),
    });
  });
}
