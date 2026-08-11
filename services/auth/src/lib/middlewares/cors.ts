import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../context";
import { resolveAuthWorkerTrustedOrigins } from "./trusted-origin";

export const openMeldAuthCors = createMiddleware<AppContext>((c, next) => {
  const trustedOrigins = resolveAuthWorkerTrustedOrigins(c);

  return cors({
    origin: (origin) => {
      // Allow requests with no origin (server-to-server, mobile apps, curl).
      if (!origin) {
        return origin;
      }

      return trustedOrigins.has(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "authorization"],
  })(c, next);
});
