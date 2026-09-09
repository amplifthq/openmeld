import {
  spaceFilePinMutationSchema,
  spaceMessagePinMutationSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
} from "./rpc-http.helpers";

export function registerMessagePinRoutes(app: Hono<HonoBindings>): void {
  const fileRoute = "/v1/spaces/:spaceId/file-pins";
  app.on(["GET", "PATCH"], fileRoute, async (c) => {
    const spaceId = c.req.param("spaceId");
    const mutation =
      c.req.method === "PATCH"
        ? spaceFilePinMutationSchema.safeParse(
            await c.req.json().catch(() => null)
          )
        : undefined;
    if (mutation && !mutation.success) {
      return c.json({ message: "Invalid file pin request." }, 400);
    }
    return executeRpcRoute({
      c,
      route: fileRoute,
      method: c.req.method === "PATCH" ? "PATCH" : "GET",
      spaceId,
      execute: async () =>
        c.var.coreRpc.spaceFilePins({
          spaceId,
          password: readSpacePasswordHeader(c.req.raw.headers),
          context: buildCoreRpcContext(c),
          ...(mutation?.success ? { mutation: mutation.data } : {}),
        }),
    });
  });
  const route = "/v1/spaces/:spaceId/message-pins";
  app.on(["GET", "PATCH"], route, async (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const mutation =
      c.req.method === "PATCH"
        ? spaceMessagePinMutationSchema.safeParse(
            await c.req.json().catch(() => null)
          )
        : undefined;
    if (mutation && !mutation.success) {
      return c.json({ message: "Invalid pin request." }, 400);
    }
    return executeRpcRoute({
      c,
      route,
      method: c.req.method === "PATCH" ? "PATCH" : "GET",
      spaceId,
      execute: async () =>
        c.var.coreRpc.spaceMessagePins({
          spaceId,
          password,
          context: buildCoreRpcContext(c),
          ...(mutation?.success ? { mutation: mutation.data } : {}),
        }),
    });
  });
}
