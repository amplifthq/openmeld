import {
  messageChannelConnectionProjectionSchema,
  messageChannelProviderSchema,
} from "@openmeld/schemas";
import type { MessageChannelConnectionProjection } from "@openmeld/schemas/types";
import {
  listRemoteAgentLarkPlatformChannelConnectionsForOrganization,
  type RemoteAgentLarkPlatformChannelConnectionRecord,
} from "../infrastructure/d1/lark-platform-channel-connection-repo";
import {
  type RemoteAgentSlackWorkspaceBindingRecord,
  readRemoteAgentSlackWorkspaceBindingByOrganization,
} from "../infrastructure/d1/slack-workspace-binding-repo";

export type MessageChannelConnectionProjectionDependencies = {
  listLarkPlatformConnections(input: {
    db: D1Database;
    organizationId: string;
  }): Promise<RemoteAgentLarkPlatformChannelConnectionRecord[]>;
  readSlackBinding(input: {
    db: D1Database;
    organizationId: string;
  }): Promise<RemoteAgentSlackWorkspaceBindingRecord | null>;
};

const DEFAULT_DEPENDENCIES: MessageChannelConnectionProjectionDependencies = {
  listLarkPlatformConnections:
    listRemoteAgentLarkPlatformChannelConnectionsForOrganization,
  readSlackBinding: readRemoteAgentSlackWorkspaceBindingByOrganization,
};

export async function listRemoteAgentMessageChannelConnectionProjections(
  input: {
    identityDb: D1Database;
    organizationId: string;
    stateDb: D1Database;
  },
  dependencies: MessageChannelConnectionProjectionDependencies = DEFAULT_DEPENDENCIES
): Promise<MessageChannelConnectionProjection[]> {
  const [slackBinding, larkPlatformConnections] = await Promise.all([
    dependencies.readSlackBinding({
      db: input.identityDb,
      organizationId: input.organizationId,
    }),
    dependencies.listLarkPlatformConnections({
      db: input.stateDb,
      organizationId: input.organizationId,
    }),
  ]);
  const connections = [
    ...(slackBinding ? [projectSlackConnection(slackBinding)] : []),
    ...larkPlatformConnections.map((connection) => {
      if (connection.organizationId !== input.organizationId) {
        throw new Error(
          "Message Channel repository returned a connection from another Organization"
        );
      }
      return projectRemoteAgentLarkPlatformConnection(connection);
    }),
  ];
  return connections.sort(
    (left, right) =>
      providerOrder(left.provider) - providerOrder(right.provider)
  );
}

function projectSlackConnection(
  binding: RemoteAgentSlackWorkspaceBindingRecord
): MessageChannelConnectionProjection {
  return messageChannelConnectionProjectionSchema.parse({
    externalAccountId: binding.slackTeamId,
    externalAccountName: null,
    grantedCapabilityGroups: [],
    id: `slack:${binding.slackTeamId}`,
    lastVerifiedAt: null,
    permissionBundleVersion: null,
    provider: "slack",
    reasonCode: null,
    status: "connected",
    transport: "webhook",
  });
}

export function projectRemoteAgentLarkPlatformConnection(
  connection: RemoteAgentLarkPlatformChannelConnectionRecord
): MessageChannelConnectionProjection {
  return messageChannelConnectionProjectionSchema.parse({
    externalAccountId: connection.tenantKey ?? connection.appId,
    externalAccountName: connection.botName,
    grantedCapabilityGroups: [...connection.grantedCapabilityGroups],
    id: connection.connectionId,
    lastVerifiedAt:
      connection.lastVerifiedAtMs === null
        ? null
        : new Date(connection.lastVerifiedAtMs).toISOString(),
    permissionBundleVersion: connection.permissionBundleVersion,
    provider: connection.provider,
    reasonCode: connection.failureReasonCode,
    status: connection.status,
    transport: connection.transport,
  });
}

function providerOrder(
  provider: MessageChannelConnectionProjection["provider"]
) {
  return messageChannelProviderSchema.options.indexOf(provider);
}
