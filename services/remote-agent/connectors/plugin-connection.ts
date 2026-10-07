import { pluginConnectionDescriptionSchema } from "@openmeld/schemas";
import {
  type ConnectorExecutionConfig,
  requireConnectorRuntime,
} from "./open-connector-runtime";

export async function describePluginConnection(input: {
  service: string;
  connectionName: string;
  connectorExecution: ConnectorExecutionConfig;
}) {
  const runtime = requireConnectorRuntime(input.connectorExecution);
  const response = await runtime.fetch(
    `${runtime.baseUrl}/v1/openmeld/connections/${encodeURIComponent(input.service)}/describe`,
    {
      headers: {
        authorization: `Bearer ${runtime.runtimeToken}`,
        "x-oo-connector-alias": input.connectionName,
      },
    }
  );
  if (!response.ok) {
    throw new Error(
      `Plugin connection description is unavailable (HTTP ${response.status}).`
    );
  }
  const result = pluginConnectionDescriptionSchema.parse(await response.json());
  if (
    result.service !== input.service ||
    result.connection?.connectionName !== input.connectionName
  ) {
    throw new Error("Plugin returned a different connection.");
  }
  return result;
}

export async function forwardPluginConnection(input: {
  request: Request;
  endpoint: string;
  service: string;
  connectionName: string;
  connectorExecution: ConnectorExecutionConfig;
}) {
  const runtime = requireConnectorRuntime(input.connectorExecution);
  // The upstream accepts only catalog-declared read operations. Caller authorization remains Core-owned.
  const response = await runtime.fetch(
    `${runtime.baseUrl}/v1/openmeld/connections/${encodeURIComponent(input.service)}/request${input.endpoint}`,
    {
      method: input.request.method,
      headers: {
        authorization: `Bearer ${runtime.runtimeToken}`,
        "x-oo-connector-alias": input.connectionName,
        "content-type": "application/json",
      },
      body: input.request.body,
      signal: input.request.signal,
      redirect: "manual",
      ...(input.request.body ? { duplex: "half" } : {}),
    } as RequestInit
  );
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}

export function pluginConnectionInstructions(
  description: ReturnType<typeof pluginConnectionDescriptionSchema.parse>,
  baseUrl?: string
) {
  const cli = description.nativeHttp?.cli;
  let nextAction =
    "This Plugin does not declare native HTTP access. Use its Plugin actions.";
  if (description.connection?.health.state === "reconnect_required") {
    nextAction =
      "Reconnect this same account in Plugins. Do not sign in again inside the Computer.";
  } else if (description.nativeHttp) {
    nextAction =
      "Reuse this Plugin account. Inspect its native HTTP read rules and official documentation. Run a CLI, SDK, or HTTP client with computer action=command and backend=container, using the returned base URL; apply environment only to that command. Provider credentials stay on the server. Use Plugin actions for writes. Renew the same key if this temporary connection expires.";
  }
  return {
    description,
    ...(baseUrl ? { baseUrl } : {}),
    environment:
      baseUrl && cli
        ? {
            [cli.baseUrlEnvironment]: baseUrl,
            [cli.tokenEnvironment]: "openmeld-connection",
          }
        : {},
    nextAction,
  };
}
