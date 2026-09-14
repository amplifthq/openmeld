import {
  ACCOUNT_ORGANIZATION_CONTEXT_PATH,
  ACCOUNT_SESSION_PATH,
} from "@openmeld/schemas";
import { createMiddleware } from "hono/factory";
import { loadBetterAuthRuntime } from "../../lazy-runtime-modules";
import { getLocalAuthUserStore } from "../better-auth/local-auth-user-store";
import {
  AUTH_UPSTREAM_UNREACHABLE_CODE,
  AUTH_UPSTREAM_UNREACHABLE_MESSAGE,
  resolveSessionFromHeaders,
  toSessionResolutionErrorLog,
} from "../better-auth/session-resolver";
import type { AppContext } from "../context";
import { logError, logWarn } from "../utils/loggers";

export const authInstanceMiddleware = createMiddleware<AppContext>(
  async (c, next) => {
    const { createAuth, runWithAuthRequestState } =
      await loadBetterAuthRuntime();
    c.set("betterAuth", createAuth(c.env));
    c.set("user", null);
    c.set("session", null);
    await runWithAuthRequestState(next);
  }
);

export const authContextMiddleware = createMiddleware<AppContext>(
  async (c, next) => {
    const sessionResolution = await resolveSessionFromHeaders({
      auth: c.var.betterAuth,
      headers: c.req.raw.headers,
      disableCookieCache:
        c.req.path === ACCOUNT_ORGANIZATION_CONTEXT_PATH ||
        c.req.path === ACCOUNT_SESSION_PATH,
      ...(c.req.path === ACCOUNT_SESSION_PATH
        ? {
            onSessionCookies: (cookies: readonly string[]) => {
              for (const cookie of cookies) {
                c.header("set-cookie", cookie, { append: true });
              }
            },
          }
        : {}),
      verifyLocalUserExists: (userId) =>
        getLocalAuthUserStore(c.env).hasUserById(userId),
    });
    if (sessionResolution.status === "authenticated") {
      c.set("user", sessionResolution.user);
      c.set("session", sessionResolution.session);
      await next();
      return;
    }

    if (sessionResolution.status === "unauthenticated") {
      if (sessionResolution.reason === "stale_local_user") {
        logWarn(
          c.env.AUTH_WORKER_NODE_ENV,
          "[auth.context_middleware.stale_local_session]",
          {
            method: c.req.method,
            path: c.req.path,
            userId: sessionResolution.userId,
          }
        );
      }
      await next();
      return;
    }

    if (sessionResolution.status === "local_state_error") {
      logError("[auth.context_middleware.local_session_state_failed]", {
        error: toSessionResolutionErrorLog(sessionResolution.cause),
        method: c.req.method,
        path: c.req.path,
      });
      return c.json(
        {
          ok: false,
          code: "auth.internal_error",
          message: "Internal server error",
        },
        500
      );
    }

    logError("[auth.context_middleware.session_resolution_failed]", {
      error: toSessionResolutionErrorLog(sessionResolution.cause),
      method: c.req.method,
      path: c.req.path,
    });
    return c.json(
      {
        ok: false,
        code: AUTH_UPSTREAM_UNREACHABLE_CODE,
        message: AUTH_UPSTREAM_UNREACHABLE_MESSAGE,
      },
      503
    );
  }
);
