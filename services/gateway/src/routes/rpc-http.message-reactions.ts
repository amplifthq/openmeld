import {
  getSpaceMessageReactionsInputSchema,
  getSpaceMessageReactionsResponseSchema,
  setSpaceMessageReactionInputSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";

const route = "/v1/spaces/:spaceId/message-reactions";
export function registerMessageReactionRoutes(app: Hono<HonoBindings>): void {
  app.get(route, (c) => {
    const spaceId = c.req.param("spaceId");
    const parsed = getSpaceMessageReactionsInputSchema.safeParse({
      ...c.req.query(),
      spaceId,
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route,
        method: "GET",
        spaceId,
        message: "Choose a message to view its reactions.",
      });
    }
    return executeRpcRoute({
      c,
      route,
      method: "GET",
      spaceId,
      responseSchema: getSpaceMessageReactionsResponseSchema,
      execute: () =>
        c.var.coreRpc.getSpaceMessageReactions({
          ...parsed.data,
          context: buildCoreRpcContext(c),
          password: readSpacePasswordHeader(c.req.raw.headers),
        }),
    });
  });
  app.put(route, async (c) => {
    const spaceId = c.req.param("spaceId");
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = setSpaceMessageReactionInputSchema.safeParse(
      typeof body === "object" && body ? { ...body, spaceId } : null
    );
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route,
        method: "PUT",
        spaceId,
        message: "Choose a message and an emoji to update your reaction.",
      });
    }
    return executeRpcRoute({
      c,
      route,
      method: "PUT",
      spaceId,
      responseSchema: getSpaceMessageReactionsResponseSchema,
      execute: () =>
        c.var.coreRpc.setSpaceMessageReaction({
          ...parsed.data,
          context: buildCoreRpcContext(c),
          password: readSpacePasswordHeader(c.req.raw.headers),
        }),
    });
  });
}
