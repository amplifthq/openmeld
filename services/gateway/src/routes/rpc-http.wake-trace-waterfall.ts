import {
  getSpaceWakeTraceWaterfallInputSchema,
  getSpaceWakeTraceWaterfallResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";

const SPACE_WAKE_TRACE_WATERFALL_ROUTE =
  "/v1/spaces/:spaceId/wake-trace-waterfall";

export function registerWakeTraceWaterfallRoutes(
  app: Hono<HonoBindings>
): void {
  app.get(SPACE_WAKE_TRACE_WATERFALL_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");
    const parsed = getSpaceWakeTraceWaterfallInputSchema.safeParse({
      spaceId,
      sourceSignalId: c.req.query("sourceSignalId"),
      clientMessageId: c.req.query("clientMessageId"),
      targetProfileId: c.req.query("targetProfileId"),
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: SPACE_WAKE_TRACE_WATERFALL_ROUTE,
        method: "GET",
        message:
          parsed.error.issues[0]?.message ??
          "wake trace waterfall query is invalid",
        spaceId,
      });
    }

    const password = readSpacePasswordHeader(c.req.raw.headers);
    return executeRpcRoute({
      c,
      route: SPACE_WAKE_TRACE_WATERFALL_ROUTE,
      method: "GET",
      spaceId,
      responseSchema: getSpaceWakeTraceWaterfallResponseSchema,
      execute: async () => {
        return await c.var.coreRpc.getSpaceWakeTraceWaterfall({
          spaceId: parsed.data.spaceId,
          ...(parsed.data.clientMessageId
            ? { clientMessageId: parsed.data.clientMessageId }
            : {}),
          ...(parsed.data.sourceSignalId
            ? { sourceSignalId: parsed.data.sourceSignalId }
            : {}),
          ...(parsed.data.targetProfileId
            ? { targetProfileId: parsed.data.targetProfileId }
            : {}),
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });
}
