import { z } from "zod/v4";

const SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";

const slackOAuthSuccessResponseSchema = z.object({
  access_token: z.string().min(1),
  app_id: z.string().min(1),
  authed_user: z.object({
    access_token: z.string().min(1).optional(),
    id: z.string().min(1),
    scope: z.string().optional(),
    token_type: z.string().optional(),
  }),
  bot_user_id: z.string().min(1),
  enterprise: z
    .object({
      id: z.string().min(1),
      name: z.string().optional(),
    })
    .nullable()
    .optional(),
  ok: z.literal(true),
  scope: z.string(),
  team: z.object({
    id: z.string().min(1),
    name: z.string().optional(),
  }),
  token_type: z.string(),
});

const slackOAuthErrorResponseSchema = z.object({
  error: z.string().min(1),
  ok: z.literal(false),
});

export type SlackOAuthAccess = {
  botScopes: string[];
  botToken: string;
  botUserId: string;
  slackInstallerUserId: string;
  slackTeamId: string;
};

export async function exchangeSlackOAuthCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  fetch?: typeof globalThis.fetch;
  redirectUri: string;
}): Promise<SlackOAuthAccess> {
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  const response = await fetchImplementation(SLACK_OAUTH_ACCESS_URL, {
    body: new URLSearchParams({
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
    headers: {
      authorization: `Basic ${btoa(`${input.clientId}:${input.clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Slack OAuth returned an invalid response");
  }
  const slackError = slackOAuthErrorResponseSchema.safeParse(payload);
  if (slackError.success) {
    throw new Error(`Slack OAuth exchange failed: ${slackError.data.error}`);
  }
  const slackSuccess = slackOAuthSuccessResponseSchema.safeParse(payload);
  if (!(response.ok && slackSuccess.success)) {
    throw new Error("Slack OAuth returned an invalid response");
  }

  return {
    botScopes: normalizeSlackScopes(slackSuccess.data.scope),
    botToken: slackSuccess.data.access_token,
    botUserId: slackSuccess.data.bot_user_id,
    slackInstallerUserId: slackSuccess.data.authed_user.id,
    slackTeamId: slackSuccess.data.team.id,
  };
}

function normalizeSlackScopes(value: string): string[] {
  const scopes = [
    ...new Set(
      value
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean)
    ),
  ].sort();
  if (scopes.length === 0) {
    throw new Error("Slack OAuth returned no bot scopes");
  }
  return scopes;
}
