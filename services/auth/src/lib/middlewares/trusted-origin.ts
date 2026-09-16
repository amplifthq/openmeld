import { resolveTrustedOrigins } from "@openmeld/auth/server";
import { DESKTOP_APP_ORIGIN } from "@openmeld/schemas";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../context";

const INVALID_ORIGIN_RESPONSE = {
  code: "auth.invalid_origin",
  message: "Request origin is not trusted.",
  ok: false,
} as const;

export const requireTrustedCookieOrigin = createMiddleware<AppContext>(
  async (c, next) => {
    if (!c.req.raw.headers.has("cookie")) {
      await next();
      return;
    }

    const requestOrigin = readRequestOrigin(c.req.raw.headers);
    if (
      requestOrigin &&
      resolveAuthWorkerTrustedOrigins(c).has(requestOrigin)
    ) {
      await next();
      return;
    }

    return c.json(INVALID_ORIGIN_RESPONSE, 403);
  }
);

export function resolveAuthWorkerTrustedOrigins(
  c: Context<AppContext>
): ReadonlySet<string> {
  return new Set(
    resolveTrustedOrigins({
      baseAuthUrl: c.env.BETTER_AUTH_URL ?? "",
      developmentTarget: c.env.AUTH_DESKTOP_DEVELOPMENT_TARGET,
      appUrl: c.env.WEB_APP_URL ?? c.env.BETTER_AUTH_URL ?? "",
      env:
        c.env.AUTH_WORKER_NODE_ENV === "production"
          ? "production"
          : "development",
    })
  );
}

function readRequestOrigin(headers: Headers): string | null {
  // URL.origin is "null" for the custom Desktop scheme. Preserve only the
  // exact native Origin; the existing environment trust set still decides
  // whether it is admitted. Callback schemes are not cookie-write origins.
  if (headers.get("origin") === DESKTOP_APP_ORIGIN) {
    return DESKTOP_APP_ORIGIN;
  }
  const source = headers.get("origin") || headers.get("referer");
  if (!source || source === "null") {
    return null;
  }

  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
