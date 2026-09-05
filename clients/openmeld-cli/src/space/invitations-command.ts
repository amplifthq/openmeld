import {
  type SpaceInvitationRequest,
  spaceInvitationRequestSchema,
  spaceInvitationResponseSchema,
} from "@openmeld/schemas";
import { getAuthSessionState } from "../config/auth-session";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";

const TRAILING_SLASHES = /\/+$/u;

export async function runSpaceInvitations(input: {
  action: string;
  space?: string;
  email?: string;
  invitationId?: string;
  view?: string;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  const reportError = (code: string, message: string) => {
    process.exitCode = 1;
    if (presenter.view === "agent") {
      presenter.data({ code, payload: { status: "error", message } });
    } else {
      presenter.line({ code, text: message });
    }
  };
  const auth = await getAuthSessionState({ validateRemote: true });
  if (auth.state !== "valid" || !auth.session) {
    reportError(
      "space.invitation.authentication_required",
      "Run openmeld login, then retry this command."
    );
    return;
  }
  const session = auth.session;
  let request: unknown;
  if (input.action === "create" || input.action === "list") {
    request = {
      action: input.action,
      organizationId: session.activeOrganization?.id,
      spaceId: input.space,
      ...(input.action === "create" ? { email: input.email } : {}),
    };
  } else if (input.action === "pending") {
    request = { action: "pending" };
  } else {
    request = { action: input.action, invitationId: input.invitationId };
  }
  const parsed = spaceInvitationRequestSchema.safeParse(request);
  if (!parsed.success) {
    reportError(
      "space.invitation.invalid_input",
      "Use space invitations --help to choose an action. Sending and listing require --space and an active organization; sending also requires --email."
    );
    return;
  }
  try {
    const url = new URL(session.authBaseUrl);
    url.pathname = `${url.pathname.replace(TRAILING_SLASHES, "")}/api/auth/space-invitations`;
    url.search = "";
    url.hash = "";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `${session.tokenType} ${session.accessToken}`,
      },
      body: JSON.stringify(parsed.data satisfies SpaceInvitationRequest),
    });
    const result = spaceInvitationResponseSchema.safeParse(
      await response.json()
    );
    if (!result.success) {
      reportError(
        "space.invitation.response_invalid",
        `The invitation service returned an invalid response (HTTP ${response.status}). Try again.`
      );
      return;
    }
    if (!result.data.ok) {
      reportError(result.data.code, result.data.message);
      return;
    }
    if (presenter.view === "agent") {
      presenter.data({ code: "space.invitation.result", payload: result.data });
      return;
    }
    for (const invitation of result.data.invitations) {
      presenter.line({
        code: "space.invitation.result",
        text: `${invitation.spaceName} (${invitation.organizationName}) — ${invitation.email} — ${invitation.status}\nInvitation: ${invitation.id}\nSpace: ${invitation.spaceId}`,
      });
    }
    if (!result.data.invitations.length) {
      presenter.line({
        code: "space.invitation.empty",
        text: "No pending Space invitations.",
      });
    }
  } catch (error) {
    reportError(
      "space.invitation.request_failed",
      error instanceof Error
        ? error.message
        : "The invitation request failed. Try again."
    );
  }
}
