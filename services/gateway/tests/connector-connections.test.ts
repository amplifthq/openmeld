import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";

const CONNECTION_NAME =
  "org_aaaaaaaaaaaaaaaaaa__user_bbbbbbbbbbbbbbbbbb__github";
const SHARED_CONNECTION_NAME = "org_aaaaaaaaaaaaaaaaaa__shared__github";
const CONNECTION = {
  canDisconnect: true,
  connectionName: CONNECTION_NAME,
  createdAtMs: 1,
  disconnectedAtMs: null,
  organizationId: "org-1",
  ownerDisplayName: "Mira",
  service: "github",
  status: "pending",
  updatedAtMs: 1,
  userId: "user-1",
} as const;
const SHARED_CONNECTION = {
  ...CONNECTION,
  connectionName: SHARED_CONNECTION_NAME,
  scope: "shared",
} as const;
const LINEAR_CONNECTION = {
  ...CONNECTION,
  connectionName: "org_aaaaaaaaaaaaaaaaaa__user_bbbbbbbbbbbbbbbbbb__linear",
  service: "linear",
} as const;
const SHARED_POSTHOG_CONNECTION = {
  ...SHARED_CONNECTION,
  connectionName: "org_aaaaaaaaaaaaaaaaaa__shared__posthog",
  service: "posthog",
} as const;
const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gateway connector connection routes", () => {
  it("projects expired credential health only to opted-in clients without changing account ownership", async () => {
    const health = {
      state: "reconnect_required",
      observedAt: new Date().toISOString(),
      expiresAt: null,
      reason: "oauth_token_expired",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          {
            service: "linear",
            configured: true,
            connectionName: LINEAR_CONNECTION.connectionName,
            health,
          },
        ])
      )
    );
    const environment = makeEnv({
      reconcileCurrentOrganizationConnectorConnections: async () => ({
        connections: [
          { ...LINEAR_CONNECTION, status: "active", scope: "member" },
        ],
        currentUserId: "user-1",
        organizationId: "org-1",
      }),
    });
    for (const optedIn of [false, true]) {
      const response = await app.fetch(
        new Request(
          `http://local/v1/organizations/current/connectors/linear/connections?expectedOrganizationId=org-1${optedIn ? "&includeConnectionHealth=true" : ""}`
        ),
        environment,
        TEST_EXECUTION_CONTEXT
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        connections: Array<{
          health?: unknown;
          status: string;
          connectionName: string;
        }>;
      };
      expect(body.connections[0]?.status).toBe("active");
      expect(body.connections[0]?.connectionName).toBe(
        LINEAR_CONNECTION.connectionName
      );
      expect(body.connections[0]?.health).toEqual(optedIn ? health : undefined);
    }
  });
  it("routes only typed JSON Plugin decisions to the current account's Core owner", async () => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    const pluginActionRequest = vi.fn(async () => ({
      requestId,
      inboxItemId: "private-inbox-item",
      state: "pending",
      service: "posthog",
      actionId: "create_project",
      effect: "write",
      accountName: "Synthetic member",
      accountScope: "member",
      actorProfileId: "agent",
      inputFieldCount: 1,
      targets: [{ label: "project", value: "synthetic" }],
      createdAtMs: 1,
      expiresAtMs: 2,
      sourceSignalId: "source-message",
      continuation: null,
      issuePreview: {
        title: "Private issue title",
        description: "Private issue body",
        targets: [],
        additionalFieldCount: 0,
      },
    }));
    const environment = makeEnv({ pluginActionRequest });
    const invoke = (
      body: unknown,
      contentType = "application/json",
      includeMessageContext = false,
      includeIssuePreview = false
    ) =>
      app.fetch(
        new Request(
          `http://local/v1/organizations/current/plugins/action-requests?expectedOrganizationId=org-1${includeMessageContext ? "&includeMessageContext=true" : ""}${includeIssuePreview ? "&includeIssuePreview=true" : ""}`,
          {
            method: "POST",
            headers: { "content-type": contentType },
            body: JSON.stringify(body),
          }
        ),
        environment,
        TEST_EXECUTION_CONTEXT
      );
    expect((await invoke({ operation: "read", requestId })).status).toBe(200);
    const legacy = await invoke({ operation: "read", requestId });
    const legacyBody = await legacy.json();
    expect(legacyBody).not.toHaveProperty("sourceSignalId");
    expect(legacyBody).not.toHaveProperty("issuePreview");
    const contextual = await invoke(
      { operation: "read", requestId },
      "application/json",
      true
    );
    expect(contextual.status).toBe(200);
    const contextualBody = await contextual.json();
    expect(contextualBody).not.toHaveProperty("issuePreview");
    expect(contextualBody).toHaveProperty("sourceSignalId", "source-message");
    const detail = await invoke(
      { operation: "read", requestId },
      "application/json",
      true,
      true
    );
    expect(await detail.json()).toHaveProperty(
      "issuePreview.description",
      "Private issue body"
    );
    expect(pluginActionRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeIssuePreview: true })
    );
    expect(pluginActionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrganizationId: "org-1",
        command: { operation: "read", requestId },
        context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      })
    );
    pluginActionRequest.mockClear();
    for (const body of [
      { operation: "send_code", requestId },
      {
        operation: "approve",
        requestId,
        code: "synthetic",
        userId: "another-user",
      },
      {
        operation: "approve",
        requestId,
        code: "synthetic",
        input: { target: "other" },
      },
    ]) {
      expect((await invoke(body)).status).toBe(400);
    }
    expect(
      (
        await invoke(
          { operation: "approve", requestId, code: "synthetic" },
          "text/plain"
        )
      ).status
    ).toBe(400);
    expect(pluginActionRequest).not.toHaveBeenCalled();
  });
  it("scopes a private channel request to the authenticated organization and keeps preview separate from explicit continuation", async () => {
    const previewPluginChannelConnection = vi.fn(async () => ({
      requestId: "request",
      service: "github",
      scope: "choose",
      provider: "slack",
      targetProfileName: "Agent",
      expiresAtMs: 1000,
      selection: null,
    }));
    const continuePluginChannelConnection = vi.fn(async () => ({
      status: "requested",
      requestId: "request",
      targetProfileId: "agent",
      provider: "slack",
    }));
    const env = makeEnv({
      previewPluginChannelConnection,
      continuePluginChannelConnection,
    });
    const invoke = (kind: string, body: unknown) =>
      app.fetch(
        new Request(
          `http://local/v1/organizations/current/plugins/connection-requests/${kind}?expectedOrganizationId=org-1`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        ),
        env,
        TEST_EXECUTION_CONTEXT
      );
    expect((await invoke("preview", { requestId: "request" })).status).toBe(
      200
    );
    expect(continuePluginChannelConnection).not.toHaveBeenCalled();
    expect(
      (await invoke("continue", { requestId: "request", scope: "shared" }))
        .status
    ).toBe(200);
    expect(continuePluginChannelConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrganizationId: "org-1",
        requestId: "request",
        scope: "shared",
        context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      })
    );
    expect(
      (
        await invoke("continue", {
          requestId: "request",
          scope: "member",
          targetProfileId: "attacker",
          text: "different task",
        })
      ).status
    ).toBe(400);
    expect(continuePluginChannelConnection).toHaveBeenCalledOnce();
  });

  it("lists the live OpenConnector provider catalog after verifying membership", async () => {
    const listCurrentOrganizationConnectorAppRequests = vi.fn(async () => ({
      currentUserId: "user-1",
      organizationId: "org-1",
      requests: [],
    }));
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [
          {
            authTypes: ["oauth2", "api_key"],
            categories: [
              { displayName: "Developer Tools", id: "Developer Tools" },
            ],
            displayName: "GitHub",
            homepageUrl: "https://github.com",
            iconUrl: null,
            service: "github",
          },
        ],
        message: "OK",
        meta: {},
        success: true,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/catalog?expectedOrganizationId=org-1"
      ),
      makeEnv({ listCurrentOrganizationConnectorAppRequests }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://connectors.example.test/v1/providers?includeConnectionAuth=true",
      expect.objectContaining({ method: "GET" })
    );
    await expect(response.json()).resolves.toMatchObject({
      organizationId: "org-1",
      providers: [expect.objectContaining({ service: "github" })],
    });
  });

  it("lists the current member's durable App requests", async () => {
    const listCurrentOrganizationConnectorAppRequests = vi.fn(async () => ({
      currentUserId: "user-1",
      organizationId: "org-1",
      requests: [],
    }));

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/requests?expectedOrganizationId=org-1"
      ),
      makeEnv({ listCurrentOrganizationConnectorAppRequests }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(listCurrentOrganizationConnectorAppRequests).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      expectedOrganizationId: "org-1",
    });
  });

  it("creates a catalog App request with requester context owned by Core", async () => {
    const createCurrentOrganizationConnectorAppRequest = vi.fn(
      async (input: { providerId: string; providerName: string }) => ({
        request: {
          availableAtMs: null,
          createdAtMs: 1,
          id: "connector_request_1",
          notifiedAtMs: null,
          organizationId: "org-1",
          providerId: input.providerId,
          providerName: input.providerName,
          requestedCapabilities: [],
          requesterMemberId: "member-1",
          requesterUserId: "user-1",
          source: "openconnector_catalog",
          status: "requested",
          updatedAtMs: 1,
          useCase: "Coordinate customer escalations.",
        },
      })
    );

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/requests?expectedOrganizationId=org-1",
        {
          body: JSON.stringify({
            providerId: "microsoft-teams",
            providerName: "Microsoft Teams",
            source: "openconnector_catalog",
            useCase: "Coordinate customer escalations.",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      makeEnv({ createCurrentOrganizationConnectorAppRequest }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(createCurrentOrganizationConnectorAppRequest).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      expectedOrganizationId: "org-1",
      providerId: "microsoft-teams",
      providerName: "Microsoft Teams",
      source: "openconnector_catalog",
      useCase: "Coordinate customer escalations.",
    });
  });

  it("rejects malformed provider identities before calling Core or OpenConnector", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/INVALID!/connections?expectedOrganizationId=org-1"
      ),
      makeEnv({}),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an authorization request that does not identify the page Organization", async () => {
    const beginCurrentMemberConnectorAuthorization = vi.fn();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/github/authorization",
        { method: "POST" }
      ),
      makeEnv({ beginCurrentMemberConnectorAuthorization }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(beginCurrentMemberConnectorAuthorization).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the Worker global fetch receiver", async () => {
    const reconcileCurrentOrganizationConnectorConnections = vi.fn(
      async () => ({
        connections: [],
        currentUserId: "user-1",
        organizationId: "org-1",
      })
    );
    const fetchMock = vi.fn(function receiverSensitiveFetch(this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(Response.json([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/github/connections?expectedOrganizationId=org-1"
      ),
      makeEnv({ reconcileCurrentOrganizationConnectorConnections }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts a GitHub authorization with the Core-owned connection name", async () => {
    const beginCurrentMemberConnectorAuthorization = vi.fn(
      async () => CONNECTION
    );
    const fetchMock = vi.fn(async () =>
      Response.json({
        authorizationUrl:
          "https://github.com/login/oauth/authorize?state=opaque",
        state: "opaque-state",
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv({ beginCurrentMemberConnectorAuthorization });

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/github/authorization?expectedOrganizationId=org-1",
        { method: "POST" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authorizationUrl: expect.stringContaining("github.com"),
      connection: CONNECTION,
    });
    expect(beginCurrentMemberConnectorAuthorization).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      expectedOrganizationId: "org-1",
      service: "github",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://connectors.example.test/api/oauth/authorizations",
      expect.objectContaining({
        body: JSON.stringify({
          connectionName: CONNECTION_NAME,
          service: "github",
        }),
        method: "POST",
      })
    );
  });

  it("starts OAuth authorization for another catalog-backed App", async () => {
    const beginCurrentMemberConnectorAuthorization = vi.fn(
      async () => LINEAR_CONNECTION
    );
    const fetchMock = vi.fn(async () =>
      Response.json({
        authorizationUrl: "https://linear.app/oauth/authorize?state=opaque",
        state: "opaque-state",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/linear/authorization?expectedOrganizationId=org-1",
        { method: "POST" }
      ),
      makeEnv({ beginCurrentMemberConnectorAuthorization }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(beginCurrentMemberConnectorAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ service: "linear" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://connectors.example.test/api/oauth/authorizations",
      expect.objectContaining({
        body: JSON.stringify({
          connectionName: LINEAR_CONNECTION.connectionName,
          service: "linear",
        }),
      })
    );
  });

  it.each([
    {
      service: "posthog",
      authType: "api_key",
      values: { apiKey: "phx_test_secret", baseUrl: "https://us.posthog.com" },
    },
    {
      service: "cloudflare_docs",
      authType: "custom_credential",
      values: {},
    },
  ])("registers $service credentials only in OpenConnector and activates the Core record", async ({
    service,
    authType,
    values,
  }) => {
    const connection = {
      ...SHARED_POSTHOG_CONNECTION,
      connectionName: `org_aaaaaaaaaaaaaaaaaa__shared__${service}`,
      service,
    };
    const beginCurrentOrganizationSharedConnectorAuthorization = vi.fn(
      async () => connection
    );
    const reconcileCurrentOrganizationConnectorConnections = vi.fn(
      async () => ({
        connections: [{ ...connection, status: "active" as const }],
        currentUserId: "user-1",
        organizationId: "org-1",
      })
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          configured: true,
          connectionName: connection.connectionName,
          service,
        })
      )
      .mockResolvedValueOnce(
        Response.json([
          {
            configured: true,
            connectionName: connection.connectionName,
            service,
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      new Request(
        `http://local/v1/organizations/current/connectors/${service}/shared-credential?expectedOrganizationId=org-1`,
        {
          body: JSON.stringify({
            authType,
            values,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      makeEnv({
        beginCurrentOrganizationSharedConnectorAuthorization,
        reconcileCurrentOrganizationConnectorConnections,
      }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://connectors.example.test/api/connections/${service}`,
      expect.objectContaining({
        body: JSON.stringify({
          authType,
          connectionName: connection.connectionName,
          values,
        }),
        method: "PUT",
      })
    );
    expect(
      reconcileCurrentOrganizationConnectorConnections
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        availableConnectionNames: [connection.connectionName],
        service,
      })
    );
    expect(JSON.stringify(await response.json())).not.toContain(
      "phx_test_secret"
    );
  });

  it("registers durable cleanup when credential configuration finishes after account closure", async () => {
    const configured = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const target = SHARED_POSTHOG_CONNECTION.connectionName;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        started.resolve();
        return await configured.promise;
      })
      .mockResolvedValueOnce(
        Response.json([
          { configured: true, connectionName: target, service: "posthog" },
        ])
      )
      .mockRejectedValueOnce(
        new Error("Disconnect is temporarily unavailable")
      );
    vi.stubGlobal("fetch", fetchMock);
    const requestAccountConnectionCleanup = vi.fn(async () => true);
    const responsePromise = app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/posthog/shared-credential?expectedOrganizationId=org-1",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            authType: "api_key",
            values: { apiKey: "test-only", baseUrl: "https://us.posthog.com" },
          }),
        }
      ),
      makeEnv(
        {
          beginCurrentOrganizationSharedConnectorAuthorization: async () =>
            SHARED_POSTHOG_CONNECTION,
          reconcileCurrentOrganizationConnectorConnections: () =>
            Promise.reject(new Error("account_unavailable")),
        },
        { requestAccountConnectionCleanup }
      ),
      TEST_EXECUTION_CONTEXT
    );
    await started.promise;
    // The account cleanup has completed while the external write was pending.
    configured.resolve(
      Response.json({
        configured: true,
        connectionName: target,
        service: "posthog",
      })
    );
    expect((await responsePromise).status).toBeGreaterThanOrEqual(400);
    expect(requestAccountConnectionCleanup).toHaveBeenCalledWith({
      userId: "user-1",
      connectionName: target,
      service: "posthog",
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/connections/posthog"),
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("starts a selected-repository GitHub App installation through Core", async () => {
    const expiresAtMs = Date.now() + 600_000;
    const beginCurrentOrganizationGitHubAppInstallation = vi.fn(async () => ({
      connection: SHARED_CONNECTION,
      expiresAtMs,
      state: `githubapp_${"a".repeat(64)}`,
    }));
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const legacyResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/github/shared-authorization?expectedOrganizationId=org-1",
        { method: "POST" }
      ),
      makeEnv({ beginCurrentOrganizationGitHubAppInstallation }),
      TEST_EXECUTION_CONTEXT
    );

    expect(legacyResponse.status).toBe(200);
    const legacyBody = (await legacyResponse.json()) as {
      authorizationUrl: string;
      expiresAtMs?: number;
    };
    expect(legacyBody.expiresAtMs).toBeUndefined();

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/github/shared-authorization?expectedOrganizationId=org-1&includeAuthorizationExpiry=true",
        { method: "POST" }
      ),
      makeEnv({ beginCurrentOrganizationGitHubAppInstallation }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      authorizationUrl: string;
      expiresAtMs: number;
    };
    const authorizationUrl = new URL(body.authorizationUrl);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://github.com/apps/openmeld-test/installations/new"
    );
    expect(authorizationUrl.searchParams.get("state")).toBe(
      `githubapp_${"a".repeat(64)}`
    );
    expect(body.expiresAtMs).toBe(expiresAtMs);
    expect(beginCurrentOrganizationGitHubAppInstallation).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      expectedOrganizationId: "org-1",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts user authorization for an App that is already installed", async () => {
    const beginCurrentOrganizationGitHubAppInstallation = vi.fn(async () => ({
      connection: SHARED_CONNECTION,
      expiresAtMs: Date.now() + 600_000,
      state: `githubapp_${"a".repeat(64)}`,
      verificationConnectionName: "github_verify_aaaaaaaaaaaaaaaaaaaaaaaa",
    }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        authorizationUrl:
          "https://github.com/login/oauth/authorize?client_id=public-id",
        state: "connector_oauth_state",
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/github/shared-authorization?expectedOrganizationId=org-1",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ existingInstallation: true }),
        }
      ),
      makeEnv({ beginCurrentOrganizationGitHubAppInstallation }),
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authorizationUrl:
        "https://github.com/login/oauth/authorize?client_id=public-id",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/oauth/authorizations"),
      expect.objectContaining({
        body: expect.stringContaining("github_verify_aaaaaaaaaaaaaaaaaaaaaaaa"),
      })
    );
  });

  it("turns the installer verification token into the pending organization installation", async () => {
    const readPendingGitHubAppInstallation = vi.fn(async () => ({
      installationId: "987654",
      organizationId: "org-1",
      status: "verifying" as const,
      targetConnectionName: SHARED_CONNECTION_NAME,
      userId: "user-1",
      verificationConnectionName: "github_verify_aaaaaaaaaaaaaaaaaaaaaaaa",
    }));
    const completeGitHubAppInstallation = vi.fn(async () => true);
    const reconcileCurrentOrganizationConnectorConnections = vi.fn(
      async () => ({
        connections: [{ ...SHARED_CONNECTION, status: "active" as const }],
        currentUserId: "user-1",
        organizationId: "org-1",
      })
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([
          {
            configured: true,
            connectionName: "github_verify_aaaaaaaaaaaaaaaaaaaaaaaa",
            service: "github",
          },
        ])
      )
      .mockResolvedValueOnce(
        Response.json({
          configured: true,
          connectionName: SHARED_CONNECTION_NAME,
          service: "github",
        })
      )
      .mockResolvedValueOnce(
        Response.json([
          {
            configured: true,
            connectionName: SHARED_CONNECTION_NAME,
            service: "github",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/github/connections?expectedOrganizationId=org-1"
      ),
      makeEnv({
        completeGitHubAppInstallation,
        readPendingGitHubAppInstallation,
        reconcileCurrentOrganizationConnectorConnections,
      }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://connectors.example.test/api/providers/github/installations",
      expect.objectContaining({
        body: JSON.stringify({
          installationId: "987654",
          targetConnectionName: SHARED_CONNECTION_NAME,
          verificationConnectionName: "github_verify_aaaaaaaaaaaaaaaaaaaaaaaa",
        }),
        method: "POST",
      })
    );
    expect(completeGitHubAppInstallation).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      expectedOrganizationId: "org-1",
      installationId: "987654",
      targetConnectionName: SHARED_CONNECTION_NAME,
      verificationConnectionName: "github_verify_aaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(
      reconcileCurrentOrganizationConnectorConnections
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        availableConnectionNames: [SHARED_CONNECTION_NAME],
        service: "github",
      })
    );
  });

  it("finishes an existing installation after GitHub user authorization", async () => {
    const verifier = "github_verify_aaaaaaaaaaaaaaaaaaaaaaaa";
    const readPendingGitHubAppInstallation = vi
      .fn()
      .mockResolvedValueOnce({
        installationId: null,
        organizationId: "org-1",
        status: "installing",
        targetConnectionName: SHARED_CONNECTION_NAME,
        userId: "user-1",
        verificationConnectionName: verifier,
      })
      .mockResolvedValueOnce({
        installationId: "987654",
        organizationId: "org-1",
        status: "verifying",
        targetConnectionName: SHARED_CONNECTION_NAME,
        userId: "user-1",
        verificationConnectionName: verifier,
      });
    const beginExistingGitHubAppInstallationVerification = vi.fn(
      async () => true
    );
    const completeGitHubAppInstallation = vi.fn(async () => true);
    const reconcileCurrentOrganizationConnectorConnections = vi.fn(
      async () => ({
        connections: [{ ...SHARED_CONNECTION, status: "active" as const }],
        currentUserId: "user-1",
        organizationId: "org-1",
      })
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([
          { configured: true, connectionName: verifier, service: "github" },
        ])
      )
      .mockResolvedValueOnce(
        Response.json({ accountLogin: "amplifthq", installationId: "987654" })
      )
      .mockResolvedValueOnce(
        Response.json({
          configured: true,
          connectionName: SHARED_CONNECTION_NAME,
          service: "github",
        })
      )
      .mockResolvedValueOnce(
        Response.json([
          {
            configured: true,
            connectionName: SHARED_CONNECTION_NAME,
            service: "github",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/github/connections?expectedOrganizationId=org-1"
      ),
      makeEnv({
        beginExistingGitHubAppInstallationVerification,
        completeGitHubAppInstallation,
        readPendingGitHubAppInstallation,
        reconcileCurrentOrganizationConnectorConnections,
      }),
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    expect(beginExistingGitHubAppInstallationVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrganizationId: "org-1",
        installationId: "987654",
        verificationConnectionName: verifier,
      })
    );
    expect(completeGitHubAppInstallation).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/providers/github/installations"),
      expect.objectContaining({
        body: expect.stringContaining('"expectedAccountLogin":"amplifthq"'),
        method: "POST",
      })
    );
  });

  it("keeps OpenConnector details out of a failed GitHub App installation response", async () => {
    const readPendingGitHubAppInstallation = vi.fn(async () => ({
      installationId: "987654",
      organizationId: "org-1",
      status: "verifying" as const,
      targetConnectionName: SHARED_CONNECTION_NAME,
      userId: "user-1",
      verificationConnectionName: "github_verify_aaaaaaaaaaaaaaaaaaaaaaaa",
    }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([
          {
            configured: true,
            connectionName: "github_verify_aaaaaaaaaaaaaaaaaaaaaaaa",
            service: "github",
          },
        ])
      )
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/github/connections?expectedOrganizationId=org-1"
      ),
      makeEnv({ readPendingGitHubAppInstallation }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "upstream_error",
        message: "OpenMeld could not finish GitHub setup. Try again.",
        upstreamCode: "connector.github_app_setup_unavailable",
      },
    });
  });

  it("reconciles the real connection-list shape while keeping legacy default out of Core output", async () => {
    const reconcileCurrentOrganizationConnectorConnections = vi.fn(
      async () => ({
        connections: [{ ...CONNECTION, status: "active" }],
        currentUserId: "user-1",
        organizationId: "org-1",
      })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          {
            authType: "oauth2",
            configured: true,
            connectionName: "default",
            default: true,
            id: "github:default",
            profile: {
              accountId: "legacy",
              displayName: "Legacy",
              grantedScopes: [],
            },
            service: "github",
            virtual: false,
          },
          {
            authType: "oauth2",
            configured: true,
            connectionName: CONNECTION_NAME,
            default: false,
            id: `github:${CONNECTION_NAME}`,
            profile: {
              accountId: "mira",
              displayName: "Mira",
              grantedScopes: [],
            },
            service: "github",
            virtual: false,
          },
        ])
      )
    );
    const env = makeEnv({
      reconcileCurrentOrganizationConnectorConnections,
    });

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/github/connections?expectedOrganizationId=org-1"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { connections: unknown[] };
    expect(body.connections).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("github:default");
    expect(
      reconcileCurrentOrganizationConnectorConnections
    ).toHaveBeenCalledWith({
      availableConnectionNames: ["default", CONNECTION_NAME],
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      expectedOrganizationId: "org-1",
      service: "github",
    });
  });

  it("lists catalog connection states with one OpenConnector read", async () => {
    const reconcileCurrentOrganizationConnectorConnections = vi.fn(
      async (input: { service: string }) => ({
        connections:
          input.service === "github"
            ? [{ ...CONNECTION, status: "active" as const }]
            : [],
        currentUserId: "user-1",
        organizationId: "org-1",
      })
    );
    const fetchMock = vi.fn(async () =>
      Response.json([
        {
          configured: true,
          connectionName: CONNECTION_NAME,
          service: "github",
        },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/connections?expectedOrganizationId=org-1"
      ),
      makeEnv({ reconcileCurrentOrganizationConnectorConnections }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      reconcileCurrentOrganizationConnectorConnections
    ).toHaveBeenCalledWith({
      availableConnectionNames: [CONNECTION_NAME],
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      expectedOrganizationId: "org-1",
      service: "github",
    });
    expect(
      reconcileCurrentOrganizationConnectorConnections
    ).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      connections: [expect.objectContaining({ service: "github" })],
      currentUserId: "user-1",
      organizationId: "org-1",
    });
  });

  it("disconnects the executor credential only after Core authorizes the owner", async () => {
    const authorizeConnectorDisconnect = vi.fn(async () => ({
      ...CONNECTION,
      status: "active",
    }));
    const completeConnectorDisconnect = vi.fn(async () => ({
      ...CONNECTION,
      disconnectedAtMs: 2,
      status: "disconnected",
      updatedAtMs: 2,
    }));
    const fetchMock = vi.fn(async () =>
      Response.json({
        configured: false,
        connectionName: CONNECTION_NAME,
        service: "github",
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv({
      authorizeConnectorDisconnect,
      completeConnectorDisconnect,
    });

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/github/connections/user-1?expectedOrganizationId=org-1",
        { method: "DELETE" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(authorizeConnectorDisconnect).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://connectors.example.test/api/connections/github",
      expect.objectContaining({
        body: JSON.stringify({ connectionName: CONNECTION_NAME }),
        method: "DELETE",
      })
    );
    expect(completeConnectorDisconnect).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionName: CONNECTION_NAME,
        service: "github",
        userId: "user-1",
      })
    );
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      completeConnectorDisconnect.mock.invocationCallOrder[0] ??
        Number.MAX_SAFE_INTEGER
    );
  });

  it("disconnects a shared credential only through the shared Core authority", async () => {
    const authorizeConnectorDisconnect = vi.fn(async () => ({
      ...SHARED_CONNECTION,
      status: "active",
    }));
    const completeConnectorDisconnect = vi.fn(async () => ({
      ...SHARED_CONNECTION,
      disconnectedAtMs: 2,
      status: "disconnected",
      updatedAtMs: 2,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          configured: false,
          connectionName: SHARED_CONNECTION_NAME,
          service: "github",
        })
      )
    );
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/connectors/github/connections/shared?expectedOrganizationId=org-1",
        { method: "DELETE" }
      ),
      makeEnv({
        authorizeConnectorDisconnect,
        completeConnectorDisconnect,
      }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(authorizeConnectorDisconnect).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      expectedOrganizationId: "org-1",
      scope: "shared",
      service: "github",
    });
    expect(completeConnectorDisconnect).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionName: SHARED_CONNECTION_NAME,
        scope: "shared",
        service: "github",
      })
    );
  });

  it("keeps executor deletion retryable when OpenConnector fails", async () => {
    const authorizeConnectorDisconnect = vi.fn(async () => ({
      ...CONNECTION,
      status: "active",
    }));
    const completeConnectorDisconnect = vi.fn(async () => ({
      ...CONNECTION,
      disconnectedAtMs: 2,
      status: "disconnected",
      updatedAtMs: 2,
    }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: "temporary" }, { status: 502 })
      )
      .mockResolvedValueOnce(
        Response.json({
          configured: false,
          connectionName: CONNECTION_NAME,
          service: "github",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv({
      authorizeConnectorDisconnect,
      completeConnectorDisconnect,
    });
    const request = () =>
      app.fetch(
        new Request(
          "http://local/v1/organizations/current/connectors/github/connections/user-1?expectedOrganizationId=org-1",
          { method: "DELETE" }
        ),
        env,
        TEST_EXECUTION_CONTEXT
      );

    const failedResponse = await request();
    expect(failedResponse.status).toBe(502);
    expect(completeConnectorDisconnect).not.toHaveBeenCalled();

    const retryResponse = await request();
    expect(retryResponse.status).toBe(200);
    expect(authorizeConnectorDisconnect).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(completeConnectorDisconnect).toHaveBeenCalledTimes(1);
  });
});

function makeEnv(
  coreOverrides: Record<string, unknown>,
  authOverrides: Record<string, unknown> = {}
): CloudflareBindings {
  const authRpc = {
    requestAccountConnectionCleanup: vi.fn(async () => false),
    ...authOverrides,
    resolveRequestAuthWithProfile: vi.fn(async () => ({
      claims: {
        activeOrganizationId: "org-1",
        authMethod: "session",
        authenticated: true,
        ownerIds: ["user-1"],
        requestId: "req-connector",
      },
      ok: true,
      profile: {
        ok: true,
        resolvedProfile: {
          ownerUserId: "user-1",
          profileKind: "human",
          profileName: "Mira",
          openMeldProfileId: "11111111-1111-4111-8111-111111111111",
        },
      },
    })),
  };
  return {
    OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN: "test-admin-token",
    OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN: "test-runtime-token",
    OPENMELD_AUTH_WORKER: authRpc,
    OPENMELD_CONNECTORS_BASE_URL: "https://connectors.example.test",
    OPENMELD_CORE_WORKER: {
      listCurrentOrganizationConnectorConnections: vi.fn(async () => ({
        connections: [CONNECTION],
        currentUserId: "user-1",
        organizationId: "org-1",
      })),
      readPendingGitHubAppInstallation: vi.fn(async () => null),
      ...coreOverrides,
    },
    GITHUB_OPENMELD_APP_SLUG: "openmeld-test",
  } as unknown as CloudflareBindings;
}
