import {
  getSpaceEntryResolutionInputSchema,
  getSpaceEntryResolutionResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import {
  executePublicRpcRoute,
  formatAuditValue,
  respondPublicBadRequest,
} from "./rpc-http.helpers";

const SPACE_ENTRY_RESOLUTION_ROUTE = "/v1/spaces/:spaceId/entry-resolution";

export function registerSpaceEntryResolutionRoute(
  app: Hono<HonoBindings>
): void {
  app.get(SPACE_ENTRY_RESOLUTION_ROUTE, (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsed = getSpaceEntryResolutionInputSchema.safeParse({
      spaceId: rawSpaceId,
      signalId: c.req.query("signalId"),
      threadRootSignalId: c.req.query("threadRootSignalId"),
    });
    if (!parsed.success) {
      return respondPublicBadRequest({
        c,
        route: SPACE_ENTRY_RESOLUTION_ROUTE,
        method: "GET",
        code: "invalid_space_id",
        message:
          parsed.error.issues[0]?.message ?? "Invalid Space entry target",
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    return executePublicRpcRoute({
      c,
      route: SPACE_ENTRY_RESOLUTION_ROUTE,
      method: "GET",
      execute: async () => {
        return await c.var.coreRpc.getSpaceEntryResolution({
          ...parsed.data,
          spaceAccess: buildGatewaySpaceAccessContext(c, parsed.data.spaceId),
        });
      },
      responseSchema: getSpaceEntryResolutionResponseSchema,
    });
  });
}
