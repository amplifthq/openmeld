import {
  createD1Db,
  createDrizzleOrganizationJoinLinkRepository,
  createOrganizationJoinLinkService,
  DEFAULT_AUTH_BASE_URL,
  OrganizationJoinLinkServiceError,
} from "@openmeld/auth/server";
import {
  acceptOrganizationJoinLinkBodySchema,
  acceptOrganizationJoinLinkResponseSchema,
  getOrganizationJoinLinkResponseSchema,
  ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMITED_ERROR_CODE,
  organizationJoinLinkErrorResponseSchema,
  organizationJoinLinkManagementQuerySchema,
  previewOrganizationJoinLinkQuerySchema,
  previewOrganizationJoinLinkResponseSchema,
  revokeOrganizationJoinLinkResponseSchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getOrganizationServerApi } from "../better-auth/organization-server-api";
import type { AppContext } from "../context";
import { authContextMiddleware } from "../middlewares/auth";
import { requireTrustedCookieOrigin } from "../middlewares/trusted-origin";

export const ORGANIZATION_JOIN_LINK_ROUTE =
  "/api/auth/organization/join-link" as const;

const INVALID_INPUT_RESPONSE = organizationJoinLinkErrorResponseSchema.parse({
  code: "organization.join_link.invalid_input",
  message: "Invalid organization join link request.",
  ok: false,
});

const AUTHENTICATION_REQUIRED_RESPONSE =
  organizationJoinLinkErrorResponseSchema.parse({
    code: "organization.join_link.authentication_required",
    message: "Sign in to continue.",
    ok: false,
  });

const FORBIDDEN_RESPONSE = organizationJoinLinkErrorResponseSchema.parse({
  code: "organization.join_link.forbidden",
  message: "You do not have permission to manage this organization join link.",
  ok: false,
});

const ACCEPT_RATE_LIMITED_RESPONSE =
  organizationJoinLinkErrorResponseSchema.parse({
    code: ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMITED_ERROR_CODE,
    message: "Too many join attempts. Try again in a minute.",
    ok: false,
  });

type JoinLinkPermissionAction = "create" | "read" | "revoke";

export function registerOrganizationJoinLinkRoutes(app: Hono<AppContext>) {
  app.get(ORGANIZATION_JOIN_LINK_ROUTE, authContextMiddleware, async (c) => {
    const input = organizationJoinLinkManagementQuerySchema.safeParse(
      c.req.query()
    );
    if (!input.success) {
      return c.json(INVALID_INPUT_RESPONSE, 400);
    }
    const authorization = await authorizeJoinLinkManagement(
      c,
      input.data.organizationId,
      "read"
    );
    if (authorization) {
      return authorization;
    }

    const joinLink = await getOrganizationJoinLinkService(c).getActive(
      input.data.organizationId
    );
    return c.json(
      getOrganizationJoinLinkResponseSchema.parse({
        joinLink,
        ok: true,
      }),
      200
    );
  });

  app.post(
    ORGANIZATION_JOIN_LINK_ROUTE,
    requireTrustedCookieOrigin,
    authContextMiddleware,
    async (c) => {
      const input = organizationJoinLinkManagementQuerySchema.safeParse(
        c.req.query()
      );
      if (!input.success) {
        return c.json(INVALID_INPUT_RESPONSE, 400);
      }
      const authorization = await authorizeJoinLinkManagement(
        c,
        input.data.organizationId,
        "create"
      );
      if (authorization) {
        return authorization;
      }

      try {
        const joinLink = await getOrganizationJoinLinkService(c).reset({
          createdBy: requireAuthenticatedUser(c).id,
          organizationId: input.data.organizationId,
        });
        return c.json(
          getOrganizationJoinLinkResponseSchema.parse({
            joinLink,
            ok: true,
          }),
          201
        );
      } catch (error) {
        return handleOrganizationJoinLinkServiceError(c, error);
      }
    }
  );

  app.delete(
    ORGANIZATION_JOIN_LINK_ROUTE,
    requireTrustedCookieOrigin,
    authContextMiddleware,
    async (c) => {
      const input = organizationJoinLinkManagementQuerySchema.safeParse(
        c.req.query()
      );
      if (!input.success) {
        return c.json(INVALID_INPUT_RESPONSE, 400);
      }
      const authorization = await authorizeJoinLinkManagement(
        c,
        input.data.organizationId,
        "revoke"
      );
      if (authorization) {
        return authorization;
      }

      const revoked = await getOrganizationJoinLinkService(c).revoke(
        input.data.organizationId
      );
      return c.json(
        revokeOrganizationJoinLinkResponseSchema.parse({
          ok: true,
          revoked,
        }),
        200
      );
    }
  );

  app.get(`${ORGANIZATION_JOIN_LINK_ROUTE}/preview`, async (c) => {
    const input = previewOrganizationJoinLinkQuerySchema.safeParse(
      c.req.query()
    );
    if (!input.success) {
      return c.json(INVALID_INPUT_RESPONSE, 400);
    }

    const response = await getOrganizationJoinLinkService(c).preview(
      input.data.token
    );
    return c.json(
      previewOrganizationJoinLinkResponseSchema.parse(response),
      200
    );
  });

  app.post(
    `${ORGANIZATION_JOIN_LINK_ROUTE}/accept`,
    requireTrustedCookieOrigin,
    authContextMiddleware,
    async (c) => {
      const body = acceptOrganizationJoinLinkBodySchema.safeParse(
        await c.req.json().catch(() => null)
      );
      if (!body.success) {
        return c.json(INVALID_INPUT_RESPONSE, 400);
      }
      const user = c.var.user;
      if (!user) {
        return c.json(AUTHENTICATION_REQUIRED_RESPONSE, 401);
      }
      const rateLimitOutcome = await requireJoinLinkAcceptRateLimiter(c).limit({
        key: `ip:${readClientIpAddress(c.req.raw.headers)}`,
      });
      if (!rateLimitOutcome.success) {
        logJoinLinkAcceptRateLimitRejection(c);
        return c.json(ACCEPT_RATE_LIMITED_RESPONSE, 429);
      }

      try {
        const response = await getOrganizationJoinLinkService(c).accept({
          addMember: (input) =>
            getOrganizationServerApi(c.var.betterAuth).addMember({
              body: input,
            }),
          emailVerified: user.emailVerified,
          token: body.data.token,
          userId: user.id,
        });
        return c.json(
          acceptOrganizationJoinLinkResponseSchema.parse(response),
          200
        );
      } catch (error) {
        return handleOrganizationJoinLinkServiceError(c, error);
      }
    }
  );
}

function requireJoinLinkAcceptRateLimiter(c: Context<AppContext>): RateLimit {
  const binding = c.env.OPENMELD_ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMITER;
  if (!binding?.limit) {
    throw new Error(
      "Organization join-link accept rate limit binding is unavailable"
    );
  }
  return binding;
}

function readClientIpAddress(headers: Headers): string {
  return headers.get("CF-Connecting-IP")?.trim() || "unknown";
}

function logJoinLinkAcceptRateLimitRejection(c: Context<AppContext>): void {
  console.warn("[auth.organization_join_link.accept_rate_limited]", {
    event: "auth.organization_join_link.accept_rate_limited",
    rateLimitDimension: "ip",
    reasonCode: ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMITED_ERROR_CODE,
    requestId: c.var.requestId,
  });
}

async function authorizeJoinLinkManagement(
  c: Context<AppContext>,
  organizationId: string,
  action: JoinLinkPermissionAction
): Promise<Response | null> {
  if (!c.var.user) {
    return c.json(AUTHENTICATION_REQUIRED_RESPONSE, 401);
  }
  const result = await getOrganizationServerApi(c.var.betterAuth).hasPermission(
    {
      body: {
        organizationId,
        permissions: { joinLink: [action] },
      },
      headers: c.req.raw.headers,
    }
  );
  return result.success ? null : c.json(FORBIDDEN_RESPONSE, 403);
}

function getOrganizationJoinLinkService(c: Context<AppContext>) {
  return createOrganizationJoinLinkService({
    repository: createDrizzleOrganizationJoinLinkRepository(
      createD1Db(c.env.OPENMELD_DB)
    ),
    webAppUrl:
      c.env.WEB_APP_URL ?? c.env.BETTER_AUTH_URL ?? DEFAULT_AUTH_BASE_URL,
  });
}

function requireAuthenticatedUser(c: Context<AppContext>) {
  const user = c.var.user;
  if (!user) {
    throw new Error("Authenticated organization join link route has no user");
  }
  return user;
}

function handleOrganizationJoinLinkServiceError(
  c: Context<AppContext>,
  error: unknown
): Response {
  if (!(error instanceof OrganizationJoinLinkServiceError)) {
    throw error;
  }

  const status = resolveServiceErrorStatus(error);
  return c.json(
    organizationJoinLinkErrorResponseSchema.parse({
      code: error.code,
      message: error.message,
      ok: false,
    }),
    status
  );
}

function resolveServiceErrorStatus(
  error: OrganizationJoinLinkServiceError
): ContentfulStatusCode {
  if (error.code === "organization.join_link.inactive") {
    return 404;
  }
  if (error.code === "organization.join_link.email_verification_required") {
    return 403;
  }
  return 400;
}
