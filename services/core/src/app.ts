import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { trimTrailingSlash } from "hono/trailing-slash";
import { warnOnSharedDbMigrationDriftOnce } from "./db/migration-drift";
import type { HonoBindings } from "./lib/bindings";
import { resolveActiveOrganizationMembership } from "./organizations/organization-context";
import { registerConfigRoutes } from "./routes/config";
import { registerDaemonRoutes } from "./routes/daemon";
import { registerPrepareSessionRoutes } from "./routes/prepare-session";
import { registerRootRoutes } from "./routes/root";
import { registerSpaceRoutes } from "./routes/spaces";
import { readResolvedOpenMeldContext } from "./shared/context/openmeld-context";
import {
  emitCoreCloudflareRuntimeEvidence,
  readCloudflareRequestEvidence,
} from "./shared/observability/cloudflare-runtime-evidence";

const DEFAULT_CORS_ORIGINS = ["https://gateway.openmeld.ai"];
const OPENMELD_REQUEST_ID_HEADER = "x-openmeld-request-id";
const HONO_REQUEST_ID_HEADER = "x-request-id";

export function resolveCorsOrigins(rawOrigins?: string): string | string[] {
  const originEntries = rawOrigins
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!originEntries?.length) {
    return DEFAULT_CORS_ORIGINS;
  }

  // Hono treats "*" as wildcard only when it's a string, not an array entry.
  if (originEntries.includes("*")) {
    return "*";
  }

  return originEntries;
}

export function createHttpApp() {
  const app = new Hono<HonoBindings>();

  app
    .use((c, next) => {
      const corsMiddleware = cors({
        origin: resolveCorsOrigins(c.env.CORS_ORIGINS),
      });
      return corsMiddleware(c, next);
    })
    .use("*", requestId())
    .use("*", async (c, next) => {
      try {
        warnOnSharedDbMigrationDriftOnce(c.env, (promise) => {
          c.executionCtx.waitUntil(promise);
        });
      } catch {
        // The dev-only drift probe must never affect request handling.
      }
      await next();
    })
    .use("*", async (c, next) => {
      const startedAt = Date.now();
      const runtimeEvidence = readCloudflareRequestEvidence(c.req.raw);
      let thrownError: unknown = null;
      try {
        await next();
      } catch (error) {
        thrownError = error;
        throw error;
      } finally {
        const statusCode = thrownError ? 500 : c.res.status;
        const requestId =
          c.res.headers.get(OPENMELD_REQUEST_ID_HEADER) ??
          c.res.headers.get(HONO_REQUEST_ID_HEADER) ??
          runtimeEvidence.requestId;
        emitCoreCloudflareRuntimeEvidence(c.env, {
          event: "core.openmeld.http_request",
          workerEnvironment: c.env.OPENMELD_WORKER_ENVIRONMENT,
          runtimeKind: "http",
          status: statusCode >= 500 ? "failed" : "succeeded",
          route: c.req.path,
          method: c.req.method,
          statusCode,
          durationMs: Date.now() - startedAt,
          reasonCode: statusCode >= 400 ? `http_${statusCode}` : null,
          errorName: thrownError instanceof Error ? thrownError.name : null,
          cfRayId: runtimeEvidence.cfRayId,
          requestId,
          traceId: runtimeEvidence.traceId,
        });
      }
    })
    .use("*", prettyJSON())
    .use("*", (c, next) => {
      const upgrade = c.req.header("upgrade")?.toLowerCase();
      if (upgrade === "websocket") {
        return next();
      }
      return secureHeaders()(c, next);
    })
    .use("*", trimTrailingSlash());

  app
    .use("/v1/spaces", (c, next) => {
      return requireResolvedOpenMeldContext(c, next, {
        requireActiveOrganization: true,
      });
    })
    .use("/v1/spaces/*", (c, next) => {
      return requireResolvedOpenMeldContext(c, next, {
        requireActiveOrganization: true,
      });
    })
    .use("/v1/organizations", (c, next) => {
      return requireResolvedOpenMeldContext(c, next, {
        requireActiveOrganization: true,
      });
    })
    .use("/v1/organizations/*", (c, next) => {
      return requireResolvedOpenMeldContext(c, next, {
        requireActiveOrganization: true,
      });
    })
    .use("/v1/daemon", (c, next) => {
      return requireResolvedOpenMeldContext(c, next);
    })
    .use("/v1/daemon/*", (c, next) => {
      return requireResolvedOpenMeldContext(c, next);
    });

  registerRootRoutes(app);
  registerConfigRoutes(app);
  registerDaemonRoutes(app);
  registerPrepareSessionRoutes(app);
  registerSpaceRoutes(app);

  app.onError((error, c) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const requestId =
      c.req.header(OPENMELD_REQUEST_ID_HEADER) ??
      c.req.header("x-request-id") ??
      crypto.randomUUID();

    console.error("[core.internal_error]", {
      message: errorMessage,
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      method: c.req.method,
      path: c.req.path,
      requestId,
    });

    return c.json(
      {
        ok: false,
        code: "core.internal_error",
        message: "Internal server error",
        requestId,
      },
      500,
      buildErrorResponseHeaders(c, requestId)
    );
  });

  return app;
}

async function requireResolvedOpenMeldContext(
  c: Context<HonoBindings>,
  next: () => Promise<void>,
  options?: {
    requireActiveOrganization?: boolean;
  }
): Promise<Response | undefined> {
  const fallbackRequestId =
    c.req.header(OPENMELD_REQUEST_ID_HEADER) ??
    c.req.header("x-request-id") ??
    crypto.randomUUID();
  const resolved = readResolvedOpenMeldContext(
    c.req.raw.headers,
    fallbackRequestId
  );
  if (!resolved.ok) {
    return c.json(
      {
        ok: false,
        code: "auth.unauthenticated",
        message: resolved.message,
        requestId: resolved.requestId,
      },
      401,
      {
        [OPENMELD_REQUEST_ID_HEADER]: resolved.requestId,
      }
    );
  }

  c.set("openMeldRequestContext", resolved.context);
  if (resolved.spacePassword !== undefined) {
    c.set("spacePassword", resolved.spacePassword);
  }
  if (options?.requireActiveOrganization) {
    const organizationGate = await validateActiveOrganizationMembership(c);
    if (organizationGate) {
      return organizationGate;
    }
  }
  await next();
}

async function validateActiveOrganizationMembership(
  c: Context<HonoBindings>
): Promise<Response | undefined> {
  const context = c.get("openMeldRequestContext");
  const requestId = context.actorContext.requestId;
  const membership = await resolveActiveOrganizationMembership({
    context,
    env: c.env,
  });
  if (membership.ok) {
    return undefined;
  }

  return c.json(
    {
      ok: false,
      code: membership.code,
      message: membership.message,
      requestId,
    },
    membership.status,
    { [OPENMELD_REQUEST_ID_HEADER]: requestId }
  );
}

export const app = createHttpApp();

function buildErrorResponseHeaders(
  c: Context<HonoBindings>,
  requestId: string
): Record<string, string> {
  const headers: Record<string, string> = {
    [OPENMELD_REQUEST_ID_HEADER]: requestId,
  };

  const resolvedOrigins = resolveCorsOrigins(c.env.CORS_ORIGINS);
  if (resolvedOrigins === "*") {
    headers["access-control-allow-origin"] = "*";
    headers["access-control-expose-headers"] = OPENMELD_REQUEST_ID_HEADER;
    return headers;
  }

  const requestOrigin = c.req.header("origin");
  if (requestOrigin && resolvedOrigins.includes(requestOrigin)) {
    headers["access-control-allow-origin"] = requestOrigin;
    headers["access-control-expose-headers"] = OPENMELD_REQUEST_ID_HEADER;
    headers.vary = "Origin";
  }

  return headers;
}
