import { describe, expect, it, vi } from "vitest";
import { listRemoteAgentMessageChannelConnectionProjections } from "../src/remote-agent/application/message-channel-connection-projection";
import type { RemoteAgentLarkPlatformChannelConnectionRecord } from "../src/remote-agent/infrastructure/d1/lark-platform-channel-connection-repo";

describe("Remote Agent Message Channel connection projection", () => {
  it("projects Slack, Lark, and Feishu independently for one Organization", async () => {
    const result = await listRemoteAgentMessageChannelConnectionProjections(
      {
        identityDb: {} as D1Database,
        organizationId: "org_1",
        stateDb: {} as D1Database,
      },
      {
        readSlackToken: vi.fn(async () => null),
        listLarkPlatformConnections: vi.fn(async () => [
          {
            appId: "cli_feishu_1",
            botName: "Center Agent CN",
            botOpenId: "ou_feishu_bot",
            callbacksWebhookVerifiedAtMs: 3000,
            connectionGeneration: 1,
            connectionId: "connection_feishu_1",
            createdAtMs: 1000,
            eventsWebhookVerifiedAtMs: 3000,
            failureReasonCode: "message_channel.permission_partial",
            grantedCapabilityGroups: ["messages", "cards"],
            installedByUserId: "user_owner",
            lastVerifiedAtMs: 3000,
            organizationId: "org_1",
            permissionBundleVersion: "feishu-channel-v1",
            provider: "feishu",
            status: "repair_required",
            tenantKey: "tenant_feishu_1",
            transport: "webhook",
            updatedAtMs: 3000,
          } satisfies RemoteAgentLarkPlatformChannelConnectionRecord,
          {
            appId: "cli_lark_1",
            botName: "Center Agent",
            botOpenId: "ou_lark_bot",
            callbacksWebhookVerifiedAtMs: 4000,
            connectionGeneration: 2,
            connectionId: "connection_lark_1",
            createdAtMs: 1000,
            eventsWebhookVerifiedAtMs: 4000,
            failureReasonCode: null,
            grantedCapabilityGroups: ["messages", "cards", "resources"],
            installedByUserId: "user_owner",
            lastVerifiedAtMs: 4000,
            organizationId: "org_1",
            permissionBundleVersion: "lark-channel-v1",
            provider: "lark",
            status: "connected",
            tenantKey: "tenant_lark_1",
            transport: "webhook",
            updatedAtMs: 4000,
          } satisfies RemoteAgentLarkPlatformChannelConnectionRecord,
        ]),
        readSlackBinding: vi.fn(async () => ({
          createdAtMs: 500,
          organizationId: "org_1",
          slackTeamId: "T123",
          updatedAtMs: 2000,
        })),
      }
    );

    expect(result).toEqual([
      {
        externalAccountId: "T123",
        externalAccountName: null,
        grantedCapabilityGroups: [],
        id: "slack:T123",
        lastVerifiedAt: null,
        permissionBundleVersion: null,
        provider: "slack",
        reasonCode: null,
        status: "connected",
        transport: "webhook",
      },
      {
        externalAccountId: "tenant_lark_1",
        externalAccountName: "Center Agent",
        grantedCapabilityGroups: ["messages", "cards", "resources"],
        id: "connection_lark_1",
        lastVerifiedAt: "1970-01-01T00:00:04.000Z",
        permissionBundleVersion: "lark-channel-v1",
        provider: "lark",
        reasonCode: "lark.authorization_update_required",
        status: "connected",
        transport: "webhook",
      },
      {
        externalAccountId: "tenant_feishu_1",
        externalAccountName: "Center Agent CN",
        grantedCapabilityGroups: ["messages", "cards"],
        id: "connection_feishu_1",
        lastVerifiedAt: "1970-01-01T00:00:03.000Z",
        permissionBundleVersion: "feishu-channel-v1",
        provider: "feishu",
        reasonCode: "message_channel.permission_partial",
        status: "repair_required",
        transport: "webhook",
      },
    ]);
  });

  it("never leaks a connection from another Organization", async () => {
    await expect(
      listRemoteAgentMessageChannelConnectionProjections(
        {
          identityDb: {} as D1Database,
          organizationId: "org_1",
          stateDb: {} as D1Database,
        },
        {
          listLarkPlatformConnections: vi.fn(async () => [
            {
              appId: "cli_wrong_org",
              botName: "Wrong tenant",
              botOpenId: null,
              callbacksWebhookVerifiedAtMs: null,
              connectionGeneration: 1,
              connectionId: "connection_wrong_org",
              createdAtMs: 1000,
              eventsWebhookVerifiedAtMs: null,
              failureReasonCode: null,
              grantedCapabilityGroups: [],
              installedByUserId: "user_other",
              lastVerifiedAtMs: null,
              organizationId: "org_2",
              permissionBundleVersion: "channel-v1",
              provider: "lark",
              status: "connected",
              tenantKey: "tenant_wrong_org",
              transport: "webhook",
              updatedAtMs: 1000,
            } satisfies RemoteAgentLarkPlatformChannelConnectionRecord,
          ]),
          readSlackBinding: vi.fn(async () => null),
          readSlackToken: vi.fn(async () => null),
        }
      )
    ).rejects.toThrow(
      "Message Channel repository returned a connection from another Organization"
    );
  });
});
