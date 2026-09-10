import {
  getSpaceLinkPreviewsInputSchema,
  getSpaceLinkPreviewsResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import {
  executePublicRpcRoute,
  respondPublicBadRequest,
} from "./rpc-http.helpers";

export function registerLinkPreviewRoutes(app: Hono<HonoBindings>): void {
  const route = "/v1/spaces/:spaceId/link-previews";
  app.get(route, async (c) => {
    const spaceId = c.req.param("spaceId");
    const parsed = getSpaceLinkPreviewsInputSchema.safeParse({
      spaceId,
      signalId: c.req.query("signalId"),
    });
    if (!parsed.success) {
      return respondPublicBadRequest({
        c,
        route,
        method: "GET",
        code: "invalid_payload",
        reason: "invalid_link_preview_request",
        message: "Invalid message link preview request.",
      });
    }
    const response = await executePublicRpcRoute({
      c,
      route,
      method: "GET",
      responseSchema: getSpaceLinkPreviewsResponseSchema,
      execute: () =>
        c.var.coreRpc.getSpaceLinkPreviews({
          ...parsed.data,
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
        }),
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}
