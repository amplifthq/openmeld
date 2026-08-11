import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";

export function registerRootRoutes(app: Hono<HonoBindings>) {
  app.get("/", (c) => {
    return c.json({
      service: "openmeld-core",
    });
  });
}
