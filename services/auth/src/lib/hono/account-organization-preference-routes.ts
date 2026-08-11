import { AccountOrganizationMembershipRequiredError } from "@openmeld/auth/server";
import {
  selectLastSelectedOrganizationBodySchema,
  selectLastSelectedOrganizationErrorResponseSchema,
} from "@openmeld/schemas";
import type { SelectLastSelectedOrganizationErrorCode } from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../context";
import { requireTrustedCookieOrigin } from "../middlewares/trusted-origin";
import { logError } from "../utils/loggers";
import { ACCOUNT_LAST_SELECTED_ORGANIZATION_ROUTE } from "./account-route-paths";
import { requireAuthenticatedUser } from "./authenticated-user";

type DiagnosticError = {
  cause?: DiagnosticError;
  message: string;
  name: string | null;
  stack?: string;
};

type AccountPreferenceErrorResponseInput = {
  code: SelectLastSelectedOrganizationErrorCode;
  message: string;
  status: 400 | 401 | 403 | 500 | 503;
};

export const accountOrganizationPreferenceErrorEnvelopeMiddleware =
  createMiddleware<AppContext>(async (c, next) => {
    await next();

    if (c.req.method !== "PATCH" || c.res.ok) {
      return;
    }

    const responseBody = await c.res
      .clone()
      .json()
      .catch(() => null);
    if (
      selectLastSelectedOrganizationErrorResponseSchema.safeParse(responseBody)
        .success
    ) {
      return;
    }

    c.res = accountPreferenceErrorResponse(
      c,
      resolveAccountPreferenceBoundaryError(c.res.status)
    );
  });

export function registerAccountOrganizationPreferenceRoutes(
  app: Hono<AppContext>
) {
  app.patch(
    ACCOUNT_LAST_SELECTED_ORGANIZATION_ROUTE,
    requireTrustedCookieOrigin,
    async (c) => {
      const authenticated = requireAuthenticatedUser(c);
      if (!authenticated.ok) {
        return accountPreferenceErrorResponse(c, {
          code: "auth.unauthenticated",
          message: "Sign in again to continue.",
          status: 401,
        });
      }

      const parsedBody = selectLastSelectedOrganizationBodySchema.safeParse(
        await c.req.json().catch(() => null)
      );
      if (!parsedBody.success) {
        return accountPreferenceErrorResponse(c, {
          code: "invalid_payload",
          message: "Choose a valid organization.",
          status: 400,
        });
      }

      try {
        const result =
          await c.var.accountOrganizationPreferenceService.selectOrganization({
            organizationId: parsedBody.data.organizationId,
            userId: String(authenticated.user.id),
          });
        return c.json({ ok: true as const, ...result });
      } catch (error) {
        if (error instanceof AccountOrganizationMembershipRequiredError) {
          return accountPreferenceErrorResponse(c, {
            code: "organization.membership_required",
            message: error.message,
            status: 403,
          });
        }
        logAccountPreferenceSelectionFailure(c, error);
        return accountPreferenceErrorResponse(c, {
          code: "upstream_error",
          message: "OpenMeld couldn't save your organization. Try again.",
          status: 500,
        });
      }
    }
  );
}

function accountPreferenceErrorResponse(
  c: Context<AppContext>,
  input: AccountPreferenceErrorResponseInput
): Response {
  return c.json(
    selectLastSelectedOrganizationErrorResponseSchema.parse({
      error: {
        code: input.code,
        message: input.message,
        requestId: c.var.requestId,
      },
      ok: false,
    }),
    input.status
  );
}

function resolveAccountPreferenceBoundaryError(
  status: number
): AccountPreferenceErrorResponseInput {
  if (status === 400) {
    return {
      code: "invalid_payload",
      message: "Choose a valid organization.",
      status,
    };
  }
  if (status === 401) {
    return {
      code: "auth.unauthenticated",
      message: "Sign in again to continue.",
      status,
    };
  }
  if (status === 403) {
    return {
      code: "auth.invalid_origin",
      message: "Refresh the page and try again.",
      status,
    };
  }
  if (status === 503) {
    return {
      code: "upstream_unreachable",
      message: "OpenMeld couldn't reach authentication. Try again.",
      status,
    };
  }
  return {
    code: "upstream_error",
    message: "OpenMeld couldn't verify your session. Try again.",
    status: 500,
  };
}

function logAccountPreferenceSelectionFailure(
  c: Context<AppContext>,
  error: unknown
): void {
  logError("[auth.account_organization_preference_selection_failed]", {
    error: toDiagnosticError(error),
    method: c.req.method,
    path: c.req.path,
    requestId: c.var.requestId,
  });
}

function toDiagnosticError(
  error: unknown,
  remainingCauseDepth = 2
): DiagnosticError {
  if (!(error instanceof Error)) {
    return {
      message: String(error),
      name: null,
    };
  }

  return {
    message: error.message,
    name: error.name,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(remainingCauseDepth > 0 && error.cause !== undefined
      ? {
          cause: toDiagnosticError(error.cause, remainingCauseDepth - 1),
        }
      : {}),
  };
}
