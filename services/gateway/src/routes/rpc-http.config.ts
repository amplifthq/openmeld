import { getModelCatalogResponseSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { executePublicRpcRoute } from "./rpc-http.helpers";

const MODEL_CATALOG_ROUTE = "/v1/config/model-catalog";

export function registerConfigRoutes(app: Hono<HonoBindings>): void {
  app.get(MODEL_CATALOG_ROUTE, (c) =>
    executePublicRpcRoute({
      c,
      route: MODEL_CATALOG_ROUTE,
      method: "GET",
      responseSchema: getModelCatalogResponseSchema,
      execute: async () => await c.var.coreRpc.getModelCatalog(),
    })
  );
}
