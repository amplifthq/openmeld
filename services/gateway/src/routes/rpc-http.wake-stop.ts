import {
  postSpaceWakeStopBodySchema,
  postSpaceWakeStopResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const SPACE_WAKE_STOP_ROUTE = "/v1/spaces/:spaceId/wake-stop";

export function registerWakeStopRoutes(app: Hono<HonoBindings>): void {
  app.post(SPACE_WAKE_STOP_ROUTE, async (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: SPACE_WAKE_STOP_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
      });
    }

    const parsed = postSpaceWakeStopBodySchema.safeParse(bodyResult.value);
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: SPACE_WAKE_STOP_ROUTE,
        method: "POST",
        message:
          parsed.error.issues[0]?.message ?? "wake stop payload is invalid",
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: SPACE_WAKE_STOP_ROUTE,
      method: "POST",
      spaceId,
      responseSchema: postSpaceWakeStopResponseSchema,
      execute: async () => {
        return await c.var.coreRpc.postSpaceWakeStop({
          spaceId,
          body: parsed.data,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });
}
