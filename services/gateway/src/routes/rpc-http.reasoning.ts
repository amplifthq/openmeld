import { localAgentReasoningPreferencesSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";

export function registerReasoningRoutes(app: Hono<HonoBindings>): void {
  const route = "/v1/account/reasoning-stream";
  app.get(route, (c) =>
    executeRpcRoute({
      c,
      route,
      method: "GET",
      responseSchema: localAgentReasoningPreferencesSchema,
      execute: () =>
        c.var.coreRpc.localAgentReasoningPreferences({
          context: buildCoreRpcContext(c),
        }),
    })
  );
  app.patch(route, async (c) => {
    const body = localAgentReasoningPreferencesSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        route,
        method: "PATCH",
        message: "Choose whether to stream reasoning.",
      });
    }
    return executeRpcRoute({
      c,
      route,
      method: "PATCH",
      retryMode: "none",
      responseSchema: localAgentReasoningPreferencesSchema,
      execute: () =>
        c.var.coreRpc.localAgentReasoningPreferences({
          context: buildCoreRpcContext(c),
          ...body.data,
        }),
    });
  });
}
