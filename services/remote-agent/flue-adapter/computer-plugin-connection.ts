import {
  pluginConnectionGrantSchema,
  remoteAgentExecutionScopeKey,
} from "@openmeld/schemas";
import { digestCanonicalJson } from "@openmeld/utils";
import { picklist, strictObject, string } from "valibot";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import {
  buildConnectorToolContext,
  requireAvailableConnectorConnection,
  resolveConnectorTurnRequester,
} from "../agent-core/connector-tools";
import { requireRemoteAgentExecutionAccess } from "../agent-core/execution-access";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import type { ConnectorExecutionConfig } from "../connectors/open-connector-runtime";
import {
  describePluginConnection,
  pluginConnectionInstructions,
} from "../connectors/plugin-connection";
import type { AgentComputerWorkspaceAccess } from "./agent-computer-workspace-access";

export function createComputerPluginConnectionTool(input: {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  workspaceAccess: AgentComputerWorkspaceAccess;
  connectorExecution: ConnectorExecutionConfig;
}): RemoteAgentToolDefinition {
  return {
    name: "computer_plugin_connection",
    description:
      "Reuse an existing Plugin account from your Computer without another login. Choose service, account (personal or shared), and a stable key. Returns current credential health, supported native HTTP read paths, official documentation, and a temporary base URL for CLI/SDK/HTTP requests. Missing native transport means use Plugin actions. Use computer_git_connection for Git clone/fetch and Plugin actions for writes. Renew with the same key after expiry. Do not put provider tokens on the Computer.",
    input: strictObject({
      service: string(),
      account: picklist(["personal", "shared"]),
      key: string(),
    }),
    async execute(raw) {
      const request = raw as {
        service: string;
        account: "personal" | "shared";
        key: string;
      };
      if (!request.key.trim() || request.key.length > 256) {
        throw new Error("plugin.connection_key_invalid");
      }
      const scope = await requireRemoteAgentExecutionAccess(input);
      const toolContext = await buildConnectorToolContext({
        ...input,
        submissionId: input.context.submissionId,
        toolName: "computer_plugin_connection",
      });
      if (toolContext.turnEnvelope?.sender.kind === "agent_profile") {
        throw new Error(
          "Use the explicitly delegated Plugin action; a native connection grants broader access."
        );
      }
      const requester = resolveConnectorTurnRequester(
        toolContext,
        request.account === "personal" ? "requester" : "shared"
      );
      if (!requester.requesterUserId) {
        throw new Error("plugin.requester_identity_unavailable");
      }
      const selected = await requireAvailableConnectorConnection({
        ...input,
        ...requester,
        service: request.service,
        toolContext,
        submissionId: input.context.submissionId,
      });
      const description = await describePluginConnection({
        service: request.service,
        connectionName: selected.connection.connectionName,
        connectorExecution: input.connectorExecution,
      });
      if (
        !description.nativeHttp ||
        description.connection?.health.state === "reconnect_required"
      ) {
        return pluginConnectionInstructions(description);
      }
      const scopeKey = remoteAgentExecutionScopeKey(scope);
      const id = await digestCanonicalJson([
        scopeKey,
        input.context.submissionId,
        "plugin",
        request.key,
      ]);
      const expiresAtMs = Date.now() + 29 * 60 * 1000;
      if (!input.workspaceAccess.registerPluginConnectionGrant) {
        throw new Error("plugin.computer_connection_unavailable");
      }
      await input.workspaceAccess.registerPluginConnectionGrant(
        pluginConnectionGrantSchema.parse({
          id,
          service: request.service,
          organizationId: input.context.organizationId,
          requesterUserId: requester.requesterUserId,
          connectionName: selected.connection.connectionName,
          connectionUpdatedAtMs: selected.connection.updatedAtMs,
          connectionScope: selected.connection.scope,
          expiresAtMs,
          authority: {
            kind: "remote",
            scopeKey,
            authorization: {
              context: buildRemoteAgentCoreContext(
                input.context,
                `plugin-connection:${id}`
              ),
              submissionId: input.context.submissionId,
              effect: "read",
              sources: [
                {
                  kind: "plugin_connection",
                  service: request.service,
                  connectionName: selected.connection.connectionName,
                  connectionUpdatedAtMs: selected.connection.updatedAtMs,
                },
              ],
            },
          },
        })
      );
      return {
        ...pluginConnectionInstructions(
          description,
          `http://computer.internal/connections/${id}`
        ),
        expiresAtMs,
      };
    },
  };
}
