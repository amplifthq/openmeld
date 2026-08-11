import {
  getLocalRuntimeExpectedRoutesQuerySchema,
  getLocalRuntimeExpectedRoutesResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";

// Contract: developing/architecture/agent-transport-contract.md ("Expected Routes Projection")
// Device-viewpoint projection read, so it lives under /v1/local-runtime/
// instead of the profile resource API (contract ruling 3).
const LOCAL_RUNTIME_EXPECTED_ROUTES_ROUTE = "/v1/local-runtime/expected-routes";

export function registerLocalRuntimeExpectedRoutesRoutes(
  app: Hono<HonoBindings>
): void {
  app.get(LOCAL_RUNTIME_EXPECTED_ROUTES_ROUTE, (c) => {
    const query = getLocalRuntimeExpectedRoutesQuerySchema.safeParse({
      contractVersion: c.req.query("contractVersion"),
      deviceId: c.req.query("deviceId"),
      lane: c.req.query("lane"),
    });
    if (!query.success) {
      return respondBadRequest({
        c,
        route: LOCAL_RUNTIME_EXPECTED_ROUTES_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message:
          query.error.issues[0]?.message ?? "expected-routes query is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: LOCAL_RUNTIME_EXPECTED_ROUTES_ROUTE,
      method: "GET",
      responseSchema: getLocalRuntimeExpectedRoutesResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getLocalRuntimeExpectedRoutes({
          ...(query.data.contractVersion
            ? { contractVersion: query.data.contractVersion }
            : {}),
          deviceId: query.data.deviceId,
          lane: query.data.lane,
          context: buildCoreRpcContext(c),
        }),
    });
  });
}
