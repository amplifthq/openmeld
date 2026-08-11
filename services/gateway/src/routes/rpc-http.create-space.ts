import { createSpaceResponseSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { parseCreateSpaceBody } from "./rpc-http.parsers";

export function registerCreateSpaceRoute(app: Hono<HonoBindings>): void {
  app.post("/v1/spaces", async (c) => {
    let body: unknown;
    const rawBody = (await c.req.text()).trim();
    if (rawBody.length > 0) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return respondBadRequest({
          c,
          route: "/v1/spaces",
          method: "POST",
          code: "invalid_json",
          message: "Invalid JSON",
        });
      }
    }

    const parsed = parseCreateSpaceBody(body);
    if (!parsed.ok) {
      return respondBadRequest({
        c,
        route: "/v1/spaces",
        method: "POST",
        code:
          parsed.message === "Invalid JSON"
            ? "invalid_json"
            : "invalid_payload",
        message: parsed.message,
      });
    }

    return executeRpcRoute({
      c,
      route: "/v1/spaces",
      method: "POST",
      execute: async () => {
        return await c.var.coreRpc.createSpace({
          ...(Object.keys(parsed.value).length > 0 ? parsed.value : {}),
          context: buildCoreRpcContext(c),
        });
      },
      responseSchema: createSpaceResponseSchema,
    });
  });
}
