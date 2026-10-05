import {
  cloudComputerOperationSchema,
  cloudComputerResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const route = "/v1/computer/cloud";

export function registerCloudComputerRoutes(app: Hono<HonoBindings>) {
  app.get(route, (c) =>
    executeRpcRoute({
      c,
      route,
      method: "GET",
      responseSchema: cloudComputerResponseSchema,
      execute: () =>
        c.var.coreRpc.personalComputer({ context: buildCoreRpcContext(c) }),
    })
  );
  app.post(route, async (c) => {
    const body = await readJsonRequestBody(c.req.raw);
    if (!body.ok) {
      return respondBadRequest({
        c,
        route,
        method: "POST",
        code: "invalid_json",
        message: body.message,
      });
    }
    const request = cloudComputerOperationSchema.safeParse(body.value);
    if (!request.success) {
      return respondBadRequest({
        c,
        route,
        method: "POST",
        code: "invalid_payload",
        message: "Provide a valid Computer operation.",
      });
    }
    return executeRpcRoute({
      c,
      route,
      method: "POST",
      responseSchema: cloudComputerResponseSchema,
      retryMode: "none",
      execute: () =>
        c.var.coreRpc.personalComputer({
          context: buildCoreRpcContext(c),
          operation: request.data,
        }),
    });
  });
}
