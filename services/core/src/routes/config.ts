import { getModelCatalogResponseSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import { readModelCatalog } from "../config/model-catalog";
import type { HonoBindings } from "../lib/bindings";

const MODEL_CATALOG_ROUTE = "/v1/config/model-catalog";

export function registerConfigRoutes(app: Hono<HonoBindings>): void {
  app.get(MODEL_CATALOG_ROUTE, (c) => {
    const catalog = readModelCatalog();
    const parsed = getModelCatalogResponseSchema.safeParse(catalog);
    if (!parsed.success) {
      throw new Error(
        `model catalog response is invalid: ${parsed.error.issues[0]?.message ?? "unknown schema error"}`
      );
    }
    return c.json(parsed.data);
  });
}
