import {
  firstWorkActionSchema,
  firstWorkResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";

const route = "/v1/organizations/current/first-work";

export function registerFirstWorkRoutes(app: Hono<HonoBindings>) {
  app.get(route, (c) =>
    executeRpcRoute({
      c,
      route,
      method: "GET",
      responseSchema: firstWorkResponseSchema,
      execute: () =>
        c.var.coreRpc.firstWork({ context: buildCoreRpcContext(c) }),
    })
  );
  app.post(route, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = firstWorkActionSchema.safeParse(body);
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route,
        method: "POST",
        code: "invalid_payload",
        message: "Choose a valid onboarding action.",
      });
    }
    return executeRpcRoute({
      c,
      route,
      method: "POST",
      responseSchema: firstWorkResponseSchema,
      execute: () =>
        c.var.coreRpc.firstWork({
          context: buildCoreRpcContext(c),
          ...parsed.data,
        }),
    });
  });
}
