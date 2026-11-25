import {
  connectorAppCatalogResponseSchema,
  connectorAppRequestListResponseSchema,
  connectorAppRequestResponseSchema,
  connectorAuthorizationStartResponseSchema,
  connectorConnectionListResponseSchema,
  connectorCredentialConnectBodySchema,
  connectorCredentialConnectResponseSchema,
  connectorDisconnectResponseSchema,
  connectorOrganizationContextQuerySchema,
  connectorServiceSchema,
  createConnectorAppRequestBodySchema,
  listPluginActionRequestsInputSchema,
  listPluginActionRequestsResponseSchema,
  pluginAccessListResponseSchema,
  pluginAccessSchema,
  pluginAccessUpdateBodySchema,
  pluginActionRequestCommandSchema,
  pluginActionRequestSchema,
  pluginActionRequestViewSchema,
  pluginActionResponseSchema,
  pluginChannelContinueBodySchema,
  pluginChannelContinueResponseSchema,
  pluginChannelRequestBodySchema,
  pluginChannelRequestPreviewSchema,
  pluginConnectionContinuationBodySchema,
  pluginConnectionContinuationResponseSchema,
  projectPluginActionRequestView,
} from "@openmeld/schemas";
import type {
  ConnectorConnection,
  ConnectorCredentialConnectBody,
  ConnectorService,
  CreateConnectorAppRequestBody,
} from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  OpenConnectorClient,
  type OpenConnectorConnection,
} from "../lib/openconnector-client";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";
import type { RpcHttpMethod } from "./rpc-http.types";

const CONNECTIONS_ROUTE =
  "/v1/organizations/current/connectors/:service/connections";
const CATALOG_CONNECTIONS_ROUTE =
  "/v1/organizations/current/connectors/connections";
const APP_CATALOG_ROUTE = "/v1/organizations/current/connectors/catalog";
const APP_REQUESTS_ROUTE = "/v1/organizations/current/connectors/requests";
const AUTHORIZATION_ROUTE =
  "/v1/organizations/current/connectors/:service/authorization";
const SHARED_AUTHORIZATION_ROUTE =
  "/v1/organizations/current/connectors/:service/shared-authorization";
const CREDENTIAL_ROUTE =
  "/v1/organizations/current/connectors/:service/credential";
const SHARED_CREDENTIAL_ROUTE =
  "/v1/organizations/current/connectors/:service/shared-credential";
const GITHUB_APP_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u;
const GITHUB_APP_SETUP_UNAVAILABLE_CODE =
  "connector.github_app_setup_unavailable";

class ConnectorConnectionRouteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(input: { code: string; message: string; status: number }) {
    super(input.message);
    this.name = "ConnectorConnectionRouteError";
    this.code = input.code;
    this.status = input.status;
  }
}

type OpenConnectorBindings = {
  OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN?: string;
  OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN?: string;
  OPENMELD_CONNECTORS_BASE_URL?: string;
  GITHUB_OPENMELD_APP_SLUG?: string;
};

function registerPluginChannelContinuationRoutes(app: Hono<HonoBindings>) {
  const previewRoute =
    "/v1/organizations/current/plugins/connection-requests/preview";
  const continueRoute =
    "/v1/organizations/current/plugins/connection-requests/continue";
  app.post(previewRoute, async (c) => {
    const organization = parseConnectorOrganizationRequest(
      c,
      previewRoute,
      "POST"
    );
    if (!organization.ok) {
      return organization.response;
    }
    const parsed = pluginChannelRequestBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: previewRoute,
        method: "POST",
        message: "Choose a valid Plugin setup request.",
      });
    }
    return executeRpcRoute({
      c,
      route: previewRoute,
      method: "POST",
      retryMode: "none",
      responseSchema: pluginChannelRequestPreviewSchema,
      execute: () =>
        c.var.coreRpc.previewPluginChannelConnection({
          ...parsed.data,
          context: buildCoreRpcContext(c),
          expectedOrganizationId: organization.expectedOrganizationId,
        }),
    });
  });
  app.post(continueRoute, async (c) => {
    const organization = parseConnectorOrganizationRequest(
      c,
      continueRoute,
      "POST"
    );
    if (!organization.ok) {
      return organization.response;
    }
    const parsed = pluginChannelContinueBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: continueRoute,
        method: "POST",
        message: "Choose a valid Plugin continuation.",
      });
    }
    return executeRpcRoute({
      c,
      route: continueRoute,
      method: "POST",
      retryMode: "none",
      responseSchema: pluginChannelContinueResponseSchema,
      execute: () =>
        c.var.coreRpc.continuePluginChannelConnection({
          ...parsed.data,
          context: buildCoreRpcContext(c),
          expectedOrganizationId: organization.expectedOrganizationId,
        }),
    });
  });
}

export function registerConnectorConnectionRoutes(
  app: Hono<HonoBindings>
): void {
  const continuationRoute = "/v1/spaces/:spaceId/plugin-connection/continue";
  app.post(continuationRoute, async (c) => {
    const spaceId = c.req.param("spaceId");
    const parsed = pluginConnectionContinuationBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: continuationRoute,
        method: "POST",
        spaceId,
        message: "Choose a valid connection continuation.",
      });
    }
    const password = readSpacePasswordHeader(c.req.raw.headers);
    return executeRpcRoute({
      c,
      route: continuationRoute,
      method: "POST",
      spaceId,
      retryMode: "none",
      responseSchema: pluginConnectionContinuationResponseSchema,
      execute: () =>
        c.var.coreRpc.continuePluginConnection({
          ...parsed.data,
          context: buildCoreRpcContext(c),
          spaceId,
          ...(password === undefined ? {} : { password }),
        }),
    });
  });
  registerPluginChannelContinuationRoutes(app);
  const requestRoute = "/v1/organizations/current/plugins/action-requests";
  app.post(requestRoute, async (c) => {
    const organization = parseConnectorOrganizationRequest(
      c,
      requestRoute,
      "POST"
    );
    if (!organization.ok) {
      return organization.response;
    }
    // Requiring the non-simple JSON content type prevents form-based cross-site
    // submissions. Core verifies the authenticated account principal and owner.
    const command =
      c.req.header("content-type")?.split(";")[0] === "application/json"
        ? pluginActionRequestCommandSchema.safeParse(
            await c.req.json().catch(() => null)
          )
        : null;
    if (!command?.success) {
      return respondBadRequest({
        c,
        route: requestRoute,
        method: "POST",
        reason: "Invalid Plugin request.",
        message: "Choose a valid Plugin request.",
      });
    }
    return executeRpcRoute({
      c,
      route: requestRoute,
      method: "POST",
      retryMode: "none",
      responseSchema: pluginActionRequestViewSchema,
      execute: async () =>
        projectPluginActionRequestView(
          await c.var.coreRpc.pluginActionRequest({
            context: buildCoreRpcContext(c),
            expectedOrganizationId: organization.expectedOrganizationId,
            command: command.data,
            ...(c.req.query("includeIssuePreview") === "true"
              ? { includeIssuePreview: true as const }
              : {}),
          }),
          c.req.query("includeMessageContext") === "true",
          c.req.query("includeIssuePreview") === "true"
        ),
    });
  });
  app.post(`${requestRoute}/list`, async (c) => {
    const organization = parseConnectorOrganizationRequest(
      c,
      requestRoute,
      "POST"
    );
    if (!organization.ok) {
      return organization.response;
    }
    const parsed = listPluginActionRequestsInputSchema
      .omit({ context: true, expectedOrganizationId: true })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: requestRoute,
        method: "POST",
        reason: "Invalid messages",
        message: "Choose valid messages.",
      });
    }
    return executeRpcRoute({
      c,
      route: requestRoute,
      method: "POST",
      retryMode: "none",
      responseSchema: listPluginActionRequestsResponseSchema,
      execute: () =>
        c.var.coreRpc.listPluginActionRequests({
          context: buildCoreRpcContext(c),
          expectedOrganizationId: organization.expectedOrganizationId,
          ...parsed.data,
        }),
    });
  });
  const actionRoute = "/v1/organizations/current/plugins/actions";
  app.post(actionRoute, async (c) => {
    const organization = parseConnectorOrganizationRequest(
      c,
      actionRoute,
      "POST"
    );
    if (!organization.ok) {
      return organization.response;
    }
    const request = pluginActionRequestSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!request.success) {
      return respondBadRequest({
        c,
        route: actionRoute,
        method: "POST",
        reason: "Invalid plugin action.",
        message: "Choose a valid plugin action.",
      });
    }
    return executeRpcRoute({
      c,
      method: "POST",
      route: actionRoute,
      retryMode: "none",
      responseSchema: pluginActionResponseSchema,
      execute: () =>
        c.var.coreRpc.pluginAction({
          context: buildCoreRpcContext(c),
          expectedOrganizationId: organization.expectedOrganizationId,
          request: request.data,
        }),
    });
  });
  const accessRoute = "/v1/organizations/current/connectors/:service/access";
  app.get(accessRoute, (c) => {
    const request = parseConnectorOrganizationRequest(c, accessRoute, "GET");
    if (!request.ok) {
      return request.response;
    }
    const service = connectorServiceSchema.safeParse(c.req.param("service"));
    if (!service.success) {
      return respondBadRequest({
        c,
        route: accessRoute,
        method: "GET",
        reason: "Choose a supported plugin.",
        message: "Choose a supported plugin.",
      });
    }
    return executeRpcRoute({
      c,
      method: "GET",
      route: accessRoute,
      retryMode: "none",
      responseSchema: pluginAccessListResponseSchema,
      execute: () =>
        c.var.coreRpc.listPluginAccess({
          context: buildCoreRpcContext(c),
          expectedOrganizationId: request.expectedOrganizationId,
          service: service.data,
        }),
    });
  });
  app.put(accessRoute, async (c) => {
    const request = parseConnectorOrganizationRequest(c, accessRoute, "PUT");
    if (!request.ok) {
      return request.response;
    }
    const service = connectorServiceSchema.safeParse(c.req.param("service"));
    const body = pluginAccessUpdateBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!(service.success && body.success)) {
      return respondBadRequest({
        c,
        route: accessRoute,
        method: "PUT",
        reason: "Choose valid plugin access settings.",
        message: "Choose valid plugin access settings.",
      });
    }
    return executeRpcRoute({
      c,
      method: "PUT",
      route: accessRoute,
      retryMode: "none",
      responseSchema: pluginAccessSchema,
      execute: () =>
        c.var.coreRpc.updatePluginAccess({
          ...body.data,
          context: buildCoreRpcContext(c),
          expectedOrganizationId: request.expectedOrganizationId,
          service: service.data,
        }),
    });
  });
  app.get(APP_CATALOG_ROUTE, (c) => {
    const request = parseConnectorOrganizationRequest(
      c,
      APP_CATALOG_ROUTE,
      "GET"
    );
    if (!request.ok) {
      return request.response;
    }
    return executeRpcRoute({
      c,
      execute: async () => {
        const membership =
          await c.var.coreRpc.listCurrentOrganizationConnectorAppRequests({
            context: buildCoreRpcContext(c),
            expectedOrganizationId: request.expectedOrganizationId,
          });
        const providers = await createOpenConnectorClient(
          c.env
        ).listProviders();
        return {
          organizationId: membership.organizationId,
          providers,
        };
      },
      method: "GET",
      responseSchema: connectorAppCatalogResponseSchema,
      retryMode: "none",
      route: APP_CATALOG_ROUTE,
    });
  });
  app.get(APP_REQUESTS_ROUTE, (c) => {
    const request = parseConnectorOrganizationRequest(
      c,
      APP_REQUESTS_ROUTE,
      "GET"
    );
    if (!request.ok) {
      return request.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.listCurrentOrganizationConnectorAppRequests({
          context: buildCoreRpcContext(c),
          expectedOrganizationId: request.expectedOrganizationId,
        }),
      method: "GET",
      responseSchema: connectorAppRequestListResponseSchema,
      retryMode: "none",
      route: APP_REQUESTS_ROUTE,
    });
  });
  app.post(APP_REQUESTS_ROUTE, async (c) => {
    const request = parseConnectorOrganizationRequest(
      c,
      APP_REQUESTS_ROUTE,
      "POST"
    );
    if (!request.ok) {
      return request.response;
    }
    const body = await parseConnectorAppRequestBody(c);
    if (!body.ok) {
      return body.response;
    }
    return await executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.createCurrentOrganizationConnectorAppRequest({
          ...body.value,
          context: buildCoreRpcContext(c),
          expectedOrganizationId: request.expectedOrganizationId,
        }),
      method: "POST",
      responseSchema: connectorAppRequestResponseSchema,
      retryMode: "none",
      route: APP_REQUESTS_ROUTE,
    });
  });
  app.get(CATALOG_CONNECTIONS_ROUTE, (c) => {
    const request = parseConnectorOrganizationRequest(
      c,
      CATALOG_CONNECTIONS_ROUTE,
      "GET"
    );
    if (!request.ok) {
      return request.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await reconcileCatalogConnections(c, {
          expectedOrganizationId: request.expectedOrganizationId,
        }),
      method: "GET",
      responseSchema: connectorConnectionListResponseSchema,
      retryMode: "none",
      route: CATALOG_CONNECTIONS_ROUTE,
    });
  });
  app.post(AUTHORIZATION_ROUTE, (c) =>
    startAuthorization(c, {
      route: AUTHORIZATION_ROUTE,
      scope: "member",
    })
  );
  app.post(SHARED_AUTHORIZATION_ROUTE, (c) =>
    startAuthorization(c, {
      route: SHARED_AUTHORIZATION_ROUTE,
      scope: "shared",
    })
  );
  app.post(CREDENTIAL_ROUTE, (c) =>
    configureCredential(c, {
      route: CREDENTIAL_ROUTE,
      scope: "member",
    })
  );
  app.post(SHARED_CREDENTIAL_ROUTE, (c) =>
    configureCredential(c, {
      route: SHARED_CREDENTIAL_ROUTE,
      scope: "shared",
    })
  );

  app.get(CONNECTIONS_ROUTE, (c) => {
    const request = parseConnectorRouteRequest(c, CONNECTIONS_ROUTE, "GET");
    if (!request.ok) {
      return request.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await reconcileConnectorConnections(c, {
          expectedOrganizationId: request.expectedOrganizationId,
          service: request.service,
        }),
      method: "GET",
      responseSchema: connectorConnectionListResponseSchema,
      retryMode: "none",
      route: CONNECTIONS_ROUTE,
    });
  });

  app.delete(`${CONNECTIONS_ROUTE}/shared`, (c) =>
    disconnectConnection(c, {
      route: CONNECTIONS_ROUTE,
      scope: "shared",
    })
  );
  app.delete(`${CONNECTIONS_ROUTE}/:userId`, (c) =>
    disconnectConnection(c, {
      route: CONNECTIONS_ROUTE,
      scope: "member",
    })
  );
}

async function parseConnectorAppRequestBody(
  c: Context<HonoBindings>
): Promise<
  | { ok: true; value: CreateConnectorAppRequestBody }
  | { ok: false; response: Response }
> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = null;
  }
  const parsed = createConnectorAppRequestBodySchema.safeParse(body);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    response: respondBadRequest({
      c,
      code: "invalid_payload",
      message:
        parsed.error.issues[0]?.message ??
        "The App request payload is invalid.",
      method: "POST",
      route: APP_REQUESTS_ROUTE,
    }),
  };
}

async function startAuthorization(
  c: Context<HonoBindings>,
  input: {
    route: string;
    scope: "member" | "shared";
  }
): Promise<Response> {
  const request = parseConnectorRouteRequest(c, input.route, "POST");
  if (!request.ok) {
    return request.response;
  }
  let existingGitHubInstallation = false;
  if (input.scope === "shared" && request.service === "github") {
    const rawBody = await c.req.text();
    if (rawBody.trim()) {
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = null;
      }
      if (
        rawBody.length > 128 ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !("existingInstallation" in body && body.existingInstallation === true)
      ) {
        return respondBadRequest({
          c,
          code: "invalid_payload",
          message: "Choose a valid GitHub installation action.",
          method: "POST",
          route: input.route,
        });
      }
      existingGitHubInstallation = true;
    }
  }
  return executeRpcRoute({
    c,
    execute: async () => {
      const context = buildCoreRpcContext(c);
      if (input.scope === "shared" && request.service === "github") {
        const installation =
          await c.var.coreRpc.beginCurrentOrganizationGitHubAppInstallation({
            context,
            expectedOrganizationId: request.expectedOrganizationId,
          });
        const authorizationUrl = existingGitHubInstallation
          ? new URL(
              (
                await createOpenConnectorClient(c.env).startAuthorization({
                  connectionName: installation.verificationConnectionName,
                  service: "github",
                })
              ).authorizationUrl
            )
          : new URL(
              `https://github.com/apps/${requireGitHubAppSlug(c.env)}/installations/new`
            );
        if (!existingGitHubInstallation) {
          authorizationUrl.searchParams.set("state", installation.state);
        }
        return {
          authorizationUrl: authorizationUrl.toString(),
          connection: installation.connection,
          ...(request.includeAuthorizationExpiry
            ? { expiresAtMs: installation.expiresAtMs }
            : {}),
        };
      }
      const connection =
        input.scope === "shared"
          ? await c.var.coreRpc.beginCurrentOrganizationSharedConnectorAuthorization(
              {
                context,
                expectedOrganizationId: request.expectedOrganizationId,
                service: request.service,
              }
            )
          : await c.var.coreRpc.beginCurrentMemberConnectorAuthorization({
              context,
              expectedOrganizationId: request.expectedOrganizationId,
              service: request.service,
            });
      const authorization = await createOpenConnectorClient(
        c.env
      ).startAuthorization({
        connectionName: connection.connectionName,
        service: request.service,
      });
      return {
        authorizationUrl: authorization.authorizationUrl,
        connection,
      };
    },
    method: "POST",
    responseSchema: connectorAuthorizationStartResponseSchema,
    retryMode: "none",
    route: input.route,
  });
}

async function configureCredential(
  c: Context<HonoBindings>,
  input: {
    route: string;
    scope: "member" | "shared";
  }
): Promise<Response> {
  const request = parseConnectorRouteRequest(c, input.route, "POST");
  if (!request.ok) {
    return request.response;
  }
  const credential = await parseCredentialBody(c, input.route);
  if (!credential.ok) {
    return credential.response;
  }
  return await executeRpcRoute({
    c,
    execute: async () => {
      const context = buildCoreRpcContext(c);
      const pendingConnection =
        input.scope === "shared"
          ? await c.var.coreRpc.beginCurrentOrganizationSharedConnectorAuthorization(
              {
                context,
                expectedOrganizationId: request.expectedOrganizationId,
                service: request.service,
              }
            )
          : await c.var.coreRpc.beginCurrentMemberConnectorAuthorization({
              context,
              expectedOrganizationId: request.expectedOrganizationId,
              service: request.service,
            });
      try {
        await createOpenConnectorClient(c.env).configureConnection({
          ...credential.body,
          connectionName: pendingConnection.connectionName,
          service: request.service,
        });
        const reconciled = await reconcileConnectorConnections(c, {
          expectedOrganizationId: request.expectedOrganizationId,
          service: request.service,
        });
        const connection = reconciled.connections.find(
          (candidate) =>
            candidate.connectionName === pendingConnection.connectionName &&
            candidate.status === "active"
        );
        if (!connection) {
          throw new Error(
            "The configured connector connection was not activated by Core."
          );
        }
        return { connection };
      } catch (error) {
        // A configuration may complete after its account was closed. Register
        // durable compensation before attempting the immediate disconnect.
        const scheduled = await c.var.authRpc.requestAccountConnectionCleanup({
          userId: context.actorContext.ownerUserId,
          connectionName: pendingConnection.connectionName,
          service: request.service,
        });
        if (scheduled) {
          await createOpenConnectorClient(c.env)
            .disconnect({
              connectionName: pendingConnection.connectionName,
              service: request.service,
            })
            .catch(() => {
              console.warn("[gateway.account.connection_cleanup_pending]", {
                userId: context.actorContext.ownerUserId,
              });
            });
        }
        throw error;
      }
    },
    method: "POST",
    responseSchema: connectorCredentialConnectResponseSchema,
    retryMode: "none",
    route: input.route,
  });
}

function disconnectConnection(
  c: Context<HonoBindings>,
  input: {
    route: string;
    scope: "member" | "shared";
  }
): Response | Promise<Response> {
  const request = parseConnectorRouteRequest(c, input.route, "DELETE");
  if (!request.ok) {
    return request.response;
  }
  return executeRpcRoute({
    c,
    execute: async () => {
      const context = buildCoreRpcContext(c);
      const userId =
        input.scope === "member" ? c.req.param("userId") : undefined;
      const authorized = await c.var.coreRpc.authorizeConnectorDisconnect({
        context,
        expectedOrganizationId: request.expectedOrganizationId,
        ...(input.scope === "shared" ? { scope: "shared" as const } : {}),
        service: request.service,
        ...(userId ? { userId } : {}),
      });
      await createOpenConnectorClient(c.env).disconnect({
        connectionName: authorized.connectionName,
        service: request.service,
      });
      const connection = await c.var.coreRpc.completeConnectorDisconnect({
        connectionName: authorized.connectionName,
        context,
        expectedOrganizationId: request.expectedOrganizationId,
        ...(input.scope === "shared" ? { scope: "shared" as const } : {}),
        service: request.service,
        ...(userId ? { userId } : {}),
      });
      return { connection };
    },
    method: "DELETE",
    responseSchema: connectorDisconnectResponseSchema,
    retryMode: "none",
    route: input.route,
  });
}

async function reconcileConnectorConnections(
  c: Context<HonoBindings>,
  input: {
    expectedOrganizationId: string;
    service: ConnectorService;
  }
) {
  const openConnector = createOpenConnectorClient(c.env);
  let connections = await openConnector.listConnections();
  if (input.service === "github") {
    connections = await reconcileGitHubAppInstallation(c, {
      connections,
      expectedOrganizationId: input.expectedOrganizationId,
      openConnector,
    });
  }
  const result =
    await c.var.coreRpc.reconcileCurrentOrganizationConnectorConnections({
      availableConnectionNames: connections
        .filter(
          (connection) =>
            connection.service === input.service && connection.configured
        )
        .map((connection) => connection.connectionName),
      context: buildCoreRpcContext(c),
      expectedOrganizationId: input.expectedOrganizationId,
      service: input.service,
    });
  return {
    ...result,
    connections: projectConnectionHealth(c, result.connections, connections),
  };
}

function projectConnectionHealth(
  c: Context<HonoBindings>,
  registered: ConnectorConnection[],
  available: OpenConnectorConnection[]
) {
  // Published clients use strict schemas. Only opted-in clients receive the new field.
  if (c.req.query("includeConnectionHealth") !== "true") {
    return registered;
  }
  return registered.map((connection) => {
    const health = available.find(
      (item) =>
        item.connectionName === connection.connectionName &&
        item.service === connection.service
    )?.health;
    return health ? { ...connection, health } : connection;
  });
}

async function reconcileGitHubAppInstallation(
  c: Context<HonoBindings>,
  input: {
    connections: OpenConnectorConnection[];
    expectedAccountLogin?: string;
    expectedOrganizationId: string;
    openConnector: OpenConnectorClient;
  }
): Promise<OpenConnectorConnection[]> {
  const pending = await c.var.coreRpc.readPendingGitHubAppInstallation({
    context: buildCoreRpcContext(c),
    expectedOrganizationId: input.expectedOrganizationId,
  });
  if (!pending) {
    return input.connections;
  }

  if (pending.status === "installing") {
    if (
      !hasConfiguredGitHubConnection(
        input.connections,
        pending.verificationConnectionName
      )
    ) {
      return input.connections;
    }
    let installation: { accountLogin: string; installationId: string };
    try {
      installation =
        await input.openConnector.findAccessibleGitHubAppInstallation(
          pending.verificationConnectionName
        );
    } catch {
      console.warn(
        "[gateway.github_app.existing_installation_verification_failed]",
        {
          organizationId: input.expectedOrganizationId,
          requestId: c.var.ingressOpenMeldContext.requestId,
        }
      );
      throw new ConnectorConnectionRouteError({
        code: "connector.github_app_existing_installation_unavailable",
        message:
          "GitHub authorization finished, but OpenMeld could not verify one organization installation of this App. Check that you can access the installation in GitHub, then try again.",
        status: 502,
      });
    }
    const accepted =
      await c.var.coreRpc.beginExistingGitHubAppInstallationVerification({
        context: buildCoreRpcContext(c),
        expectedOrganizationId: input.expectedOrganizationId,
        installationId: installation.installationId,
        verificationConnectionName: pending.verificationConnectionName,
      });
    if (!accepted) {
      return input.connections;
    }
    return await reconcileGitHubAppInstallation(c, {
      ...input,
      expectedAccountLogin: installation.accountLogin,
    });
  }
  if (!pending.installationId) {
    throw new Error(
      "GitHub App installation verification has no installation id."
    );
  }

  const targetConfigured = hasConfiguredGitHubConnection(
    input.connections,
    pending.targetConnectionName
  );
  const verifierConfigured = hasConfiguredGitHubConnection(
    input.connections,
    pending.verificationConnectionName
  );
  let connections = input.connections;
  if (targetConfigured && verifierConfigured) {
    await input.openConnector.disconnect({
      connectionName: pending.verificationConnectionName,
      service: "github",
    });
    connections = await input.openConnector.listConnections();
  } else if (verifierConfigured) {
    await completeGitHubAppInstallation(c, {
      openConnector: input.openConnector,
      expectedAccountLogin: input.expectedAccountLogin,
      pending: { ...pending, installationId: pending.installationId },
    });
    connections = await input.openConnector.listConnections();
  }

  if (
    !(
      targetConfigured ||
      hasConfiguredGitHubConnection(connections, pending.targetConnectionName)
    )
  ) {
    return connections;
  }

  const completed = await c.var.coreRpc.completeGitHubAppInstallation({
    context: buildCoreRpcContext(c),
    expectedOrganizationId: input.expectedOrganizationId,
    installationId: pending.installationId,
    targetConnectionName: pending.targetConnectionName,
    verificationConnectionName: pending.verificationConnectionName,
  });
  if (!completed) {
    throw new Error(
      "Core rejected completion of the pending GitHub App installation."
    );
  }
  return connections;
}

async function completeGitHubAppInstallation(
  c: Context<HonoBindings>,
  input: {
    expectedAccountLogin?: string;
    openConnector: OpenConnectorClient;
    pending: {
      installationId: string;
      organizationId: string;
      targetConnectionName: string;
      verificationConnectionName: string;
    };
  }
): Promise<void> {
  try {
    await input.openConnector.completeGitHubAppInstallation({
      ...(input.expectedAccountLogin
        ? { expectedAccountLogin: input.expectedAccountLogin }
        : {}),
      installationId: input.pending.installationId,
      targetConnectionName: input.pending.targetConnectionName,
      verificationConnectionName: input.pending.verificationConnectionName,
    });
  } catch (error) {
    console.warn("[gateway.github_app.installation_completion_failed]", {
      error: toSafeErrorMessage(error),
      installationId: input.pending.installationId,
      organizationId: input.pending.organizationId,
      requestId: c.var.ingressOpenMeldContext.requestId,
    });
    throw new ConnectorConnectionRouteError({
      code: GITHUB_APP_SETUP_UNAVAILABLE_CODE,
      message: "OpenMeld could not finish GitHub setup. Try again.",
      status: 502,
    });
  }
}

function hasConfiguredGitHubConnection(
  connections: OpenConnectorConnection[],
  connectionName: string
): boolean {
  return connections.some(
    (connection) =>
      connection.configured &&
      connection.service === "github" &&
      connection.connectionName === connectionName
  );
}

function toSafeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
}

async function reconcileCatalogConnections(
  c: Context<HonoBindings>,
  input: { expectedOrganizationId: string }
) {
  const connectorConnections = await createOpenConnectorClient(
    c.env
  ).listConnections();
  const context = buildCoreRpcContext(c);
  const stored =
    await c.var.coreRpc.listCurrentOrganizationConnectorConnections({
      context,
      expectedOrganizationId: input.expectedOrganizationId,
    });
  const services = [
    ...new Set(stored.connections.map((connection) => connection.service)),
  ];
  const serviceResponses = await Promise.all(
    services.map(
      async (service) =>
        await c.var.coreRpc.reconcileCurrentOrganizationConnectorConnections({
          availableConnectionNames: connectorConnections
            .filter(
              (connection) =>
                connection.service === service && connection.configured
            )
            .map((connection) => connection.connectionName),
          context,
          expectedOrganizationId: input.expectedOrganizationId,
          service,
        })
    )
  );
  const identity = stored;
  return {
    connections: projectConnectionHealth(
      c,
      serviceResponses.flatMap((response) => response.connections),
      connectorConnections
    ),
    currentUserId: identity.currentUserId,
    organizationId: identity.organizationId,
  };
}

function parseConnectorRouteRequest(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod
):
  | {
      expectedOrganizationId: string;
      includeAuthorizationExpiry: boolean;
      ok: true;
      service: ConnectorService;
    }
  | { ok: false; response: Response } {
  const service = connectorServiceSchema.safeParse(c.req.param("service"));
  if (!service.success) {
    return {
      ok: false,
      response: respondBadRequest({
        c,
        code: "invalid_payload",
        message: "This App is not supported.",
        method,
        route,
      }),
    };
  }
  const organization = parseConnectorOrganizationRequest(c, route, method);
  if (!organization.ok) {
    return organization;
  }
  return {
    expectedOrganizationId: organization.expectedOrganizationId,
    includeAuthorizationExpiry: organization.includeAuthorizationExpiry,
    ok: true,
    service: service.data,
  };
}

function parseConnectorOrganizationRequest(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod
):
  | {
      expectedOrganizationId: string;
      includeAuthorizationExpiry: boolean;
      ok: true;
    }
  | { ok: false; response: Response } {
  const organization = connectorOrganizationContextQuerySchema.safeParse(
    c.req.query()
  );
  if (organization.success) {
    return {
      expectedOrganizationId: organization.data.expectedOrganizationId,
      includeAuthorizationExpiry:
        organization.data.includeAuthorizationExpiry === "true",
      ok: true,
    };
  }
  return {
    ok: false,
    response: respondBadRequest({
      c,
      code: "invalid_payload",
      message:
        organization.error.issues[0]?.message ??
        "The expected Organization is required.",
      method,
      route,
    }),
  };
}

async function parseCredentialBody(
  c: Context<HonoBindings>,
  route: string
): Promise<
  | { body: ConnectorCredentialConnectBody; ok: true }
  | { ok: false; response: Response }
> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = null;
  }
  const parsed = connectorCredentialConnectBodySchema.safeParse(body);
  if (parsed.success) {
    return { body: parsed.data, ok: true };
  }
  return {
    ok: false,
    response: respondBadRequest({
      c,
      code: "invalid_payload",
      message:
        parsed.error.issues[0]?.message ??
        "The App credential payload is invalid.",
      method: "POST",
      route,
    }),
  };
}

function createOpenConnectorClient(
  env: CloudflareBindings
): OpenConnectorClient {
  const bindings = env as CloudflareBindings & OpenConnectorBindings;
  return new OpenConnectorClient({
    adminToken: bindings.OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN ?? "",
    runtimeToken: bindings.OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN,
    baseUrl: bindings.OPENMELD_CONNECTORS_BASE_URL ?? "",
  });
}

function requireGitHubAppSlug(env: OpenConnectorBindings): string {
  const slug = env.GITHUB_OPENMELD_APP_SLUG?.trim() ?? "";
  if (!GITHUB_APP_SLUG_PATTERN.test(slug)) {
    throw new Error("OpenMeld GitHub App slug is not configured.");
  }
  return slug;
}
