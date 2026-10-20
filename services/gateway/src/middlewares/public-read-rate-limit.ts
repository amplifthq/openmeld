import { createMiddleware } from "hono/factory";
import { parseAnonymousSpaceReadRoute } from "../lib/anonymous-space-read-routes";
import type { HonoBindings } from "../lib/bindings";

// Apply before authentication RPCs. A fake cookie or Authorization header must
// not bypass the protection. Writes, streams and task execution are excluded.
export const publicReadRateLimitMiddleware = createMiddleware<HonoBindings>(
  async (c, next) => {
    if (!parseAnonymousSpaceReadRoute(c.req.raw)) {
      return await next();
    }
    const ip = c.req.header("CF-Connecting-IP");
    if (!ip) {
      // Local service-binding calls have no public client IP.
      return await next();
    }
    const result = await c.env.OPENMELD_PUBLIC_READ_RATE_LIMITER.limit({
      key: `${c.env.OPENMELD_WORKER_ENVIRONMENT}:public-read:${ip}`,
    });
    if (!result.success) {
      const response = jsonErrorResponse({
        status: 429,
        code: "gateway.public_read_rate_limited",
        message: "Too many requests. Try again in one minute.",
        requestId: c.get("ingressOpenMeldContext").requestId,
      });
      response.headers.set("Retry-After", "60");
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    return await next();
  }
);

import { jsonErrorResponse } from "@openmeld/gateway-contract";
