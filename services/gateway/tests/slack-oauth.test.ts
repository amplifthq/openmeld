import { afterEach, describe, expect, it, vi } from "vitest";
import slackAppManifestTemplate from "../slack-app-manifest.template.yaml?raw";
import app from "../src/index";
import { SLACK_BOT_SCOPES } from "../src/routes/slack-oauth";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OAUTH_STATE = `slackoauth_${"a".repeat(64)}`;
const RETURN_PATH = "/o/acme/center-agent/channels";
const SLACK_MANIFEST_BOT_SCOPE_BLOCK_PATTERN =
  /^ {4}bot:\n((?: {6}- .+\n?)+)/mu;
const SLACK_MANIFEST_BOT_SCOPE_PATTERN = /^ {6}- (\S+)\s*$/gmu;
const EXPECTED_SLACK_BOT_SCOPES = [
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

type CoreRpcMock = {
  consumeSlackOAuthState: ReturnType<typeof vi.fn>;
  createSlackOAuthState: ReturnType<typeof vi.fn>;
  installSlackWorkspaceFromOAuth: ReturnType<typeof vi.fn>;
};

type AuthRpcMock = {
  resolveOrganizationMembership: ReturnType<typeof vi.fn>;
  resolveRequestAuth: ReturnType<typeof vi.fn>;
  resolveRequestAuthWithProfile: ReturnType<typeof vi.fn>;
  resolveProfile: ReturnType<typeof vi.fn>;
};

const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Slack OAuth routes", () => {
  it("requires an OpenMeld session before redirecting to Slack", async () => {
    const { coreRpc, env } = makeEnv({ authenticated: false });

    const response = await app.fetch(
      new Request("https://gateway.test/slack/oauth/start"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    expect(coreRpc.createSlackOAuthState).not.toHaveBeenCalled();
  });

  it("creates a Core-owned one-time state and redirects to Slack", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request("https://gateway.test/slack/oauth/start"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(302);
    const location = new URL(requireLocation(response));
    expect(location.origin + location.pathname).toBe(
      "https://slack.com/oauth/v2/authorize"
    );
    expect(location.searchParams.get("client_id")).toBe("client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://gateway.test/slack/oauth/callback"
    );
    expect(location.searchParams.get("scope")?.split(",").sort()).toEqual(
      [...SLACK_BOT_SCOPES].sort()
    );
    expect(location.searchParams.get("state")).toBe(OAUTH_STATE);
    expect(location.searchParams.has("team")).toBe(false);
    expect(coreRpc.createSlackOAuthState).toHaveBeenCalledWith({
      context: expect.objectContaining({
        activeOrganizationId: "org-1",
        actorContext: expect.objectContaining({
          ownerUserId: "user-1",
          openMeldProfileId: HUMAN_PROFILE_ID,
        }),
      }),
    });
  });

  it("starts a confirmed move only for a member of the previous organization", async () => {
    const { authRpc, coreRpc, env } = makeEnv({
      previousOrganizationMembership: {
        organizationId: "org-other",
        organizationName: "Previous Org",
        role: "member",
        status: "member",
      },
    });

    const response = await app.fetch(
      new Request("https://gateway.test/slack/oauth/start?move_from=org-other"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(302);
    expect(authRpc.resolveOrganizationMembership).toHaveBeenCalledWith({
      organizationId: "org-other",
      userId: "user-1",
    });
    expect(coreRpc.createSlackOAuthState).toHaveBeenCalledWith({
      context: expect.any(Object),
      moveFromOrganizationId: "org-other",
    });
  });

  it("rejects a confirmed move retry for a non-member", async () => {
    const { authRpc, coreRpc, env } = makeEnv({
      previousOrganizationMembership: { status: "not_member" },
    });

    const response = await app.fetch(
      new Request(
        "https://gateway.test/slack/oauth/start?move_from=org-secret"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(requireLocation(response)).toBe(
      "https://openmeld.test/slack/oauth/result?slack_oauth=error&slack_oauth_error=workspace_already_bound"
    );
    expect(authRpc.resolveOrganizationMembership).toHaveBeenCalledWith({
      organizationId: "org-secret",
      userId: "user-1",
    });
    expect(coreRpc.createSlackOAuthState).not.toHaveBeenCalled();
  });

  it("keeps authorize scopes aligned with the Slack manifest template", () => {
    expect(SLACK_BOT_SCOPES).toEqual(EXPECTED_SLACK_BOT_SCOPES);
    expect(readManifestBotScopes().sort()).toEqual(
      [...SLACK_BOT_SCOPES].sort()
    );
  });

  it("redirects a Core state-creation failure to a clear Web result", async () => {
    const { env } = makeEnv({
      stateCreationError: new Error("Core unavailable"),
    });

    const response = await app.fetch(
      new Request("https://gateway.test/slack/oauth/start"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(requireLocation(response)).toBe(
      "https://openmeld.test/slack/oauth/result?slack_oauth=error&slack_oauth_error=state_creation_failed"
    );
  });

  it("preserves the Organization requirement when Core refuses OAuth state creation", async () => {
    const { env } = makeEnv({
      stateCreationError: coreRpcError("message_channel.organization_required"),
    });

    const response = await app.fetch(
      new Request("https://gateway.test/slack/oauth/start"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(requireLocation(response)).toBe(
      "https://openmeld.test/slack/oauth/result?slack_oauth=error&slack_oauth_error=organization_required"
    );
  });

  it("exchanges an official Slack response shape and installs the workspace", async () => {
    const slackFetch = vi.fn(async () =>
      Response.json({
        access_token: "xoxb-installed-token",
        app_id: "A1234567890",
        authed_user: {
          access_token: "xoxp-user-token",
          id: "U1234",
          scope: "chat:write",
          token_type: "user",
        },
        bot_user_id: "U0KRQLJ9H",
        enterprise: {
          id: "E12345678",
          name: "Acme Enterprise",
        },
        ok: true,
        scope:
          "app_mentions:read,channels:history,chat:write,users:read,users:read.email",
        team: {
          id: "T9TK3CUKW",
          name: "Acme Workspace",
        },
        token_type: "bot",
      })
    );
    vi.stubGlobal("fetch", slackFetch);
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `https://gateway.test/slack/oauth/callback?code=temporary-code&state=${OAUTH_STATE}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(302);
    expect(requireLocation(response)).toBe(
      "https://openmeld.test/o/acme/center-agent/channels?slack_oauth=connected"
    );
    expect(slackFetch).toHaveBeenCalledWith(
      "https://slack.com/api/oauth.v2.access",
      expect.objectContaining({
        body: new URLSearchParams({
          code: "temporary-code",
          redirect_uri: "https://gateway.test/slack/oauth/callback",
        }),
        headers: expect.objectContaining({
          "content-type": "application/x-www-form-urlencoded",
        }),
        method: "POST",
      })
    );
    expect(coreRpc.consumeSlackOAuthState).toHaveBeenCalledWith({
      state: OAUTH_STATE,
    });
    expect(coreRpc.installSlackWorkspaceFromOAuth).toHaveBeenCalledWith({
      actorProfileId: HUMAN_PROFILE_ID,
      botToken: "xoxb-installed-token",
      botUserId: "U0KRQLJ9H",
      installedByUserId: "user-1",
      organizationId: "org-1",
      slackInstallerUserId: "U1234",
      slackTeamId: "T9TK3CUKW",
    });
  });

  it("offers an informed move when the installer belongs to the previous organization", async () => {
    const { env } = makeEnv({
      installationResult: {
        existing: {
          createdAtMs: 1,
          organizationId: "org-other",
          slackTeamId: "T9TK3CUKW",
          updatedAtMs: 1,
        },
        status: "workspace_already_bound",
      },
      previousOrganizationMembership: {
        organizationId: "org-other",
        organizationName: "Previous Org",
        role: "member",
        status: "member",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          access_token: "xoxb-installed-token",
          app_id: "A1234567890",
          authed_user: { id: "U1234" },
          bot_user_id: "U0KRQLJ9H",
          enterprise: null,
          ok: true,
          scope: "chat:write",
          team: { id: "T9TK3CUKW", name: "Acme Workspace" },
          token_type: "bot",
        })
      )
    );

    const response = await app.fetch(
      new Request(
        `https://gateway.test/slack/oauth/callback?code=temporary-code&state=${OAUTH_STATE}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(requireLocation(response)).toBe(
      "https://openmeld.test/o/acme/center-agent/channels?slack_oauth=move_required&slack_oauth_from_organization_id=org-other&slack_oauth_from_organization_name=Previous+Org"
    );
  });

  it("preserves the Organization requirement when Core refuses OAuth installation", async () => {
    const { env } = makeEnv({
      installationError: coreRpcError("message_channel.organization_required"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          access_token: "xoxb-installed-token",
          app_id: "A1234567890",
          authed_user: { id: "U1234" },
          bot_user_id: "U0KRQLJ9H",
          enterprise: null,
          ok: true,
          scope: "chat:write",
          team: { id: "T9TK3CUKW", name: "Acme Workspace" },
          token_type: "bot",
        })
      )
    );

    const response = await app.fetch(
      new Request(
        `https://gateway.test/slack/oauth/callback?code=temporary-code&state=${OAUTH_STATE}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(requireLocation(response)).toBe(
      "https://openmeld.test/o/acme/center-agent/channels?slack_oauth=error&slack_oauth_error=organization_required"
    );
  });

  it("does not disclose the previous organization to a non-member", async () => {
    const { env } = makeEnv({
      installationResult: {
        existing: {
          createdAtMs: 1,
          organizationId: "org-secret",
          slackTeamId: "T9TK3CUKW",
          updatedAtMs: 1,
        },
        status: "workspace_already_bound",
      },
      previousOrganizationMembership: { status: "not_member" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          access_token: "xoxb-installed-token",
          app_id: "A1234567890",
          authed_user: { id: "U1234" },
          bot_user_id: "U0KRQLJ9H",
          enterprise: null,
          ok: true,
          scope: "chat:write",
          team: { id: "T9TK3CUKW", name: "Acme Workspace" },
          token_type: "bot",
        })
      )
    );

    const response = await app.fetch(
      new Request(
        `https://gateway.test/slack/oauth/callback?code=temporary-code&state=${OAUTH_STATE}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const location = requireLocation(response);
    expect(location).toBe(
      "https://openmeld.test/o/acme/center-agent/channels?slack_oauth=error&slack_oauth_error=workspace_already_bound"
    );
    expect(location).not.toContain("org-secret");
  });

  it("moves only through a confirmed OAuth callback retry", async () => {
    const { coreRpc, env } = makeEnv({
      installationResult: { status: "moved" },
      stateResult: {
        actorProfileId: HUMAN_PROFILE_ID,
        moveFromOrganizationId: "org-other",
        organizationId: "org-1",
        returnPath: RETURN_PATH,
        status: "valid",
        userId: "user-1",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          access_token: "xoxb-installed-token",
          app_id: "A1234567890",
          authed_user: { id: "U1234" },
          bot_user_id: "U0KRQLJ9H",
          enterprise: null,
          ok: true,
          scope: "chat:write",
          team: { id: "T9TK3CUKW", name: "Acme Workspace" },
          token_type: "bot",
        })
      )
    );

    const response = await app.fetch(
      new Request(
        `https://gateway.test/slack/oauth/callback?code=temporary-code&state=${OAUTH_STATE}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(requireLocation(response)).toBe(
      "https://openmeld.test/o/acme/center-agent/channels?slack_oauth=connected"
    );
    expect(coreRpc.installSlackWorkspaceFromOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ moveFromOrganizationId: "org-other" })
    );
  });

  it("rejects an invalid or replayed state before calling Slack", async () => {
    const { coreRpc, env } = makeEnv({ stateResult: { status: "invalid" } });
    const slackFetch = vi.fn();
    vi.stubGlobal("fetch", slackFetch);

    const response = await app.fetch(
      new Request(
        `https://gateway.test/slack/oauth/callback?code=temporary-code&state=${OAUTH_STATE}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(requireLocation(response)).toBe(
      "https://openmeld.test/slack/oauth/result?slack_oauth=error&slack_oauth_error=invalid_state"
    );
    expect(slackFetch).not.toHaveBeenCalled();
    expect(coreRpc.installSlackWorkspaceFromOAuth).not.toHaveBeenCalled();
  });

  it("redirects a Core state-validation failure before calling Slack", async () => {
    const { coreRpc, env } = makeEnv({
      stateValidationError: new Error("Core unavailable"),
    });
    const slackFetch = vi.fn();
    vi.stubGlobal("fetch", slackFetch);

    const response = await app.fetch(
      new Request(
        `https://gateway.test/slack/oauth/callback?code=temporary-code&state=${OAUTH_STATE}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(requireLocation(response)).toBe(
      "https://openmeld.test/slack/oauth/result?slack_oauth=error&slack_oauth_error=state_validation_failed"
    );
    expect(slackFetch).not.toHaveBeenCalled();
    expect(coreRpc.installSlackWorkspaceFromOAuth).not.toHaveBeenCalled();
  });
});

function readManifestBotScopes(): string[] {
  const botScopeBlock = SLACK_MANIFEST_BOT_SCOPE_BLOCK_PATTERN.exec(
    slackAppManifestTemplate
  )?.[1];
  if (!botScopeBlock) {
    throw new Error("Slack manifest bot scopes were not found");
  }
  return Array.from(
    botScopeBlock.matchAll(SLACK_MANIFEST_BOT_SCOPE_PATTERN)
  ).map((match) => {
    const scope = match[1];
    if (!scope) {
      throw new Error("Slack manifest contains an invalid bot scope");
    }
    return scope;
  });
}

function makeEnv(input?: {
  authenticated?: boolean;
  installationError?: Error;
  installationResult?: unknown;
  previousOrganizationMembership?: unknown;
  stateCreationError?: Error;
  stateResult?: unknown;
  stateValidationError?: Error;
}) {
  const authenticated = input?.authenticated ?? true;
  const coreRpc: CoreRpcMock = {
    consumeSlackOAuthState: vi.fn(() => {
      if (input?.stateValidationError) {
        return Promise.reject(input.stateValidationError);
      }
      return Promise.resolve(
        input?.stateResult
          ? input.stateResult
          : {
              actorProfileId: HUMAN_PROFILE_ID,
              organizationId: "org-1",
              returnPath: RETURN_PATH,
              status: "valid",
              userId: "user-1",
            }
      );
    }),
    createSlackOAuthState: vi.fn(() => {
      if (input?.stateCreationError) {
        return Promise.reject(input.stateCreationError);
      }
      return Promise.resolve({
        expiresAtMs: Date.now() + 600_000,
        state: OAUTH_STATE,
      });
    }),
    installSlackWorkspaceFromOAuth: vi.fn(() => {
      if (input?.installationError) {
        return Promise.reject(input.installationError);
      }
      return Promise.resolve(
        input?.installationResult
          ? input.installationResult
          : { status: "created" }
      );
    }),
  };
  const authResult = {
    claims: {
      activeOrganizationId: "org-1",
      authMethod: authenticated ? "session" : "none",
      authenticated,
      callerPrincipalId: authenticated ? "user-1" : undefined,
      ownerIds: authenticated ? ["user-1"] : [],
      requestId: "req-slack-oauth",
    },
    ok: true,
  };
  const profileResult = authenticated
    ? {
        ok: true,
        resolvedProfile: {
          ownerUserId: "user-1",
          profileKind: "human",
          profileName: "Mira",
          openMeldProfileId: HUMAN_PROFILE_ID,
        },
      }
    : { code: "profile.not_found", ok: false };
  const authRpc: AuthRpcMock = {
    resolveOrganizationMembership: vi.fn(
      async () =>
        input?.previousOrganizationMembership ?? { status: "not_member" }
    ),
    resolveProfile: vi.fn(async () => profileResult),
    resolveRequestAuth: vi.fn(async () => authResult),
    resolveRequestAuthWithProfile: vi.fn(async () => ({
      ...authResult,
      profile: profileResult,
    })),
  };

  return {
    authRpc,
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
      SLACK_OPENMELD_OAUTH_CLIENT_ID: "client-id",
      SLACK_OPENMELD_OAUTH_CLIENT_SECRET: "client-secret",
      OPENMELD_SLACK_OAUTH_REDIRECT_URL:
        "https://gateway.test/slack/oauth/callback",
      OPENMELD_WORKER_ENVIRONMENT: "local",
      WEB_APP_URL: "https://openmeld.test",
    } as unknown as CloudflareBindings,
  };
}

function coreRpcError(code: string): Error {
  const structured = {
    code,
    message: "Create an organization before connecting Slack.",
    status: 409,
  };
  const error = new Error(
    `HTTP 409: ${JSON.stringify({ error: structured, ok: false })}`
  ) as Error & {
    cause?: typeof structured;
    code?: string;
    status?: number;
  };
  error.cause = structured;
  error.code = code;
  error.status = 409;
  return error;
}

function requireLocation(response: Response): string {
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Expected a redirect location");
  }
  return location;
}
