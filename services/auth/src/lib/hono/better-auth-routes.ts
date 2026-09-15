import type { Context, Hono } from "hono";
import { getAccountOrganizationPreferenceRepository } from "../account/organization-preference-service";
import type { AppContext } from "../context";
import { requireTrustedCookieOrigin } from "../middlewares/trusted-origin";
import { toDiagnosticError } from "../observability/diagnostic-error";

const BETTER_AUTH_SESSION_ROUTE = "/api/auth/get-session";

export function registerBetterAuthRoutes(app: Hono<AppContext>) {
  // These ordinary business writes are also reached by the fixed Web/Desktop
  // adapters. Keep cookie CSRF enforcement ahead of the native Auth handler.
  for (const operation of [
    "update",
    "delete",
    "invite-member",
    "accept-invitation",
    "cancel-invitation",
    "update-member-role",
    "remove-member",
  ] as const) {
    app.post(
      `/api/auth/organization/${operation}`,
      requireTrustedCookieOrigin,
      (c) => c.var.betterAuth.handler(c.req.raw)
    );
  }
  app.get(BETTER_AUTH_SESSION_ROUTE, async (c) => {
    const response = await c.var.betterAuth.handler(c.req.raw);
    return projectLastSelectedOrganization(c, response);
  });

  app.on(["GET", "POST"], "/api/auth/*", (c) => {
    return c.var.betterAuth.handler(c.req.raw);
  });
}

async function projectLastSelectedOrganization(
  c: Context<AppContext>,
  response: Response
): Promise<Response> {
  if (!response.ok) {
    return response;
  }

  const payload: unknown = await response.clone().json();
  if (payload === null) {
    return response;
  }
  if (!isSessionPayload(payload)) {
    throw new TypeError("Better Auth returned an invalid session response.");
  }

  let lastSelectedOrganizationId: string | null;
  try {
    lastSelectedOrganizationId =
      await getAccountOrganizationPreferenceRepository(
        c.env
      ).getLastSelectedOrganizationId(payload.user.id);
  } catch (error) {
    console.warn("[auth.account_organization_preference_projection_failed]", {
      event: "auth.account_organization_preference_projection_failed",
      error: toDiagnosticError(error),
      requestId: c.var.requestId,
      userId: payload.user.id,
    });
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");

  return new Response(
    JSON.stringify({
      ...payload,
      user: {
        ...payload.user,
        lastSelectedOrganizationId,
      },
    }),
    {
      headers,
      status: response.status,
      statusText: response.statusText,
    }
  );
}

function isSessionPayload(value: unknown): value is Record<string, unknown> & {
  user: Record<string, unknown> & { id: string };
} {
  if (!(value && typeof value === "object" && "user" in value)) {
    return false;
  }

  const user = value.user;
  return Boolean(
    user &&
      typeof user === "object" &&
      "id" in user &&
      typeof user.id === "string" &&
      user.id.length > 0
  );
}
