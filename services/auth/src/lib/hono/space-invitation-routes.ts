import {
  buildSpaceInvitationEmailContent,
  sendCloudflareEmail,
} from "@openmeld/auth/server";
import {
  type SpaceInvitation,
  type SpaceInvitationRpcInput,
  type SpaceInvitationRpcResult,
  spaceInvitationRequestSchema,
  spaceInvitationRpcResultSchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { AppContext } from "../context";
import { authContextMiddleware } from "../middlewares/auth";
import { requireTrustedCookieOrigin } from "../middlewares/trusted-origin";

type CallCore = (
  request: SpaceInvitationRpcInput["request"]
) => Promise<SpaceInvitationRpcResult>;
type CallNative = (
  path: string,
  body: unknown,
  spaceInvitationId?: string,
  ownsOrganizationInvitation?: boolean
) => Promise<Response>;

export function registerSpaceInvitationRoutes(app: Hono<AppContext>) {
  app.post(
    "/api/auth/space-invitations",
    requireTrustedCookieOrigin,
    authContextMiddleware,
    async (c) => {
      const user = c.var.user;
      if (!user) {
        return c.json(
          {
            ok: false,
            code: "space.invitation.authentication_required",
            message: "Sign in to continue.",
          },
          401
        );
      }
      const parsed = spaceInvitationRequestSchema.safeParse(
        await c.req.json().catch(() => null)
      );
      if (!parsed.success) {
        return c.json(
          {
            ok: false,
            code: "space.invitation.invalid_input",
            message: "Enter a valid invitation request.",
          },
          400
        );
      }
      const core = c.env.OPENMELD_CORE_WORKER;
      if (!core) {
        throw new Error("Core is required for Space invitations");
      }
      const call = async (request: SpaceInvitationRpcInput["request"]) =>
        spaceInvitationRpcResultSchema.parse(
          await core.spaceInvitation({
            userId: user.id,
            email: user.email,
            emailVerified: user.emailVerified,
            request,
          })
        );
      const native = createNativeInvitationCaller(c);
      const request = parsed.data;
      if (request.action === "accept") {
        return acceptSpaceInvitation(c, call, native, request.invitationId);
      }
      const result = await call(request);
      if (!result.result.ok) {
        return c.json(result.result, 400);
      }
      const cancelError = await cancelUnusedOrganizationInvitation(
        c,
        native,
        result
      );
      if (cancelError) {
        return cancelError;
      }
      if (request.action === "create" || request.action === "resend") {
        return sendSpaceInvitation(c, native, result);
      }
      return c.json(result.result);
    }
  );
}

async function acceptSpaceInvitation(
  c: Context<AppContext>,
  call: CallCore,
  native: CallNative,
  invitationId: string
): Promise<Response> {
  const claimed = await call({
    action: "claim",
    invitationId,
  });
  if (!claimed.result.ok) {
    return c.json(claimed.result, 400);
  }
  const invitation = claimed.result.invitations[0];
  if (!invitation) {
    throw new Error("Accepted invitation was not returned");
  }
  if (invitation.status === "accepted") {
    return c.json(claimed.result);
  }
  if (!claimed.organizationMember) {
    if (!claimed.organizationInvitationId) {
      return c.json(
        {
          ok: false,
          code: "space.invitation.email_not_sent",
          message: "This invitation is not ready. Ask the sender to resend it.",
        },
        409
      );
    }
    const response = await native("accept-invitation", {
      invitationId: claimed.organizationInvitationId,
    });
    if (!response.ok) {
      // A parallel acceptance may have joined the same Organization. Check
      // the owner fact before treating the native error as a failure.
      const current = await call({
        action: "preview",
        invitationId: invitation.id,
      });
      if (!current.organizationMember) {
        return c.json(
          {
            ok: false,
            code: "space.invitation.organization_join_failed",
            message:
              "The organization invitation could not be accepted. Ask the sender to resend it, then try again.",
          },
          409
        );
      }
    }
  }
  const completed = await call({
    action: "complete",
    invitationId: invitation.id,
  });
  return c.json(completed.result, completed.result.ok ? 200 : 400);
}
async function cancelUnusedOrganizationInvitation(
  c: Context<AppContext>,
  native: CallNative,
  result: SpaceInvitationRpcResult
): Promise<Response | null> {
  if (result.cancelOrganizationInvitation && result.organizationInvitationId) {
    const cancelled = await native("cancel-invitation", {
      invitationId: result.organizationInvitationId,
    });
    if (!cancelled.ok) {
      const pending = await c.env.OPENMELD_DB.prepare(
        "SELECT id FROM invitations WHERE id = ? AND status = 'pending'"
      )
        .bind(result.organizationInvitationId)
        .first();
      if (pending) {
        return c.json(
          {
            ok: false,
            code: "space.invitation.revoke_incomplete",
            message:
              "Space access was revoked, but the organization invitation could not be cancelled. Retry revoking this invitation.",
          },
          503
        );
      }
    }
  }
  return null;
}
export async function sendSpaceInvitation(
  c: Context<AppContext>,
  native: CallNative,
  result: SpaceInvitationRpcResult
): Promise<Response> {
  if (!result.result.ok) {
    return c.json(result.result, 400);
  }
  const invitation = result.result.invitations[0];
  if (!invitation) {
    throw new Error("Created invitation was not returned");
  }
  if (invitation.status !== "pending" && invitation.status !== "accepting") {
    return c.json(result.result);
  }
  // Native Better Auth remains the only Organization invitation writer.
  const existing = await c.env.OPENMELD_DB.prepare(
    "SELECT id FROM invitations WHERE organization_id = ? AND lower(email) = ? AND status = 'pending' LIMIT 1"
  )
    .bind(invitation.organizationId, invitation.email)
    .first();
  const response = await native(
    "invite-member",
    {
      email: invitation.email,
      organizationId: invitation.organizationId,
      role: "member",
      resend: true,
    },
    invitation.id,
    !existing
  );
  if (!response.ok) {
    const nativeError = (await response.json().catch(() => null)) as {
      code?: string;
    } | null;
    if (nativeError?.code !== "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION") {
      return c.json(
        {
          ok: false,
          code: "space.invitation.send_failed",
          message:
            "The invitation could not be sent. You can retry from Pending invitations.",
        },
        409
      );
    }
  }
  try {
    await sendInvitationEmail(c.env, invitation);
  } catch (error) {
    console.error("[auth.space_invitation.email_failed]", {
      invitationId: invitation.id,
      error,
    });
    return c.json(
      {
        ok: false,
        code: "space.invitation.send_failed",
        message:
          "The invitation was saved, but the email could not be sent. Choose Resend to try again.",
      },
      503
    );
  }
  return c.json(result.result);
}

export function createNativeInvitationCaller(
  c: Context<AppContext>
): CallNative {
  return (
    path,
    body,
    spaceInvitationId,
    ownsOrganizationInvitation = false
  ) => {
    const headers = new Headers(c.req.raw.headers);
    headers.set("content-type", "application/json");
    headers.delete("content-length");
    headers.delete("x-openmeld-space-invitation-id");
    headers.delete("x-openmeld-space-invitation-owns-organization");
    if (spaceInvitationId) {
      headers.set("x-openmeld-space-invitation-id", spaceInvitationId);
    }
    if (ownsOrganizationInvitation) {
      headers.set("x-openmeld-space-invitation-owns-organization", "true");
    }
    return c.var.betterAuth.handler(
      new Request(new URL(`/api/auth/organization/${path}`, c.req.url), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
    );
  };
}

async function sendInvitationEmail(
  env: AppContext["Bindings"],
  invitation: SpaceInvitation
) {
  const webUrl = env.WEB_APP_URL;
  if (!webUrl) {
    throw new Error("WEB_APP_URL is required for invitation email");
  }
  const url = new URL("/accept-space-invitation", webUrl);
  url.searchParams.set("invitationId", invitation.id);
  const brandName = env.AUTH_BRAND_NAME ?? "OpenMeld";
  const content = buildSpaceInvitationEmailContent({
    brandName,
    organizationName: invitation.organizationName,
    spaceName: invitation.spaceName,
    inviterName: invitation.inviterName,
    expiresAt: new Date(invitation.expiresAt),
    invitationUrl: url.toString(),
  });
  await sendCloudflareEmail(env.AUTH_EMAIL, {
    from: env.AUTH_FROM_EMAIL ?? "OpenMeld <noreply@openmeld.ai>",
    to: invitation.email,
    subject: `${invitation.inviterName} invited you to ${invitation.spaceName}`,
    ...content,
  });
}
