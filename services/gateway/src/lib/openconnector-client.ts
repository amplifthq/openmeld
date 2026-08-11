import { connectorAppCatalogProviderSchema } from "@openmeld/schemas";
import type { ConnectorAppCatalogProvider } from "@openmeld/schemas/types";
import { z } from "zod/v4";

const TRAILING_SLASH_PATTERN = /\/+$/u;

const openConnectorAuthorizationSchema = z.object({
  authorizationUrl: z.url(),
  state: z.string().min(1),
});

const openConnectorErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1).max(1000),
  }),
});

const openConnectorConnectionSchema = z.object({
  configured: z.boolean(),
  connectionName: z.string().min(1),
  service: z.string().min(1),
});

const openConnectorDisconnectedConnectionSchema = z.object({
  configured: z.literal(false),
  connectionName: z.string().min(1),
  service: z.string().min(1),
});

const openConnectorConfiguredConnectionSchema = z.object({
  configured: z.literal(true),
  connectionName: z.string().min(1),
  service: z.string().min(1),
});

const openConnectorProviderListSchema = z.object({
  data: z.array(connectorAppCatalogProviderSchema).max(5000),
  success: z.literal(true),
});

export type OpenConnectorAuthorization = z.infer<
  typeof openConnectorAuthorizationSchema
>;

export type OpenConnectorConnection = z.infer<
  typeof openConnectorConnectionSchema
>;

export class OpenConnectorClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OpenConnectorClientError";
    this.status = status;
  }
}

export class OpenConnectorClient {
  readonly #adminToken: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(input: {
    adminToken: string;
    baseUrl: string;
    fetch?: typeof fetch;
  }) {
    this.#adminToken = requireConfigurationValue(
      input.adminToken,
      "OpenConnector admin token"
    );
    this.#baseUrl = requireConfigurationValue(
      input.baseUrl,
      "OpenConnector base URL"
    ).replace(TRAILING_SLASH_PATTERN, "");
    const fetchImplementation = input.fetch ?? globalThis.fetch;
    this.#fetch = fetchImplementation.bind(globalThis);
  }

  async startAuthorization(input: {
    connectionName: string;
    service: string;
  }): Promise<OpenConnectorAuthorization> {
    const payload = await this.#request("/api/oauth/authorizations", {
      body: JSON.stringify(input),
      method: "POST",
    });
    return parseOpenConnectorPayload({
      payload,
      schema: openConnectorAuthorizationSchema,
      operation: "start authorization",
    });
  }

  async listConnections(): Promise<OpenConnectorConnection[]> {
    const payload = await this.#request("/api/connections", { method: "GET" });
    return parseOpenConnectorPayload({
      payload,
      schema: z.array(openConnectorConnectionSchema),
      operation: "list connections",
    });
  }

  async listProviders(): Promise<ConnectorAppCatalogProvider[]> {
    const payload = await this.#request("/v1/providers", { method: "GET" });
    return parseOpenConnectorPayload({
      operation: "list providers",
      payload,
      schema: openConnectorProviderListSchema,
    }).data;
  }

  async configureConnection(input: {
    authType: "api_key" | "custom_credential";
    connectionName: string;
    service: string;
    values: Record<string, string>;
  }): Promise<void> {
    const payload = await this.#request(
      `/api/connections/${encodeURIComponent(input.service)}`,
      {
        body: JSON.stringify({
          authType: input.authType,
          connectionName: input.connectionName,
          values: input.values,
        }),
        method: "PUT",
      }
    );
    const configured = parseOpenConnectorPayload({
      payload,
      schema: openConnectorConfiguredConnectionSchema,
      operation: "configure account",
    });
    if (
      configured.connectionName !== input.connectionName ||
      configured.service !== input.service
    ) {
      throw new OpenConnectorClientError(
        "OpenConnector configured an unexpected connection.",
        502
      );
    }
  }

  async completeGitHubAppInstallation(input: {
    installationId: string;
    targetConnectionName: string;
    verificationConnectionName: string;
  }): Promise<void> {
    const payload = await this.#request("/api/providers/github/installations", {
      body: JSON.stringify(input),
      method: "POST",
    });
    const configured = parseOpenConnectorPayload({
      payload,
      schema: openConnectorConfiguredConnectionSchema,
      operation: "complete GitHub App installation",
    });
    if (
      configured.connectionName !== input.targetConnectionName ||
      configured.service !== "github"
    ) {
      throw new OpenConnectorClientError(
        "OpenConnector configured an unexpected GitHub connection.",
        502
      );
    }
  }

  async disconnect(input: {
    connectionName: string;
    service: string;
  }): Promise<void> {
    const payload = await this.#request(
      `/api/connections/${encodeURIComponent(input.service)}`,
      {
        body: JSON.stringify({ connectionName: input.connectionName }),
        method: "DELETE",
      }
    );
    const disconnected = parseOpenConnectorPayload({
      payload,
      schema: openConnectorDisconnectedConnectionSchema,
      operation: "disconnect account",
    });
    if (
      disconnected.connectionName !== input.connectionName ||
      disconnected.service !== input.service
    ) {
      throw new OpenConnectorClientError(
        "OpenConnector disconnected an unexpected connection.",
        502
      );
    }
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.#adminToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    if (!response.ok) {
      throw new OpenConnectorClientError(
        await readOpenConnectorErrorMessage(response),
        502
      );
    }
    try {
      return await response.json();
    } catch {
      throw new OpenConnectorClientError(
        "OpenConnector returned an invalid JSON response.",
        502
      );
    }
  }
}

async function readOpenConnectorErrorMessage(
  response: Response
): Promise<string> {
  try {
    const parsed = openConnectorErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      return parsed.data.error.message;
    }
  } catch {
    // Fall through to the stable status-only message.
  }
  return `OpenConnector request failed with status ${response.status}.`;
}

function parseOpenConnectorPayload<T>(input: {
  operation: string;
  payload: unknown;
  schema: z.ZodType<T>;
}): T {
  const parsed = input.schema.safeParse(input.payload);
  if (!parsed.success) {
    throw new OpenConnectorClientError(
      `OpenConnector returned an invalid response while attempting to ${input.operation}.`,
      502
    );
  }
  return parsed.data;
}

function requireConfigurationValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new OpenConnectorClientError(`${label} is not configured.`, 503);
  }
  return normalized;
}
