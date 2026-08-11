import {
  getActiveSpaceWakeProgressInputSchema,
  getActiveSpaceWakeProgressResponseSchema,
  getSpaceWakeProgressInputSchema,
  getSpaceWakeProgressResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";

const SPACE_WAKE_PROGRESS_ROUTE = "/v1/spaces/:spaceId/wake-progress";
const SPACE_ACTIVE_WAKE_PROGRESS_ROUTE =
  "/v1/spaces/:spaceId/active-wake-progress";

export function registerWakeProgressRoutes(app: Hono<HonoBindings>): void {
  app.get(SPACE_ACTIVE_WAKE_PROGRESS_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");
    const parsed = getActiveSpaceWakeProgressInputSchema.safeParse({
      spaceId,
      includeTiming: c.req.query("includeTiming"),
      includeWakeStopEligibility: c.req.query("includeWakeStopEligibility"),
      targetProfileId: c.req.query("targetProfileId"),
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: SPACE_ACTIVE_WAKE_PROGRESS_ROUTE,
        method: "GET",
        message:
          parsed.error.issues[0]?.message ??
          "active wake progress query is invalid",
        spaceId,
      });
    }

    const password = readSpacePasswordHeader(c.req.raw.headers);
    return executeRpcRoute({
      c,
      route: SPACE_ACTIVE_WAKE_PROGRESS_ROUTE,
      method: "GET",
      spaceId,
      responseSchema: getActiveSpaceWakeProgressResponseSchema,
      execute: async () => {
        return await c.var.coreRpc.getActiveSpaceWakeProgress({
          spaceId: parsed.data.spaceId,
          ...(parsed.data.includeTiming === undefined
            ? {}
            : { includeTiming: parsed.data.includeTiming }),
          ...(parsed.data.includeWakeStopEligibility === undefined
            ? {}
            : {
                includeWakeStopEligibility:
                  parsed.data.includeWakeStopEligibility,
              }),
          ...(parsed.data.targetProfileId
            ? { targetProfileId: parsed.data.targetProfileId }
            : {}),
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });

  app.get(SPACE_WAKE_PROGRESS_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");
    const parsed = getSpaceWakeProgressInputSchema.safeParse({
      spaceId,
      clientMessageId: c.req.query("clientMessageId"),
      includeTiming: c.req.query("includeTiming"),
      includeWakeStopEligibility: c.req.query("includeWakeStopEligibility"),
      targetProfileId: c.req.query("targetProfileId"),
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: SPACE_WAKE_PROGRESS_ROUTE,
        method: "GET",
        message:
          parsed.error.issues[0]?.message ?? "wake progress query is invalid",
        spaceId,
      });
    }

    const password = readSpacePasswordHeader(c.req.raw.headers);
    return executeRpcRoute({
      c,
      route: SPACE_WAKE_PROGRESS_ROUTE,
      method: "GET",
      spaceId,
      responseSchema: getSpaceWakeProgressResponseSchema,
      execute: async () => {
        return await c.var.coreRpc.getSpaceWakeProgress({
          spaceId: parsed.data.spaceId,
          clientMessageId: parsed.data.clientMessageId,
          ...(parsed.data.includeTiming === undefined
            ? {}
            : { includeTiming: parsed.data.includeTiming }),
          ...(parsed.data.includeWakeStopEligibility === undefined
            ? {}
            : {
                includeWakeStopEligibility:
                  parsed.data.includeWakeStopEligibility,
              }),
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
