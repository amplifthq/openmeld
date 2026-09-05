import type { OrganizationJoinRequest } from "@openmeld/schemas";
import {
  organizationJoinRequestInputSchema,
  organizationJoinRequestResponseSchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { AppContext } from "../context";
import { authContextMiddleware } from "../middlewares/auth";
import { requireTrustedCookieOrigin } from "../middlewares/trusted-origin";
import {
  createNativeInvitationCaller,
  sendSpaceInvitation,
} from "./space-invitation-routes";

export function registerOrganizationJoinRequestRoutes(app: Hono<AppContext>) {
  app.post(
    "/api/auth/organization/join-requests",
    requireTrustedCookieOrigin,
    authContextMiddleware,
    async (c) => {
      const user = c.var.user;
      if (!user) {
        return c.json(
          {
            ok: false,
            code: "organization.join_request.authentication_required",
            message: "Sign in to continue.",
          },
          401
        );
      }
      const input = organizationJoinRequestInputSchema.safeParse(
        await c.req.json().catch(() => null)
      );
      if (!input.success) {
        return c.json(
          {
            ok: false,
            code: "organization.join_request.invalid_input",
            message: "Check the invitation request and try again.",
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
          userId: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
          request: input.data,
        })
      );
      const approved =
        result.ok && input.data.action === "approve"
          ? result.requests[0]
          : null;
      if (approved?.status === "approved") {
        return deliverApprovedInvitation(c, approved);
      }
      return c.json(result, result.ok ? 200 : 400);
    }
  );
}

async function deliverApprovedInvitation(
  c: Context<AppContext>,
  approved: OrganizationJoinRequest
) {
  const user = c.var.user;
  const core = c.env.OPENMELD_CORE_WORKER;
  if (!(user && core)) {
    throw new Error("Authenticated invitation delivery requires Core");
  }
  if (approved.reviewedByUserId !== user.id) {
    return c.json(
      {
        ok: false,
        code: "organization.join_request.already_reviewed",
        message:
          "Another administrator handled this request. Refresh to see the result.",
      },
      409
    );
  }
  const native = createNativeInvitationCaller(c);
  const delivery = approved.spaceId
    ? await sendSpaceInvitation(
        c,
        native,
        await core.spaceInvitation({
          userId: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
          request: { action: "create_approved", requestId: approved.id },
        })
      )
    : await native("invite-member", {
        organizationId: approved.organizationId,
        email: approved.email,
        role: "member",
        resend: true,
      });
  if (!delivery.ok) {
    return c.json(
      {
        ok: false,
        code: "organization.join_request.delivery_failed",
        message:
          "The request was approved, but the invitation could not be sent. Retry sending the approved invitation.",
      },
      503
    );
  }
  const delivered = organizationJoinRequestResponseSchema.parse(
    await core.organizationJoinRequest({
      userId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      request: { action: "delivery_complete", requestId: approved.id },
    })
  );
  return c.json(delivered, delivered.ok ? 200 : 503);
}
