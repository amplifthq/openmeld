import { organizationUsageOverviewResponseSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { buildCoreRpcContext, executeRpcRoute } from "./rpc-http.helpers";

const USAGE_OVERVIEW_ROUTE = "/v1/organizations/current/usage/overview";

export function registerOrganizationUsageRoutes(app: Hono<HonoBindings>): void {
  app.get(USAGE_OVERVIEW_ROUTE, (c) =>
    executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.readOrganizationUsageOverview({
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: organizationUsageOverviewResponseSchema,
      route: USAGE_OVERVIEW_ROUTE,
    })
  );
}
