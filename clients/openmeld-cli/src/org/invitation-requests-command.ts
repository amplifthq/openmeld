import {
  acceptOrganizationJoinLinkBodySchema,
  getOrganizationJoinLinkResponseSchema,
  organizationJoinLinkManagementQuerySchema,
  organizationJoinRequestInputSchema,
  organizationJoinRequestResponseSchema,
} from "@openmeld/schemas";
import { getAuthSessionState } from "../config/auth-session";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";

type InvitationRequestOptions = {
  action: string;
  email?: string;
  space?: string;
  request?: string;
  token?: string;
  view?: string;
};
const TRAILING_SLASHES = /\/+$/u;
function parseRequest(
  input: InvitationRequestOptions,
  organizationId?: string
) {
  const scope = {
    organizationId,
    ...(input.space ? { spaceId: input.space } : {}),
  };
  if (input.action === "link") {
    return organizationJoinLinkManagementQuerySchema.safeParse(scope);
  }
  if (input.action === "request") {
    return acceptOrganizationJoinLinkBodySchema.safeParse({
      token: input.token,
    });
  }
  if (input.action === "create") {
    return organizationJoinRequestInputSchema.safeParse({
      action: "create",
      ...scope,
      email: input.email,
    });
  }
  if (input.action === "list") {
    return organizationJoinRequestInputSchema.safeParse({
      action: "list",
      organizationId,
    });
  }
  return organizationJoinRequestInputSchema.safeParse({
    action: input.action,
    requestId: input.request,
  });
}
const ENDPOINTS: Record<string, string> = {
  link: "join-link/ensure",
  request: "join-link/request",
};
const NEXT_ACTIONS: Record<string, string> = {
  link: "Share this link. Each recipient must sign in and request approval.",
  approve: "The recipient must accept the emailed invitation before joining.",
};
export async function runOrganizationInvitationRequests(
  input: InvitationRequestOptions
) {
  const presenter = createPresenter(
    await resolveRuntimeContext({ view: input.view })
  );
  const fail = (code: string, message: string) => {
    process.exitCode = 1;
    if (presenter.view === "agent") {
      presenter.data({ code, payload: { status: "error", message } });
    } else {
      presenter.line({ code, text: message });
    }
  };
  const auth = await getAuthSessionState({ validateRemote: true });
  if (auth.state !== "valid" || !auth.session) {
    fail(
      "organization.join_request.authentication_required",
      "Run openmeld login, then retry this command."
    );
    return;
  }
  const session = auth.session;
  if (
    ["create", "list", "link"].includes(input.action) &&
    !session.activeOrganization?.id
  ) {
    fail(
      "organization.join_request.organization_required",
      "Run openmeld org list, then openmeld org switch <slug> to choose the organization. Retry this command afterward."
    );
    return;
  }
  const body = parseRequest(input, session.activeOrganization?.id);
  if (!body.success) {
    fail(
      "organization.join_request.invalid_input",
      "Use org invitation-requests --help. Create needs --email; review needs --request; request needs --token. Create, list, and link use the active organization."
    );
    return;
  }
  try {
    const url = new URL(session.authBaseUrl);
    const endpoint = ENDPOINTS[input.action] ?? "join-requests";
    url.pathname = `${url.pathname.replace(TRAILING_SLASHES, "")}/api/auth/organization/${endpoint}`;
    url.search = "";
    url.hash = "";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `${session.tokenType} ${session.accessToken}`,
      },
      body: JSON.stringify(body.data),
    });
    const data: unknown = await response.json();
    const error = organizationJoinRequestResponseSchema.safeParse(data);
    if (error.success && !error.data.ok) {
      fail(error.data.code, error.data.message);
      return;
    }
    const result =
      input.action === "link"
        ? getOrganizationJoinLinkResponseSchema.parse(data)
        : organizationJoinRequestResponseSchema.parse(data);
    if (!result.ok) {
      fail(result.code, result.message);
      return;
    }
    const nextAction =
      NEXT_ACTIONS[input.action] ??
      "Use get --request <id> to check status. Owners and admins can approve or reject pending requests.";
    if (presenter.view === "agent") {
      presenter.data({
        code: "organization.join_request.result",
        payload: { ...result, nextAction },
      });
      return;
    }
    presenter.line({
      code: "organization.join_request.result",
      text:
        "joinLink" in result
          ? (result.joinLink?.url ?? "No active link.")
          : result.requests
              .map(
                (request) =>
                  `${request.email} — ${request.status}\nRequest: ${request.id}`
              )
              .join("\n") || "No invitation requests.",
    });
    presenter.line({
      code: "organization.join_request.next_action",
      text: nextAction,
    });
  } catch (error) {
    fail(
      "organization.join_request.request_failed",
      error instanceof Error
        ? error.message
        : "Could not complete the request. Try again."
    );
  }
}
