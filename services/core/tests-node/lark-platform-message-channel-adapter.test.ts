import type {
  MessageChannelConversationLocator,
  SpaceMessageAttachment,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  encryptLarkPlatformCredential,
  LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION,
} from "../src/remote-agent/application/lark-platform-credential-crypto";
import { createLarkPlatformMessageChannelAdapter } from "../src/remote-agent/application/lark-platform-message-channel-adapter";
import type { RemoteAgentLarkPlatformChannelConnectionRecord } from "../src/remote-agent/infrastructure/d1/lark-platform-channel-connection-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const CRYPTO_KEY = btoa("0123456789abcdef0123456789abcdef");
const CONNECTION: RemoteAgentLarkPlatformChannelConnectionRecord = {
  appId: "cli_lark_test",
  botName: "Center Agent",
  botOpenId: "ou_bot_test",
  callbacksWebhookVerifiedAtMs: 1000,
  connectionGeneration: 1,
  connectionId: "connection_lark_test",
  createdAtMs: 1000,
  eventsWebhookVerifiedAtMs: 1000,
  failureReasonCode: null,
  grantedCapabilityGroups: ["messages", "cards"],
  installedByUserId: "user_1",
  lastVerifiedAtMs: 1000,
  organizationId: "org_1",
  permissionBundleVersion: "channel-v1",
  provider: "lark",
  status: "connected",
  tenantKey: "tenant_lark_test",
  transport: "webhook",
  updatedAtMs: 1000,
};
const LOCATOR: Extract<
  MessageChannelConversationLocator,
  { provider: "lark" }
> = {
  appId: CONNECTION.appId,
  chatId: "oc_chat_test",
  connectionId: CONNECTION.connectionId,
  provider: "lark",
  rootMessageId: "om_root_test",
  tenantKey: CONNECTION.tenantKey,
  threadId: "omt_thread_test",
};

describe("Lark-platform Message Channel adapter", () => {
  it("decrypts the connection credential and publishes through the frozen locator", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    const encryptedAppSecret = await encryptLarkPlatformCredential({
      credential: "app-secret",
      credentialName: "app secret",
      cryptoKey: CRYPTO_KEY,
    });
    seedConnection(harness, encryptedAppSecret);
    const fetchImpl = vi
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
          data: { message_id: "om_published_test" },
          msg: "success",
        })
      );
    const adapter = createLarkPlatformMessageChannelAdapter({
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      fetchImpl,
      provider: "lark",
    });
    try {
      await expect(
        adapter.publishReply({
          attachments: [],
          connection: CONNECTION,
          locator: LOCATOR,
          providerPublicationIdempotencyKey:
            "e86df165-338e-562b-8e35-b9b29b1c239b",
          text: "The launch plan is ready.",
        })
      ).resolves.toEqual({
        resultId: "om_published_test",
        status: "published",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      harness.close();
    }
  });

  it("decrypts the exact connection credential before privately guiding an unlinked user", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    const encryptedAppSecret = await encryptLarkPlatformCredential({
      credential: "app-secret",
      credentialName: "app secret",
      cryptoKey: CRYPTO_KEY,
    });
    seedConnection(harness, encryptedAppSecret);
    const fetchImpl = vi
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
          data: { message_id: "om_identity_link_test" },
          msg: "success",
        })
      );
    const adapter = createLarkPlatformMessageChannelAdapter({
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      fetchImpl,
      provider: "lark",
    });
    try {
      await expect(
        adapter.publishIdentityLinkGuidance({
          connection: CONNECTION,
          linkUrl:
            "https://openmeld.test/link-message-channel?token=messagechannellink_test",
          organizationName: "OpenMeld Labs",
          purpose: "continue_request",
          providerPublicationIdempotencyKey:
            "b784c015-d839-5948-a5db-46fe73d90440",
          providerUserId: "ou_unlinked",
          requestedAction: "Use my personal Computer",
        })
      ).resolves.toEqual({
        resultId: "om_identity_link_test",
        status: "published",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const publicationBody = fetchImpl.mock.calls[1]?.[1]?.body;
      expect(String(publicationBody)).toContain("Use my personal Computer");
      expect(String(publicationBody)).toContain(
        "Connect my account and continue"
      );
    } finally {
      harness.close();
    }
  });

  it("privately gives the exact requester a native computer setup action", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    const encryptedAppSecret = await encryptLarkPlatformCredential({
      credential: "app-secret",
      credentialName: "app secret",
      cryptoKey: CRYPTO_KEY,
    });
    seedConnection(harness, encryptedAppSecret);
    const fetchImpl = vi
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
          data: { message_id: "om_computer_setup_test" },
          msg: "success",
        })
      );
    const adapter = createLarkPlatformMessageChannelAdapter({
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      fetchImpl,
      provider: "lark",
    });
    try {
      await expect(
        adapter.publishPrivateNavigationGuidance({
          action: {
            label: "Connect this computer",
            target: { kind: "computer_setup", mode: "setup" },
            url: "https://openmeld.test/o/acme/connect",
          },
          connection: CONNECTION,
          providerPublicationIdempotencyKey:
            "b784c015-d839-5948-a5db-46fe73d90441",
          providerUserId: "ou_member",
          text: "Connect this computer to OpenMeld to use Codex and other local agents.",
        })
      ).resolves.toEqual({
        resultId: "om_computer_setup_test",
        status: "published",
      });
      const publicationBody = String(fetchImpl.mock.calls[1]?.[1]?.body);
      expect(publicationBody).toContain("ou_member");
      expect(publicationBody).toContain("Connect this computer");
      expect(publicationBody).toContain("https://openmeld.test/o/acme/connect");
    } finally {
      harness.close();
    }
  });

  it("rejects attachments explicitly instead of publishing text without them", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = createLarkPlatformMessageChannelAdapter({
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      fetchImpl,
      provider: "lark",
    });
    const attachment: SpaceMessageAttachment = {
      id: "attachment_1",
      mimeType: "image/png",
      sizeBytes: 1024,
    };
    try {
      await expect(
        adapter.publishReply({
          attachments: [attachment],
          connection: CONNECTION,
          locator: LOCATOR,
          providerPublicationIdempotencyKey:
            "e86df165-338e-562b-8e35-b9b29b1c239b",
          text: "This has an attachment.",
        })
      ).resolves.toEqual({
        reasonCode: "lark.message_reply_attachments_not_supported",
        status: "failed",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("reports credential decryption failures without calling the provider", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    seedConnection(harness, "corrupt-encrypted-app-secret");
    const fetchImpl = vi.fn<typeof fetch>();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const adapter = createLarkPlatformMessageChannelAdapter({
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      fetchImpl,
      provider: "lark",
    });
    try {
      await expect(
        adapter.publishReply({
          attachments: [],
          connection: CONNECTION,
          locator: LOCATOR,
          providerPublicationIdempotencyKey:
            "e86df165-338e-562b-8e35-b9b29b1c239b",
          text: "The launch plan is ready.",
        })
      ).resolves.toEqual({
        reasonCode: "lark.connection_credentials_unavailable",
        status: "failed",
      });
      expect(consoleError).toHaveBeenCalledWith(
        "[core.message_channel.connection_credential_decryption_failed]",
        expect.objectContaining({
          connectionId: CONNECTION.connectionId,
          error: expect.any(String),
          provider: "lark",
        })
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      harness.close();
    }
  });

  it("reads provider-neutral bounded context through the connection credential", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    const encryptedAppSecret = await encryptLarkPlatformCredential({
      credential: "app-secret",
      credentialName: "app secret",
      cryptoKey: CRYPTO_KEY,
    });
    seedConnection(harness, encryptedAppSecret);
    const fetchImpl = vi
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
          data: {
            has_more: false,
            items: [
              {
                body: { content: JSON.stringify({ text: "Earlier message" }) },
                chat_id: LOCATOR.chatId,
                create_time: "1710000000000",
                message_id: "om_earlier",
                msg_type: "text",
                root_id: LOCATOR.rootMessageId,
                sender: {
                  id: "ou_member",
                  sender_name: "Ada",
                  sender_type: "user",
                },
              },
            ],
          },
        })
      );
    const adapter = createLarkPlatformMessageChannelAdapter({
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      fetchImpl,
      provider: "lark",
    });
    try {
      await expect(
        adapter.readChannelContext({
          connection: CONNECTION,
          conversationId: "lark:connection_lark_test:oc_chat_test:om_root_test",
          event: {
            kind: "message",
            locator: LOCATOR,
            mention: "group_mention",
            messageId: "om_current",
            resources: [],
            senderId: "ou_current",
            sentAtMs: 1_710_000_001_000,
            text: "Current request",
          },
        })
      ).resolves.toMatchObject({
        currentMessageId: "om_current",
        messages: [
          {
            id: "om_earlier",
            text: "Earlier message",
          },
        ],
        provider: "lark",
        sync: { status: "complete" },
      });
    } finally {
      harness.close();
    }
  });
});

function applyConnectionMigration(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({ sql: "CREATE TABLE users (id TEXT PRIMARY KEY)" });
  harness.run({ sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY)" });
  harness.run({
    sql: "INSERT INTO users (id) VALUES ('user_1')",
  });
  harness.run({
    sql: "INSERT INTO organizations (id) VALUES ('org_1')",
  });
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_lark_platform_channel_connections"
  );
}

function seedConnection(
  harness: ReturnType<typeof createSqliteD1Harness>,
  encryptedAppSecret: string
): void {
  harness.run({
    sql: `
      INSERT INTO openMeldRemoteAgent_lark_platform_channel_connections (
        connection_id,
        organization_id,
        provider,
        app_id,
        tenant_key,
        bot_open_id,
        bot_name,
        transport,
        status,
        installed_by_user_id,
        permission_bundle_version,
        granted_capability_groups_json,
        connection_generation,
        last_verified_at_ms,
        failure_reason_code,
        created_at_ms,
        updated_at_ms
      ) VALUES (
        'connection_lark_test',
        'org_1',
        'lark',
        'cli_lark_test',
        'tenant_lark_test',
        'ou_bot_test',
        'Center Agent',
        'webhook',
        'connected',
        'user_1',
        'channel-v1',
        '["messages","cards"]',
        1,
        1000,
        NULL,
        1000,
        1000
      )
    `,
  });
  harness.run({
    params: [encryptedAppSecret, LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION],
    sql: `
      INSERT INTO openMeldRemoteAgent_lark_platform_channel_credentials (
        connection_id,
        encrypted_app_secret,
        encrypted_verification_token,
        encrypted_event_encrypt_key,
        credential_format_version,
        created_at_ms,
        updated_at_ms
      ) VALUES (
        'connection_lark_test',
        ?,
        NULL,
        NULL,
        ?,
        1000,
        1000
      )
    `,
  });
}
