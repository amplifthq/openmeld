import {
  messageChannelConnectionProjectionSchema,
  messageChannelProviderSchema,
  SLACK_BOT_SCOPES,
} from "@openmeld/schemas";
import type { MessageChannelConnectionProjection } from "@openmeld/schemas/types";
import {
  listRemoteAgentLarkPlatformChannelConnectionsForOrganization,
  type RemoteAgentLarkPlatformChannelConnectionRecord,
} from "../infrastructure/d1/lark-platform-channel-connection-repo";
import {
  disconnectRemoteAgentLarkPlatformIdentityLink,
  listRemoteAgentLarkPlatformIdentityLinks,
} from "../infrastructure/d1/lark-platform-identity-link-repo";
import {
  disconnectSlackUserIdentityLink,
  readSlackUserIdentityLinksForOrganization,
} from "../infrastructure/d1/slack-user-identity-link-repo";
import {
  type RemoteAgentSlackWorkspaceBindingRecord,
  readRemoteAgentSlackWorkspaceBindingByOrganization,
} from "../infrastructure/d1/slack-workspace-binding-repo";
import { readSlackWorkspaceToken } from "../infrastructure/d1/slack-workspace-token-repo";
import { requiresLarkPlatformAuthorizationUpdate } from "./lark-platform-permission-bundles";
import type { MessageChannelIdentityLinkAuditRecord } from "./message-channel-identity-link-audit";

const PROVIDER_ACCOUNT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export type MessageChannelIdentityLinkProjection = {
  connectedAt: string;
  id: string;
  openMeldUserId: string;
  provider: MessageChannelConnectionProjection["provider"];
  providerAccountEmail: string | null;
  providerAccountName: string | null;
};

export type MessageChannelProviderAccountEmailsResolver = (input: {
  provider: MessageChannelConnectionProjection["provider"];
  providerUserIds: readonly string[];
}) => Promise<ReadonlyMap<string, string | null>>;

export type MessageChannelIdentityLinkTarget =
  | {
      connectionId: string;
      id: string;
      openMeldUserId: string;
      provider: "feishu" | "lark";
      providerUserId: string;
    }
  | {
      id: string;
      openMeldUserId: string;
      provider: "slack";
      providerUserId: string;
      slackTeamId: string;
    };

export type MessageChannelConnectionProjectionDependencies = {
  readSlackToken: typeof readSlackWorkspaceToken;
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
  readSlackToken: readSlackWorkspaceToken,
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
  const slackToken = slackBinding
    ? await dependencies.readSlackToken({
        db: input.identityDb,
        slackTeamId: slackBinding.slackTeamId,
      })
    : null;
  const slackNeedsAuthorization =
    slackToken?.organizationId === input.organizationId &&
    slackToken.grantedBotScopes !== null &&
    SLACK_BOT_SCOPES.some(
      (scope) => !slackToken.grantedBotScopes?.includes(scope)
    );
  const connections = [
    ...(slackBinding
      ? [projectSlackConnection(slackBinding, slackNeedsAuthorization)]
      : []),
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

export async function listRemoteAgentMessageChannelIdentityLinkProjections(input: {
  connections: readonly MessageChannelConnectionProjection[];
  identityDb: D1Database;
  organizationId: string;
  resolveProviderAccountEmails?: MessageChannelProviderAccountEmailsResolver;
  stateDb: D1Database;
}): Promise<MessageChannelIdentityLinkProjection[]> {
  const records = await Promise.all(
    input.connections.map(async (connection) => {
      if (connection.provider === "slack") {
        const slackTeamId = connection.externalAccountId;
        if (!slackTeamId) {
          throw new Error(
            "Connected Slack projection is missing its workspace ID"
          );
        }
        const links = await readSlackUserIdentityLinksForOrganization({
          db: input.identityDb,
          organizationId: input.organizationId,
          slackTeamId,
        });
        const providerAccountEmails = input.resolveProviderAccountEmails
          ? await input.resolveProviderAccountEmails({
              provider: connection.provider,
              providerUserIds: links.map((link) => link.slackUserId),
            })
          : new Map<string, string | null>();
        return await Promise.all(
          links.map(async (link) => ({
            connectedAt: new Date(link.createdAtMs).toISOString(),
            id: await buildMessageChannelIdentityLinkId({
              connectionId: connection.id,
              provider: connection.provider,
              providerUserId: link.slackUserId,
            }),
            openMeldUserId: link.openmeldUserId,
            provider: connection.provider,
            providerAccountEmail:
              providerAccountEmails.get(link.slackUserId) ??
              resolveStoredProviderAccountEmail(
                link.providerUserDisplayName ?? null
              ),
            providerAccountName: link.providerUserDisplayName ?? null,
          }))
        );
      }
      const links = await listRemoteAgentLarkPlatformIdentityLinks({
        connectionId: connection.id,
        db: input.stateDb,
        organizationId: input.organizationId,
        provider: connection.provider,
      });
      const providerAccountEmails = input.resolveProviderAccountEmails
        ? await input.resolveProviderAccountEmails({
            provider: connection.provider,
            providerUserIds: links.map((link) => link.providerUserId),
          })
        : new Map<string, string | null>();
      return await Promise.all(
        links.map(async (link) => ({
          connectedAt: new Date(link.createdAtMs).toISOString(),
          id: await buildMessageChannelIdentityLinkId({
            connectionId: connection.id,
            provider: connection.provider,
            providerUserId: link.providerUserId,
          }),
          openMeldUserId: link.openmeldUserId,
          provider: connection.provider,
          providerAccountEmail:
            providerAccountEmails.get(link.providerUserId) ?? null,
          providerAccountName: link.providerUserDisplayName ?? null,
        }))
      );
    })
  );
  return records.flat().sort((left, right) => {
    const providerComparison =
      providerOrder(left.provider) - providerOrder(right.provider);
    return providerComparison === 0
      ? left.connectedAt.localeCompare(right.connectedAt) ||
          left.id.localeCompare(right.id)
      : providerComparison;
  });
}

function resolveStoredProviderAccountEmail(
  value: string | null
): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return PROVIDER_ACCOUNT_EMAIL_PATTERN.test(normalized) ? normalized : null;
}

export async function findRemoteAgentMessageChannelIdentityLinkTarget(input: {
  connections: readonly MessageChannelConnectionProjection[];
  identityDb: D1Database;
  identityLinkId: string;
  organizationId: string;
  stateDb: D1Database;
}): Promise<MessageChannelIdentityLinkTarget | null> {
  for (const connection of input.connections) {
    if (connection.provider === "slack") {
      const slackTeamId = connection.externalAccountId;
      if (!slackTeamId) {
        throw new Error(
          "Connected Slack projection is missing its workspace ID"
        );
      }
      const links = await readSlackUserIdentityLinksForOrganization({
        db: input.identityDb,
        organizationId: input.organizationId,
        slackTeamId,
      });
      for (const link of links) {
        const id = await buildMessageChannelIdentityLinkId({
          connectionId: connection.id,
          provider: connection.provider,
          providerUserId: link.slackUserId,
        });
        if (id === input.identityLinkId) {
          return {
            id,
            openMeldUserId: link.openmeldUserId,
            provider: "slack",
            providerUserId: link.slackUserId,
            slackTeamId,
          };
        }
      }
      continue;
    }
    const links = await listRemoteAgentLarkPlatformIdentityLinks({
      connectionId: connection.id,
      db: input.stateDb,
      organizationId: input.organizationId,
      provider: connection.provider,
    });
    for (const link of links) {
      const id = await buildMessageChannelIdentityLinkId({
        connectionId: connection.id,
        provider: connection.provider,
        providerUserId: link.providerUserId,
      });
      if (id === input.identityLinkId) {
        return {
          connectionId: connection.id,
          id,
          openMeldUserId: link.openmeldUserId,
          provider: connection.provider,
          providerUserId: link.providerUserId,
        };
      }
    }
  }
  return null;
}

export async function deleteRemoteAgentMessageChannelIdentityLinkTarget(input: {
  audit: MessageChannelIdentityLinkAuditRecord;
  identityDb: D1Database;
  organizationId: string;
  stateDb: D1Database;
  target: MessageChannelIdentityLinkTarget;
}): Promise<void> {
  if (input.target.provider === "slack") {
    const deleted = await disconnectSlackUserIdentityLink({
      audit: input.audit,
      db: input.identityDb,
      openmeldUserId: input.target.openMeldUserId,
      organizationId: input.organizationId,
      slackTeamId: input.target.slackTeamId,
      slackUserId: input.target.providerUserId,
    });
    if (!deleted) {
      throw new Error("Message Channel identity link changed before deletion");
    }
    return;
  }
  const deleted = await disconnectRemoteAgentLarkPlatformIdentityLink({
    audit: input.audit,
    connectionId: input.target.connectionId,
    db: input.stateDb,
    openmeldUserId: input.target.openMeldUserId,
    organizationId: input.organizationId,
    provider: input.target.provider,
    providerUserId: input.target.providerUserId,
  });
  if (!deleted) {
    throw new Error("Message Channel identity link changed before deletion");
  }
}

export async function buildMessageChannelIdentityLinkId(input: {
  connectionId: string;
  provider: MessageChannelConnectionProjection["provider"];
  providerUserId: string;
}): Promise<string> {
  const value = new TextEncoder().encode(
    `${input.provider}\u0000${input.connectionId}\u0000${input.providerUserId}`
  );
  const digest = await crypto.subtle.digest("SHA-256", value);
  return `channel_identity_${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
}

function projectSlackConnection(
  binding: RemoteAgentSlackWorkspaceBindingRecord,
  needsAuthorization: boolean
): MessageChannelConnectionProjection {
  return messageChannelConnectionProjectionSchema.parse({
    externalAccountId: binding.slackTeamId,
    externalAccountName: null,
    grantedCapabilityGroups: [],
    id: `slack:${binding.slackTeamId}`,
    lastVerifiedAt: null,
    permissionBundleVersion: null,
    provider: "slack",
    reasonCode: needsAuthorization
      ? "slack.authorization_update_required"
      : null,
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
    reasonCode:
      connection.failureReasonCode ??
      (requiresLarkPlatformAuthorizationUpdate(connection) === true
        ? `${connection.provider}.authorization_update_required`
        : null),
    status: connection.status,
    transport: connection.transport,
  });
}

function providerOrder(
  provider: MessageChannelConnectionProjection["provider"]
) {
  return messageChannelProviderSchema.options.indexOf(provider);
}
