import {
  organizationDashboardMutationSchema,
  organizationDashboardQuerySchema,
  organizationDashboardResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const route = "/v1/organizations/current/dashboards";

export function registerOrganizationDashboardRoutes(app: Hono<HonoBindings>) {
  app.get(route, async (c) => {
    const input = organizationDashboardQuerySchema.safeParse(c.req.query());
    if (!input.success) {
      return respondBadRequest({
        c,
        route,
        method: "GET",
        message: "Invalid dashboard query.",
      });
    }
    const response = await executeRpcRoute({
      c,
      route,
      method: "GET",
      execute: () =>
        c.var.coreRpc.organizationDashboards({
          context: buildCoreRpcContext(c),
          input: input.data,
        }),
      responseSchema: organizationDashboardResponseSchema,
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
  app.post(route, async (c) => {
    const body = await readJsonRequestBody(c.req.raw, { maxBytes: 8192 });
    const input = organizationDashboardMutationSchema.safeParse(
      body.ok ? body.value : null
    );
    if (!input.success) {
      return respondBadRequest({
        c,
        route,
        method: "POST",
        message: body.ok ? "Invalid dashboard configuration." : body.message,
      });
    }
    const response = await executeRpcRoute({
      c,
      route,
      method: "POST",
      retryMode: "none",
      execute: () =>
        c.var.coreRpc.organizationDashboards({
          context: buildCoreRpcContext(c),
          input: input.data,
        }),
      responseSchema: organizationDashboardResponseSchema,
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}
