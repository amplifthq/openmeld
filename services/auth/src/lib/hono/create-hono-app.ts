import { AUTH_SERVICE_NAME } from "@openmeld/auth/server";
import {
  ACCOUNT_ORGANIZATION_CONTEXT_PATH,
  ACCOUNT_SESSION_PATH,
  resolveWorkerReleaseSha,
} from "@openmeld/schemas";
import type { WorkerHealthResponse } from "@openmeld/schemas/types";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { trimTrailingSlash } from "hono/trailing-slash";
import { accountOrganizationPreferenceServiceMiddleware } from "../account/organization-preference-service";
import { accountDisplayNameServiceMiddleware } from "../account/service";
import type { AppContext } from "../context";
import {
  authContextMiddleware,
  authInstanceMiddleware,
} from "../middlewares/auth";
import { openMeldAuthCors } from "../middlewares/cors";
import {
  emitAuthCloudflareRuntimeEvidence,
  readCloudflareRequestEvidence,
  startAccountReadStage,
} from "../observability/cloudflare-runtime-evidence";
import { profileServiceMiddleware } from "../profiles/service";
import { registerAccountDeletionRoutes } from "./account-deletion-routes";
import {
  ACCOUNT_DISPLAY_NAME_COMPATIBILITY_ROUTE,
  registerAccountDisplayNameRoutes,
} from "./account-display-name-routes";
import { registerAccountOrganizationContextRoutes } from "./account-organization-context-routes";
import {
  accountOrganizationPreferenceErrorEnvelopeMiddleware,
  registerAccountOrganizationPreferenceRoutes,
} from "./account-organization-preference-routes";
import {
  ACCOUNT_LAST_SELECTED_ORGANIZATION_ROUTE,
  ACCOUNT_ROUTE_BASE,
} from "./account-route-paths";
import { registerAccountSessionRoutes } from "./account-session-routes";
import { registerAccountSidebarRoutes } from "./account-sidebar-routes";
import { registerBetterAuthRoutes } from "./better-auth-routes";
import {
  MEMBER_AGENT_ROUTE_BASE,
  registerMemberAgentRoutes,
} from "./member-agent-routes";
import { registerOrganizationCreationRoutes } from "./organization-creation-routes";
import { registerOrganizationJoinLinkRoutes } from "./organization-join-link-routes";
import { registerOrganizationJoinRequestRoutes } from "./organization-join-request-routes";
import { registerPasswordRoutes } from "./password-routes";
import { PROFILE_ROUTE_BASE, registerProfileRoutes } from "./profile-routes";
import { registerSpaceInvitationRoutes } from "./space-invitation-routes";
import { registerWaitlistRoutes } from "./waitlist-routes";

export function createHonoApp() {
  const app = new Hono<AppContext>();

  app
    .use("*", openMeldAuthCors)
    .use("*", requestId())
    .use("*", async (c, next) => {
      const startedAt = Date.now();
      const runtimeEvidence = readCloudflareRequestEvidence(c.req.raw);
      const completeAccountRead = startAccountReadStage(c, "request");
      let thrownError: unknown = null;
      try {
        await next();
      } catch (error) {
        thrownError = error;
        throw error;
      } finally {
        const statusCode = thrownError ? 500 : c.res.status;
        completeAccountRead(
          statusCode >= 400 ? "failed" : "succeeded",
          statusCode >= 400 ? `http_${statusCode}` : undefined
        );
        const requestId =
          c.res.headers.get("x-openmeld-request-id") ??
          c.res.headers.get("x-request-id") ??
          runtimeEvidence.requestId;
        emitAuthCloudflareRuntimeEvidence(c.env, {
          event: "auth.openmeld.http_request",
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
    .use("*", secureHeaders())
    .use("*", trimTrailingSlash())
    .use("*", authInstanceMiddleware)
    .use("*", profileServiceMiddleware);

  // Hono wildcard mounts also match the base path, so a single mount keeps
  // exact `/v1/profiles` requests from resolving the session twice.
  app.use(`${PROFILE_ROUTE_BASE}/*`, authContextMiddleware);
  app.use(`${MEMBER_AGENT_ROUTE_BASE}/*`, authContextMiddleware);
  for (const path of [
    ACCOUNT_ORGANIZATION_CONTEXT_PATH,
    ACCOUNT_SESSION_PATH,
  ]) {
    app.use(path, async (c, next) => {
      c.header("Cache-Control", "private, no-store");
      await next();
    });
  }
  app.use(
    ACCOUNT_LAST_SELECTED_ORGANIZATION_ROUTE,
    accountOrganizationPreferenceErrorEnvelopeMiddleware
  );
  app.use(`${ACCOUNT_ROUTE_BASE}/*`, authContextMiddleware);
  app.use(`${ACCOUNT_ROUTE_BASE}/*`, accountDisplayNameServiceMiddleware);
  app.use(
    `${ACCOUNT_ROUTE_BASE}/*`,
    accountOrganizationPreferenceServiceMiddleware
  );
  app.use(ACCOUNT_DISPLAY_NAME_COMPATIBILITY_ROUTE, authContextMiddleware);
  app.use(
    ACCOUNT_DISPLAY_NAME_COMPATIBILITY_ROUTE,
    accountDisplayNameServiceMiddleware
  );

  registerAccountDisplayNameRoutes(app);
  registerAccountDeletionRoutes(app);
  registerAccountOrganizationPreferenceRoutes(app);
  registerAccountSidebarRoutes(app);
  registerAccountOrganizationContextRoutes(app);
  registerAccountSessionRoutes(app);
  registerProfileRoutes(app);
  registerMemberAgentRoutes(app);
  registerPasswordRoutes(app);
  registerWaitlistRoutes(app);
  registerOrganizationCreationRoutes(app);
  registerOrganizationJoinLinkRoutes(app);
  registerSpaceInvitationRoutes(app);
  registerOrganizationJoinRequestRoutes(app);
  registerBetterAuthRoutes(app);

  app.get("/", (c) => {
    return c.json({ ok: true, service: AUTH_SERVICE_NAME });
  });

  app.get("/health", (c) => {
    return c.json({
      ok: true,
      service: AUTH_SERVICE_NAME,
      releaseSha: resolveWorkerReleaseSha(c.env.RELEASE_SHA),
    } satisfies WorkerHealthResponse);
  });

  app.notFound((c) => {
    return c.json(
      {
        ok: false,
        code: "auth.not_found",
        message: "not found",
      },
      404
    );
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse();
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[auth.internal_error]", {
      message: errorMessage,
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      method: c.req.method,
      path: c.req.path,
    });
    const isProduction = c.env.AUTH_WORKER_NODE_ENV === "production";
    return c.json(
      {
        ok: false,
        code: "auth.internal_error",
        message: "Internal server error",
        ...(isProduction ? {} : { detail: errorMessage }),
      },
      500
    );
  });

  return app;
}

export const app = createHonoApp();
