import type { ExecutionRecoveryDestination } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  findExecutionRecoveryPublicationAtOrigin,
  publishExecutionRecoveryToOrigin,
} from "../src/execution-recovery/application/execution-recovery-publication";
import {
  encryptLarkPlatformCredential,
  LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION,
} from "../src/remote-agent/application/lark-platform-credential-crypto";
import type { RemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const CRYPTO_KEY = btoa("0123456789abcdef0123456789abcdef");

describe("execution recovery originating publication", () => {
  it("publishes Slack recovery once in the frozen thread and reconciles by metadata", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          messages: [],
          ok: true,
        })
      )
      .mockResolvedValueOnce(
        Response.json({ channel: "C123", ok: true, ts: "171.002" })
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          messages: [
            {
              metadata: {
                event_payload: { operation_id: "operation-slack-1" },
                event_type: "openmeld_execution_recovery",
              },
              ts: "171.002",
            },
          ],
          ok: true,
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(harness, "slack_workspace_tokens");
    const delivery = {
      conversationKind: "slack",
      slackChannelId: "C123",
      slackTeamId: "T123",
      slackThreadTs: "171.001",
      spaceId: "slack:T123:C123:171.001",
      threadContext: null,
    } as unknown as RemoteAgentNativeDeliveryRecord;
    const destination: ExecutionRecoveryDestination = {
      conversationId: "C123",
      messageId: "171.001",
      spaceId: delivery.spaceId,
      surface: "slack",
    };
    try {
      const first = await publishExecutionRecoveryToOrigin({
        db: harness.db,
        delivery,
        destination,
        env: { SLACK_OPENMELD_BOT_TOKEN: "xoxb-test" } as never,
        operationId: "operation-slack-1",
        text: "Recovered result.",
      });
      const replay = await publishExecutionRecoveryToOrigin({
        db: harness.db,
        delivery,
        destination,
        env: { SLACK_OPENMELD_BOT_TOKEN: "xoxb-test" } as never,
        operationId: "operation-slack-1",
        text: "Recovered result.",
      });

      expect(first).toEqual({
        publicationId: "171.002",
        status: "published",
      });
      expect(replay).toEqual({
        publicationId: "171.002",
        status: "already_published",
      });
      const postCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("chat.postMessage")
      );
      expect(postCalls).toHaveLength(1);
      expect(String(postCalls[0]?.[1]?.body)).toContain(
        "openmeld_execution_recovery"
      );
    } finally {
      vi.unstubAllGlobals();
      harness.close();
    }
  });

  it("reconciles an ambiguous original Slack final publication before sending another message", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        has_more: false,
        messages: [
          {
            metadata: {
              event_payload: { delivery_id: "delivery-slack-original" },
              event_type: "openmeld_remote_agent_final_publication",
            },
            ts: "171.099",
          },
        ],
        ok: true,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(harness, "slack_workspace_tokens");
    const delivery = {
      conversationKind: "slack",
      deliveryId: "delivery-slack-original",
      slackChannelId: "C123",
      slackTeamId: "T123",
      slackThreadTs: "171.001",
      spaceId: "slack:T123:C123:171.001",
      threadContext: null,
    } as unknown as RemoteAgentNativeDeliveryRecord;
    try {
      await expect(
        publishExecutionRecoveryToOrigin({
          db: harness.db,
          delivery,
          destination: {
            conversationId: "C123",
            messageId: "171.001",
            spaceId: delivery.spaceId,
            surface: "slack",
          },
          env: { SLACK_OPENMELD_BOT_TOKEN: "xoxb-test" } as never,
          operationId: "operation-must-not-replace-original-identity",
          reuseOriginalFinalPublicationIdentity: true,
          text: "Retained original result.",
        })
      ).resolves.toEqual({
        publicationId: "171.099",
        status: "already_published",
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        "conversations.replies"
      );
    } finally {
      vi.unstubAllGlobals();
      harness.close();
    }
  });

  it("reads a provider-authoritative Slack publication after an ambiguous recovery attempt without posting again", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        has_more: false,
        messages: [
          {
            metadata: {
              event_payload: { delivery_id: "delivery-slack-ambiguous" },
              event_type: "openmeld_remote_agent_final_publication",
            },
            ts: "171.199",
          },
        ],
        ok: true,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(harness, "slack_workspace_tokens");
    const delivery = {
      conversationKind: "slack",
      deliveryId: "delivery-slack-ambiguous",
      slackChannelId: "C123",
      slackTeamId: "T123",
      slackThreadTs: "171.001",
      spaceId: "slack:T123:C123:171.001",
      threadContext: null,
    } as unknown as RemoteAgentNativeDeliveryRecord;
    try {
      await expect(
        findExecutionRecoveryPublicationAtOrigin({
          db: harness.db,
          delivery,
          destination: {
            conversationId: "C123",
            messageId: "171.001",
            spaceId: delivery.spaceId,
            surface: "slack",
          },
          env: { SLACK_OPENMELD_BOT_TOKEN: "xoxb-test" } as never,
          operationId: "operation-slack-ambiguous",
          reuseOriginalFinalPublicationIdentity: true,
        })
      ).resolves.toBe("171.199");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        "conversations.replies"
      );
    } finally {
      vi.unstubAllGlobals();
      harness.close();
    }
  });

  it("replays a retained Lark result with the original frozen publication UUID and locator", async () => {
    const harness = createSqliteD1Harness();
    applyLarkConnectionMigrations(harness);
    const encryptedAppSecret = await encryptLarkPlatformCredential({
      credential: "app-secret",
      credentialName: "app secret",
      cryptoKey: CRYPTO_KEY,
    });
    seedLarkConnection(harness, encryptedAppSecret);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: { message_id: "om_recovery_result" },
          msg: "success",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const locator = {
      appId: "cli_lark_test",
      chatId: "oc_chat_test",
      connectionId: "connection_lark_test",
      provider: "lark" as const,
      rootMessageId: "om_root_test",
      tenantKey: "tenant_lark_test",
      threadId: "omt_thread_test",
    };
    const delivery = {
      conversationKind: "message_channel",
      messageChannelLocator: locator,
      organizationId: "org_1",
      providerPublicationIdempotencyKey: "e86df165-338e-562b-8e35-b9b29b1c239b",
      slackChannelId: null,
      slackTeamId: null,
      slackThreadTs: null,
      spaceId: "lark:connection_lark_test:oc_chat_test:om_root_test",
      threadContext: null,
    } as unknown as RemoteAgentNativeDeliveryRecord;
    const destination: ExecutionRecoveryDestination = {
      conversationId: locator.chatId,
      messageId: locator.rootMessageId,
      spaceId: delivery.spaceId,
      surface: "lark",
    };
    try {
      await expect(
        publishExecutionRecoveryToOrigin({
          db: harness.db,
          delivery,
          destination,
          env: {
            OPENMELD_LARK_CHANNEL_ENABLED: "true",
            LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY: CRYPTO_KEY,
          } as never,
          operationId: "operation-lark-1",
          reuseOriginalFinalPublicationIdentity: true,
          text: "Recovered result.",
        })
      ).resolves.toEqual({
        publicationId: "om_recovery_result",
        status: "published",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const publishBody = JSON.parse(
        String(fetchMock.mock.calls[1]?.[1]?.body)
      ) as { uuid?: string };
      expect(publishBody.uuid).toBe(delivery.providerPublicationIdempotencyKey);
    } finally {
      vi.unstubAllGlobals();
      harness.close();
    }
  });

  it("rejects a different caller surface before connector I/O", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const harness = createSqliteD1Harness();
    const delivery = {
      conversationKind: "slack",
      slackChannelId: "C123",
      slackTeamId: "T123",
      slackThreadTs: "171.001",
      spaceId: "slack:T123:C123:171.001",
      threadContext: null,
    } as unknown as RemoteAgentNativeDeliveryRecord;
    try {
      await expect(
        publishExecutionRecoveryToOrigin({
          db: harness.db,
          delivery,
          destination: {
            conversationId: "different-channel",
            messageId: "171.001",
            spaceId: delivery.spaceId,
            surface: "slack",
          },
          env: { SLACK_OPENMELD_BOT_TOKEN: "xoxb-test" } as never,
          operationId: "operation-conflict-1",
          text: "Recovered result.",
        })
      ).rejects.toThrow("execution_recovery.destination_mismatch");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      harness.close();
    }
  });
});

function applyLarkConnectionMigrations(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({ sql: "CREATE TABLE users (id TEXT PRIMARY KEY)" });
  harness.run({ sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY)" });
  harness.run({ sql: "INSERT INTO users (id) VALUES ('user_1')" });
  harness.run({ sql: "INSERT INTO organizations (id) VALUES ('org_1')" });
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_lark_platform_channel_connections"
  );
}

function seedLarkConnection(
  harness: ReturnType<typeof createSqliteD1Harness>,
  encryptedAppSecret: string
): void {
  harness.run({
    sql: `
      INSERT INTO openMeldRemoteAgent_lark_platform_channel_connections (
        connection_id, organization_id, provider, app_id, tenant_key,
        bot_open_id, bot_name, transport, status, installed_by_user_id,
        permission_bundle_version, granted_capability_groups_json,
        connection_generation, last_verified_at_ms, failure_reason_code,
        created_at_ms, updated_at_ms
      ) VALUES (
        'connection_lark_test', 'org_1', 'lark', 'cli_lark_test',
        'tenant_lark_test', 'ou_bot_test', 'Center Agent', 'webhook',
        'connected', 'user_1', 'channel-v1', '["messages","cards"]',
        1, 1000, NULL, 1000, 1000
      )
    `,
  });
  harness.run({
    params: [encryptedAppSecret, LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION],
    sql: `
      INSERT INTO openMeldRemoteAgent_lark_platform_channel_credentials (
        connection_id, encrypted_app_secret, encrypted_verification_token,
        encrypted_event_encrypt_key, credential_format_version,
        created_at_ms, updated_at_ms
      ) VALUES (
        'connection_lark_test', ?, NULL, NULL, ?, 1000, 1000
      )
    `,
  });
}
