import { spacePreferencesSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";

export function registerSpacePreferencesRoutes(app: Hono<HonoBindings>): void {
  const route = "/v1/account/space-preferences";
  app.get(route, (c) =>
    executeRpcRoute({
      c,
      route,
      method: "GET",
      responseSchema: spacePreferencesSchema,
      execute: () =>
        c.var.coreRpc.accountSpacePreferences({
          context: buildCoreRpcContext(c),
        }),
    })
  );
  app.patch(route, async (c) => {
    const body = spacePreferencesSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        route,
        method: "PATCH",
        message: "Choose whether to wake the only Agent automatically.",
      });
    }
    return executeRpcRoute({
      c,
      route,
      method: "PATCH",
      retryMode: "none",
      responseSchema: spacePreferencesSchema,
      execute: () =>
        c.var.coreRpc.accountSpacePreferences({
          context: buildCoreRpcContext(c),
          ...body.data,
        }),
    });
  });
}
