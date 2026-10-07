import { spaceInputQueueMutationSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
} from "./rpc-http.helpers";

export function registerSpaceInputQueueRoutes(app: Hono<HonoBindings>): void {
  const route = "/v1/spaces/:spaceId/input-queue";
  app.on(["GET", "PATCH"], route, async (c) => {
    const spaceId = c.req.param("spaceId");
    const mutation =
      c.req.method === "PATCH"
        ? spaceInputQueueMutationSchema.safeParse(
            await c.req.json().catch(() => null)
          )
        : undefined;
    if (mutation && !mutation.success) {
      return c.json({ message: "Invalid queued message request." }, 400);
    }
    return executeRpcRoute({
      c,
      route,
      method: c.req.method === "PATCH" ? "PATCH" : "GET",
      spaceId,
      execute: async () =>
        c.var.coreRpc.spaceInputQueue({
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
          spaceId,
          includeRecovery: c.req.query("recovery") === "1",
          password: readSpacePasswordHeader(c.req.raw.headers),
          context: buildCoreRpcContext(c),
          ...(mutation?.success ? { mutation: mutation.data } : {}),
        }),
    });
  });
}
