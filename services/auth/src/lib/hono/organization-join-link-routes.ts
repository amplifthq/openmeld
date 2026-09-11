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
  organizationJoinRequestResponseForVersion,
  organizationJoinRequestResponseSchema,
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
import {
  fulfillInvitationMembership,
  readInvitationAccount,
} from "./invitation-membership";

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

async function authorizeLinkScope(
  c: Context<AppContext>,
  scope: { organizationId: string; spaceId?: string }
) {
  const user = requireAuthenticatedUser(c);
  const core = c.env.OPENMELD_CORE_WORKER;
  if (!core) {
    throw new Error("Core is required for invitation links");
  }
  const result = organizationJoinRequestResponseSchema.parse(
    await core.organizationJoinRequest({
      userId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      request: {
        action: "authorize_link",
        organizationId: scope.organizationId,
        spaceId: scope.spaceId,
      },
    })
  );
  return result.ok ? null : c.json(result, 403);
}

export function registerOrganizationJoinLinkRoutes(app: Hono<AppContext>) {
  for (const action of ["ensure", "prepare"] as const) {
    app.post(
      `${ORGANIZATION_JOIN_LINK_ROUTE}/${action}`,
      requireTrustedCookieOrigin,
      authContextMiddleware,
      async (c) => {
        const user = c.var.user;
        if (!user) {
          return c.json(AUTHENTICATION_REQUIRED_RESPONSE, 401);
        }
        const body = organizationJoinLinkManagementQuerySchema.safeParse(
          await c.req.json().catch(() => null)
        );
        if (!body.success) {
          return c.json(INVALID_INPUT_RESPONSE, 400);
        }
        const authorization = await authorizeLinkScope(c, {
          organizationId: body.data.organizationId,
          spaceId: body.data.spaceId,
        });
        if (authorization) {
          return authorization;
        }
        try {
          const result = await getOrganizationJoinLinkService(c).ensure({
            actorUserId: user.id,
            ...body.data,
            initialOnly: c.req.path.endsWith("/prepare"),
          });
          return c.json({
            ok: true,
            joinLink: publicJoinLink(
              result.joinLink,
              body.data.responseVersion
            ),
          });
        } catch (error) {
          if (
            c.req.path.endsWith("/prepare") &&
            error instanceof OrganizationJoinLinkServiceError &&
            error.code === "organization.join_link.inactive"
          ) {
            return c.json({ ok: true, joinLink: null });
          }
          return handleOrganizationJoinLinkServiceError(c, error);
        }
      }
    );
  }
  app.post(
    `${ORGANIZATION_JOIN_LINK_ROUTE}/request`,
    requireTrustedCookieOrigin,
    authContextMiddleware,
    async (c) => {
      const user = c.var.user;
      if (!user) {
        return c.json(AUTHENTICATION_REQUIRED_RESPONSE, 401);
      }
      const body = acceptOrganizationJoinLinkBodySchema.safeParse(
        await c.req.json().catch(() => null)
      );
      if (!body.success) {
        return c.json(INVALID_INPUT_RESPONSE, 400);
      }
      const rate = await requireJoinLinkAcceptRateLimiter(c).limit({
        key: `ip:${readClientIpAddress(c.req.raw.headers)}`,
      });
      if (!rate.success) {
        return c.json(ACCEPT_RATE_LIMITED_RESPONSE, 429);
      }
      const repository = createDrizzleOrganizationJoinLinkRepository(
        createD1Db(c.env.OPENMELD_DB)
      );
      const link = await repository.findActiveByToken(body.data.token);
      if (!link || (link.expiresAt && link.expiresAt.getTime() <= Date.now())) {
        return c.json(
          {
            ok: false,
            code: "organization.join_link.inactive",
            message: "This invite link is no longer active.",
          },
          404
        );
      }
      if (link.mode === "direct") {
        return c.json(
          {
            ok: false,
            code: "organization.join_link.invalid_input",
            message: "This is a direct invitation. Open the link to join.",
          },
          400
        );
      }
      const core = c.env.OPENMELD_CORE_WORKER;
      if (!core) {
        throw new Error("Core is required for invitation requests");
      }
      const result = organizationJoinRequestResponseSchema.parse(
        await core.organizationJoinRequest({
          responseVersion:
            c.req.query("responseVersion") === "2" ? "2" : undefined,
          userId: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
          request: {
            action: "create_from_link",
            organizationId: link.organizationId,
            spaceId: link.spaceId ?? undefined,
            sponsorUserId: link.createdBy,
          },
        })
      );
      return c.json(
        organizationJoinRequestResponseForVersion(
          result,
          c.req.query("responseVersion")
        ),
        result.ok ? 200 : 400
      );
    }
  );
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
    if (input.data.mode === "direct") {
      const directAuthorization = await authorizeJoinLinkManagement(
        c,
        input.data.organizationId,
        "create"
      );
      if (directAuthorization) {
        return directAuthorization;
      }
    }
    if (input.data.spaceId) {
      const scopeAuthorization = await authorizeLinkScope(c, input.data);
      if (scopeAuthorization) {
        return scopeAuthorization;
      }
    }

    const joinLink = await getOrganizationJoinLinkService(c).getActive(
      input.data.organizationId,
      input.data.spaceId,
      input.data.mode
    );
    return c.json(
      getOrganizationJoinLinkResponseSchema.parse({
        joinLink: joinLink
          ? publicJoinLink(joinLink, input.data.responseVersion)
          : null,
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
      if (input.data.spaceId) {
        const scopeAuthorization = await authorizeLinkScope(c, input.data);
        if (scopeAuthorization) {
          return scopeAuthorization;
        }
      }

      try {
        const joinLink = await getOrganizationJoinLinkService(c).reset({
          createdBy: requireAuthenticatedUser(c).id,
          organizationId: input.data.organizationId,
          spaceId: input.data.spaceId,
          mode: input.data.mode,
        });
        return c.json(
          getOrganizationJoinLinkResponseSchema.parse({
            joinLink: publicJoinLink(joinLink, input.data.responseVersion),
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
        input.data.organizationId,
        input.data.spaceId,
        input.data.mode
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
    // Existing clients use a strict response schema without Space context.
    // New clients explicitly opt into that context; authorization is unchanged.
    const {
      spaceId: _spaceId,
      mode: _mode,
      expiresAt: _expiresAt,
      ...legacyResponse
    } = response.active
      ? response
      : {
          ...response,
          spaceId: undefined,
          mode: undefined,
          expiresAt: undefined,
        };
    let publicResponse = legacyResponse;
    if (input.data.responseVersion === "3") {
      publicResponse = response;
    } else if (input.data.responseVersion === "2" && response.active) {
      publicResponse = {
        ...legacyResponse,
        spaceId: response.spaceId,
      } as typeof response;
    }
    return c.json(
      previewOrganizationJoinLinkResponseSchema.parse(publicResponse),
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
        const db = createD1Db(c.env.OPENMELD_DB);
        const link = await createDrizzleOrganizationJoinLinkRepository(
          db
        ).findActiveByToken(body.data.token);
        let spaceInvitation: Parameters<
          typeof fulfillInvitationMembership
        >[1]["spaceInvitation"];
        if (link?.mode === "direct" && link.spaceId) {
          const creator = await readInvitationAccount(c, link.createdBy);
          if (!(creator && c.env.OPENMELD_CORE_WORKER)) {
            throw new Error("The invitation sender is unavailable.");
          }
          const authorization = organizationJoinRequestResponseSchema.parse(
            await c.env.OPENMELD_CORE_WORKER.organizationJoinRequest({
              userId: creator.id,
              email: creator.email,
              emailVerified: creator.emailVerified,
              request: {
                action: "authorize_link",
                organizationId: link.organizationId,
                spaceId: link.spaceId,
              },
            })
          );
          if (!authorization.ok) {
            return c.json(authorization, 403);
          }
          spaceInvitation = {
            actor: creator,
            request: {
              action: "create",
              organizationId: link.organizationId,
              spaceId: link.spaceId,
              email: user.email,
            },
          };
        }
        const response = await getOrganizationJoinLinkService(c).accept({
          addMember: (input) =>
            getOrganizationServerApi(c.var.betterAuth).addMember({
              body: input,
            }),
          emailVerified: user.emailVerified,
          token: body.data.token,
          userId: user.id,
        });
        if (spaceInvitation) {
          await fulfillInvitationMembership(c, {
            organizationId: response.organizationId,
            applicant: user,
            spaceInvitation,
          });
        }
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

function publicJoinLink(
  link: import("@openmeld/schemas").OrganizationJoinLink,
  responseVersion?: string
) {
  if (responseVersion === "3") {
    return link;
  }
  const { mode: _mode, expiresAt: _expiresAt, ...legacy } = link;
  return legacy;
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
