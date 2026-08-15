import type {
  SlackOAuthErrorCode,
  SlackOAuthOrganizationMembershipInput,
  SlackOAuthOrganizationMembershipResult,
  SlackOAuthStateConsumeResponse,
  SlackOAuthStateCreateResponse,
} from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { exchangeSlackOAuthCode } from "../lib/slack-oauth-client";
import { resolveGatewayStructuredRpcErrorResponse } from "./rpc-http.helpers";

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "bookmarks:read",
  "bookmarks:write",
  "canvases:read",
  "canvases:write",
  "channels:history",
  "channels:join",
  "channels:read",
  "chat:write",
  "commands",
  "files:read",
  "groups:history",
  "groups:read",
  "groups:write",
  "im:history",
  "im:write",
  "links:read",
  "links:write",
  "pins:read",
  "pins:write",
  "reactions:read",
  "reactions:write",
  "search:read.files",
  "search:read.public",
  "usergroups:read",
  "users:read",
  "users:read.email",
] as const;

export function registerSlackOAuthRoutes(app: Hono<HonoBindings>): void {
  app.get("/slack/oauth/start", async (c) => {
    const configuration = readSlackOAuthConfiguration(c);
    if (!configuration) {
      return redirectToSlackOAuthResult(c, {
        error: "configuration_missing",
      });
    }

    const moveFromOrganizationId = normalizeOptionalText(
      c.req.query("move_from")
    );
    if (moveFromOrganizationId) {
      const userId = normalizeOptionalText(c.var.authClaims.callerPrincipalId);
      if (!userId) {
        return redirectToSlackOAuthResult(c, {
          error: "workspace_already_bound",
        });
      }
      const membership = await resolveOrganizationMembership(c, {
        organizationId: moveFromOrganizationId,
        userId,
      });
      if (membership.status !== "member") {
        return redirectToSlackOAuthResult(c, {
          error: "workspace_already_bound",
        });
      }
    }

    let state: SlackOAuthStateCreateResponse;
    try {
      state = await c.var.coreRpc.createSlackOAuthState({
        context: c.var.openMeldRequestContext,
        ...(moveFromOrganizationId ? { moveFromOrganizationId } : {}),
      });
    } catch (error) {
      const requestId = c.var.ingressOpenMeldContext.requestId;
      console.warn("[gateway.slack.oauth_state_creation_failed]", {
        error: toSafeOAuthErrorMessage(error),
        requestId,
      });
      return redirectToSlackOAuthResult(c, {
        error: resolveSlackOAuthCoreError({
          error,
          fallback: "state_creation_failed",
          requestId,
        }),
      });
    }
    const authorizeUrl = new URL(SLACK_AUTHORIZE_URL);
    authorizeUrl.searchParams.set("client_id", configuration.clientId);
    authorizeUrl.searchParams.set("redirect_uri", configuration.redirectUri);
    authorizeUrl.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
    authorizeUrl.searchParams.set("state", state.state);
    return c.redirect(authorizeUrl.toString(), 302);
  });

  app.get("/slack/oauth/callback", handleSlackOAuthCallback);
}

type ValidSlackOAuthState = Extract<
  SlackOAuthStateConsumeResponse,
  { status: "valid" }
>;

async function handleSlackOAuthCallback(
  c: Context<HonoBindings>
): Promise<Response> {
  const stateResolution = await resolveSlackOAuthCallbackState(c);
  if ("response" in stateResolution) {
    return stateResolution.response;
  }
  const authorization = resolveSlackOAuthCallbackAuthorization(
    c,
    stateResolution.state
  );
  if ("response" in authorization) {
    return authorization.response;
  }

  let access: Awaited<ReturnType<typeof exchangeSlackOAuthCode>>;
  try {
    access = await exchangeSlackOAuthCode({
      clientId: authorization.configuration.clientId,
      clientSecret: authorization.configuration.clientSecret,
      code: authorization.code,
      redirectUri: authorization.configuration.redirectUri,
    });
  } catch (error) {
    console.warn("[gateway.slack.oauth_exchange_failed]", {
      error: toSafeOAuthErrorMessage(error),
      requestId: c.var.ingressOpenMeldContext.requestId,
    });
    return redirectToManagement(c, stateResolution.state.returnPath, {
      error: "oauth_exchange_failed",
    });
  }

  return await finishSlackOAuthInstallation(c, {
    access,
    state: stateResolution.state,
  });
}

async function resolveSlackOAuthCallbackState(
  c: Context<HonoBindings>
): Promise<{ response: Response } | { state: ValidSlackOAuthState }> {
  const rawState = normalizeOptionalText(c.req.query("state"));
  let consumedState: SlackOAuthStateConsumeResponse;
  try {
    consumedState = rawState
      ? await c.var.coreRpc.consumeSlackOAuthState({ state: rawState })
      : { status: "invalid" };
  } catch (error) {
    console.warn("[gateway.slack.oauth_state_validation_failed]", {
      error: toSafeOAuthErrorMessage(error),
      requestId: c.var.ingressOpenMeldContext.requestId,
    });
    return {
      response: redirectToSlackOAuthResult(c, {
        error: "state_validation_failed",
      }),
    };
  }
  if (consumedState.status === "invalid") {
    return {
      response: redirectToSlackOAuthResult(c, { error: "invalid_state" }),
    };
  }
  if (consumedState.status === "expired") {
    return {
      response: redirectToManagement(c, consumedState.returnPath, {
        error: "expired_state",
      }),
    };
  }
  return { state: consumedState };
}

function resolveSlackOAuthCallbackAuthorization(
  c: Context<HonoBindings>,
  state: ValidSlackOAuthState
):
  | { code: string; configuration: SlackOAuthConfiguration }
  | { response: Response } {
  const slackError = normalizeOptionalText(c.req.query("error"));
  if (slackError) {
    return {
      response: redirectToManagement(c, state.returnPath, {
        error:
          slackError === "access_denied"
            ? "access_denied"
            : "oauth_exchange_failed",
      }),
    };
  }
  const code = normalizeOptionalText(c.req.query("code"));
  if (!code) {
    return {
      response: redirectToManagement(c, state.returnPath, {
        error: "missing_code",
      }),
    };
  }
  const configuration = readSlackOAuthConfiguration(c);
  if (!configuration) {
    return {
      response: redirectToManagement(c, state.returnPath, {
        error: "configuration_missing",
      }),
    };
  }
  return { code, configuration };
}

async function finishSlackOAuthInstallation(
  c: Context<HonoBindings>,
  input: {
    access: Awaited<ReturnType<typeof exchangeSlackOAuthCode>>;
    state: ValidSlackOAuthState;
  }
): Promise<Response> {
  try {
    const installation = await c.var.coreRpc.installSlackWorkspaceFromOAuth({
      actorProfileId: input.state.actorProfileId,
      botScopes: input.access.botScopes,
      botToken: input.access.botToken,
      botUserId: input.access.botUserId,
      installedByUserId: input.state.userId,
      ...(input.state.moveFromOrganizationId
        ? { moveFromOrganizationId: input.state.moveFromOrganizationId }
        : {}),
      organizationId: input.state.organizationId,
      slackInstallerUserId: input.access.slackInstallerUserId,
      slackTeamId: input.access.slackTeamId,
    });
    if (installation.status === "workspace_already_bound") {
      const membership = await resolveOrganizationMembership(c, {
        organizationId: installation.existing.organizationId,
        userId: input.state.userId,
      });
      if (membership.status === "member") {
        return redirectToManagement(c, input.state.returnPath, {
          moveRequired: {
            organizationId: membership.organizationId,
            organizationName: membership.organizationName,
          },
        });
      }
      return redirectToManagement(c, input.state.returnPath, {
        error: "workspace_already_bound",
      });
    }
    if (installation.status === "organization_already_bound") {
      return redirectToManagement(c, input.state.returnPath, {
        error: "organization_already_bound",
      });
    }
    return redirectToManagement(c, input.state.returnPath, {
      connected: true,
    });
  } catch (error) {
    const requestId = c.var.ingressOpenMeldContext.requestId;
    console.warn("[gateway.slack.oauth_installation_failed]", {
      error: toSafeOAuthErrorMessage(error),
      requestId,
    });
    return redirectToManagement(c, input.state.returnPath, {
      error: resolveSlackOAuthCoreError({
        error,
        fallback: "installation_failed",
        requestId,
      }),
    });
  }
}

type SlackOAuthConfiguration = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

function readSlackOAuthConfiguration(
  c: Context<HonoBindings>
): SlackOAuthConfiguration | null {
  const clientId = normalizeOptionalText(c.env.SLACK_OPENMELD_OAUTH_CLIENT_ID);
  const clientSecret = normalizeOptionalText(
    c.env.SLACK_OPENMELD_OAUTH_CLIENT_SECRET
  );
  const redirectUri = normalizeHttpUrl(c.env.OPENMELD_SLACK_OAUTH_REDIRECT_URL);
  const webAppUrl = normalizeHttpUrl(c.env.WEB_APP_URL);
  return clientId && clientSecret && redirectUri && webAppUrl
    ? { clientId, clientSecret, redirectUri }
    : null;
}

function redirectToManagement(
  c: Context<HonoBindings>,
  returnPath: string,
  outcome: SlackOAuthOutcome
): Response {
  const webAppUrl = normalizeHttpUrl(c.env.WEB_APP_URL);
  if (!webAppUrl) {
    return c.text("OpenMeld Web is not configured.", 503);
  }
  const url = new URL(returnPath, webAppUrl);
  if (url.origin !== new URL(webAppUrl).origin) {
    return c.text("Slack OAuth return path is invalid.", 400);
  }
  applyOAuthOutcome(url, outcome);
  return c.redirect(url.toString(), 302);
}

function redirectToSlackOAuthResult(
  c: Context<HonoBindings>,
  outcome: { error: SlackOAuthErrorCode }
): Response {
  const webAppUrl = normalizeHttpUrl(c.env.WEB_APP_URL);
  if (!webAppUrl) {
    return c.text("OpenMeld Web is not configured.", 503);
  }
  const url = new URL("/slack/oauth/result", webAppUrl);
  applyOAuthOutcome(url, outcome);
  return c.redirect(url.toString(), 302);
}

function applyOAuthOutcome(url: URL, outcome: SlackOAuthOutcome): void {
  if ("connected" in outcome) {
    url.searchParams.set("slack_oauth", "connected");
    url.searchParams.delete("slack_oauth_error");
    return;
  }
  if ("moveRequired" in outcome) {
    url.searchParams.set("slack_oauth", "move_required");
    url.searchParams.delete("slack_oauth_error");
    url.searchParams.set(
      "slack_oauth_from_organization_id",
      outcome.moveRequired.organizationId
    );
    url.searchParams.set(
      "slack_oauth_from_organization_name",
      outcome.moveRequired.organizationName
    );
    return;
  }
  url.searchParams.set("slack_oauth", "error");
  url.searchParams.set("slack_oauth_error", outcome.error);
}

type SlackOAuthOutcome =
  | { connected: true }
  | { error: SlackOAuthErrorCode }
  | {
      moveRequired: {
        organizationId: string;
        organizationName: string;
      };
    };

async function resolveOrganizationMembership(
  c: Context<HonoBindings>,
  input: SlackOAuthOrganizationMembershipInput
): Promise<SlackOAuthOrganizationMembershipResult> {
  try {
    return await c.var.authRpc.resolveOrganizationMembership(input);
  } catch (error) {
    console.warn("[gateway.slack.organization_membership_lookup_failed]", {
      error: toSafeOAuthErrorMessage(error),
      organizationId: input.organizationId,
      requestId: c.var.ingressOpenMeldContext.requestId,
    });
    return { status: "not_member" };
  }
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeHttpUrl(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function toSafeOAuthErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}

function resolveSlackOAuthCoreError(input: {
  error: unknown;
  fallback: SlackOAuthErrorCode;
  requestId: string;
}): SlackOAuthErrorCode {
  const structured = resolveGatewayStructuredRpcErrorResponse({
    err: input.error,
    requestId: input.requestId,
  });
  return structured?.code === "message_channel.organization_required"
    ? "organization_required"
    : input.fallback;
}
