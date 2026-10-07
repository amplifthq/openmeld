import {
  aiUsageQueryResponseSchema,
  aiUsageQuerySchema,
  organizationUsageOverviewResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const USAGE_OVERVIEW_ROUTE = "/v1/organizations/current/usage/overview";
const AI_USAGE_QUERY_ROUTE = "/v1/organizations/current/usage/query";

export function registerOrganizationUsageRoutes(app: Hono<HonoBindings>): void {
  app.post(AI_USAGE_QUERY_ROUTE, async (c) => {
    const body = await readJsonRequestBody(c.req.raw);
    const parsed = body.ok ? aiUsageQuerySchema.safeParse(body.value) : null;
    if (!parsed?.success) {
      return respondBadRequest({
        c,
        route: AI_USAGE_QUERY_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: "Choose a valid AI usage period of up to 31 days.",
      });
    }
    return executeRpcRoute({
      c,
      route: AI_USAGE_QUERY_ROUTE,
      method: "POST",
      responseSchema: aiUsageQueryResponseSchema,
      execute: () =>
        c.var.coreRpc.readOrganizationAiUsage({
          context: buildCoreRpcContext(c),
          query: parsed.data,
        }),
    });
  });
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
