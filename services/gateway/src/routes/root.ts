import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { PUBLIC_SPACE_BOUNDARY_ENDPOINTS } from "./rpc-http.public-space";

export function registerRootRoute(app: Hono<HonoBindings>): void {
  app.get("/health", (c) => {
    return c.json({
      ok: true,
      service: "openmeld-gateway",
    });
  });

  app.get("/", (c) => {
    return c.json({
      service: "openmeld-gateway",
      endpoints: PUBLIC_SPACE_BOUNDARY_ENDPOINTS,
    });
  });
}
