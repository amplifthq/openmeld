import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeUrl } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  encryptLarkPlatformCredential,
  LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION,
} from "../src/remote-agent/application/lark-platform-credential-crypto";
import { verifyLarkPlatformWebhook as handleWebhook } from "../src/remote-agent/application/lark-platform-webhook-service";
import { readRemoteAgentLarkPlatformChannelConnection } from "../src/remote-agent/infrastructure/d1/lark-platform-channel-connection-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const CRYPTO_KEY = btoa("0123456789abcdef0123456789abcdef");
const ENCRYPT_KEY = "event-encrypt-key";
const VERIFICATION_TOKEN = "verification-token";
const MESSAGE_FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new NodeUrl(
        "./fixtures/lark-platform/im-message-receive-v2.json",
        import.meta.url
      )
    ),
    "utf8"
  )
) as Record<string, unknown>;
const IMAGE_MESSAGE_FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new NodeUrl(
        "./fixtures/lark-platform/im-image-message-receive-v2.json",
        import.meta.url
      )
    ),
    "utf8"
  )
) as Record<string, unknown>;
const CARD_ACTION_FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new NodeUrl(
        "./fixtures/lark-platform/card-action-trigger-v2.json",
        import.meta.url
      )
    ),
    "utf8"
  )
) as Record<string, unknown>;

describe("Lark-platform Webhook verification", () => {
  it.each([
    "unchanged",
    "disconnected",
    "credentials_replaced",
  ] as const)("answers before evidence persistence and fences a %s connection", async (change) => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: ENCRYPT_KEY,
      provider: "feishu",
      status: "configuring",
      verificationToken: VERIFICATION_TOKEN,
    });
    const payload = await encryptWebhookPayload({
      encryptKey: ENCRYPT_KEY,
      payload: {
        type: "url_verification",
        token: VERIFICATION_TOKEN,
        challenge: "deadline-proof",
      },
    });
    const pending: Promise<unknown>[] = [];
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const batch = harness.db.batch.bind(harness.db);
    const blockedWrite = vi
      .spyOn(harness.db, "batch")
      .mockImplementation(async (statements) => {
        await writeGate;
        return batch(statements);
      });
    try {
      await expect(
        handleWebhook({
          db: harness.db,
          env: buildEnv({ feishuEnabled: true }),
          waitUntil: (promise) => {
            pending.push(promise);
          },
          input: {
            connectionId: "connection_feishu_test",
            gatewayRequestId: "gateway_deadline_test",
            headers: { nonce: null, signature: null, timestamp: null },
            provider: "feishu",
            rawBody: JSON.stringify(payload),
            receivedAtMs: 1_710_000_000_100,
            surface: "events",
          },
        })
      ).resolves.toEqual({ challenge: "deadline-proof", status: "challenge" });
      expect(pending).toHaveLength(1);
      expect(blockedWrite).toHaveBeenCalledOnce();
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          db: harness.db,
          connectionId: "connection_feishu_test",
        })
      ).resolves.toMatchObject({
        status: "configuring",
        eventsWebhookVerifiedAtMs: null,
      });
      if (change === "disconnected") {
        await harness.db
          .prepare(
            "UPDATE openMeldRemoteAgent_lark_platform_channel_connections SET status = 'disconnected' WHERE connection_id = ?"
          )
          .bind("connection_feishu_test")
          .run();
      } else if (change === "credentials_replaced") {
        const replacement = await encryptLarkPlatformCredential({
          credentialName: "verification token",
          credential: "replacement-token",
          cryptoKey: CRYPTO_KEY,
        });
        await harness.db
          .prepare(
            "UPDATE openMeldRemoteAgent_lark_platform_channel_credentials SET encrypted_verification_token = ? WHERE connection_id = ?"
          )
          .bind(replacement, "connection_feishu_test")
          .run();
      }
      releaseWrite();
      await Promise.all(pending);
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          db: harness.db,
          connectionId: "connection_feishu_test",
        })
      ).resolves.toMatchObject({
        status: change === "disconnected" ? "disconnected" : "configuring",
        eventsWebhookVerifiedAtMs:
          change === "unchanged" ? 1_710_000_000_100 : null,
      });
    } finally {
      releaseWrite();
      await Promise.all(pending);
      blockedWrite.mockRestore();
      harness.close();
    }
  });
  it("verifies and normalizes an encrypted signed Lark message event", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: ENCRYPT_KEY,
      provider: "lark",
      verificationToken: VERIFICATION_TOKEN,
    });
    const encryptedBody = await encryptWebhookPayload({
      encryptKey: ENCRYPT_KEY,
      payload: MESSAGE_FIXTURE,
    });
    const rawBody = `\n${JSON.stringify(encryptedBody, null, 2)}\n`;
    const timestamp = "1710000000";
    const nonce = "nonce_lark_1";
    const signature = await signWebhookBody({
      body: rawBody,
      encryptKey: ENCRYPT_KEY,
      nonce,
      timestamp,
    });
    try {
      await expect(
        verifyLarkPlatformWebhook({
          db: harness.db,
          env: buildEnv({ larkEnabled: true }),
          input: {
            connectionId: "connection_lark_test",
            gatewayRequestId: "gateway_request_1",
            headers: { nonce, signature, timestamp },
            provider: "lark",
            rawBody,
            receivedAtMs: 1_710_000_000_100,
            surface: "events",
          },
        })
      ).resolves.toEqual({
        envelope: {
          connectionId: "connection_lark_test",
          event: {
            kind: "message",
            locator: {
              appId: "cli_lark_test",
              chatId: "oc_chat_test",
              connectionId: "connection_lark_test",
              provider: "lark",
              rootMessageId: "om_root_test",
              tenantKey: "tenant_lark_test",
              threadId: "omt_thread_test",
            },
            mention: "group_mention",
            messageId: "om_reply_test",
            resources: [],
            senderId: "ou_sender_test",
            senderTenantKey: "tenant_lark_test",
            sentAtMs: 1_710_000_000_000,
            text: "Ship the launch plan.",
          },
          gatewayRequestId: "gateway_request_1",
          kind: "remote_agent_message_channel_event",
          provider: "lark",
          providerEventId: "evt_lark_message_1",
          receivedAtMs: 1_710_000_000_100,
          v: 1,
        },
        status: "enqueue",
      });
    } finally {
      harness.close();
    }
  });

  it("connects only after both Webhook surfaces answer verified URL challenges", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: null,
      provider: "lark",
      status: "configuring",
      verificationToken: VERIFICATION_TOKEN,
    });
    try {
      await expect(
        verifyLarkPlatformWebhook({
          db: harness.db,
          env: buildEnv({ larkEnabled: true }),
          input: {
            connectionId: "connection_lark_test",
            gatewayRequestId: "gateway_challenge_1",
            headers: {
              nonce: null,
              signature: null,
              timestamp: null,
            },
            provider: "lark",
            rawBody: JSON.stringify({
              challenge: "challenge_lark_1",
              token: VERIFICATION_TOKEN,
              type: "url_verification",
            }),
            receivedAtMs: 1_710_000_000_100,
            surface: "events",
          },
        })
      ).resolves.toEqual({
        challenge: "challenge_lark_1",
        status: "challenge",
      });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_lark_test",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        callbacksWebhookVerifiedAtMs: null,
        eventsWebhookVerifiedAtMs: 1_710_000_000_100,
        lastVerifiedAtMs: null,
        status: "configuring",
      });
      await expect(
        verifyLarkPlatformWebhook({
          db: harness.db,
          env: buildEnv({ larkEnabled: true }),
          input: {
            connectionId: "connection_lark_test",
            gatewayRequestId: "gateway_challenge_2",
            headers: {
              nonce: null,
              signature: null,
              timestamp: null,
            },
            provider: "lark",
            rawBody: JSON.stringify({
              challenge: "challenge_lark_2",
              token: VERIFICATION_TOKEN,
              type: "url_verification",
            }),
            receivedAtMs: 1_710_000_000_200,
            surface: "callbacks",
          },
        })
      ).resolves.toEqual({
        challenge: "challenge_lark_2",
        status: "challenge",
      });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_lark_test",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        callbacksWebhookVerifiedAtMs: 1_710_000_000_200,
        eventsWebhookVerifiedAtMs: 1_710_000_000_100,
        lastVerifiedAtMs: 1_710_000_000_200,
        status: "connected",
      });
    } finally {
      harness.close();
    }
  });

  it("keeps setup configuring when only the card callback URL is verified", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: null,
      provider: "lark",
      status: "configuring",
      verificationToken: VERIFICATION_TOKEN,
    });
    try {
      await expect(
        verifyLarkPlatformWebhook({
          db: harness.db,
          env: buildEnv({ larkEnabled: true }),
          input: {
            connectionId: "connection_lark_test",
            gatewayRequestId: "gateway_callback_challenge",
            headers: {
              nonce: null,
              signature: null,
              timestamp: null,
            },
            provider: "lark",
            rawBody: JSON.stringify({
              challenge: "challenge_lark_callback",
              token: VERIFICATION_TOKEN,
              type: "url_verification",
            }),
            receivedAtMs: 1_710_000_000_100,
            surface: "callbacks",
          },
        })
      ).resolves.toEqual({
        challenge: "challenge_lark_callback",
        status: "challenge",
      });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_lark_test",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        callbacksWebhookVerifiedAtMs: 1_710_000_000_100,
        eventsWebhookVerifiedAtMs: null,
        lastVerifiedAtMs: null,
        status: "configuring",
      });
    } finally {
      harness.close();
    }
  });

  it("does not accept message events while Webhook setup is still configuring", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: null,
      provider: "lark",
      status: "configuring",
      verificationToken: VERIFICATION_TOKEN,
    });
    try {
      await expect(
        verifyLarkPlatformWebhook({
          db: harness.db,
          env: buildEnv({ larkEnabled: true }),
          input: {
            connectionId: "connection_lark_test",
            gatewayRequestId: "gateway_message_while_configuring",
            headers: {
              nonce: null,
              signature: null,
              timestamp: null,
            },
            provider: "lark",
            rawBody: JSON.stringify(MESSAGE_FIXTURE),
            receivedAtMs: 1_710_000_000_100,
            surface: "events",
          },
        })
      ).resolves.toEqual({
        reasonCode: "message_channel.connection_unavailable",
        status: "rejected",
      });
    } finally {
      harness.close();
    }
  });

  it.each([
    "feishu",
    "lark",
  ] as const)("admits %s rich posts with verified group mention and preserved line breaks", async (provider) => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: null,
      provider,
      verificationToken: VERIFICATION_TOKEN,
    });
    try {
      const fixture = structuredClone(
        MESSAGE_FIXTURE
      ) as typeof MESSAGE_FIXTURE & {
        header: Record<string, unknown>;
        event: { message: Record<string, unknown> };
      };
      fixture.header.app_id = `cli_${provider}_test`;
      fixture.header.tenant_key = `tenant_${provider}_test`;
      fixture.event.message.message_type = "post";
      // Node structure follows the official received post example.
      fixture.event.message.content = JSON.stringify({
        title: "Review",
        content: [
          [
            { tag: "at", user_id: "@_user_1" },
            { tag: "text", text: "Please inspect" },
          ],
          [
            {
              tag: "code_block",
              language: "Python",
              text: "if ready:\n    run()",
            },
          ],
        ],
      });
      const result = await verifyLarkPlatformWebhook({
        db: harness.db,
        env: buildEnv({ feishuEnabled: true, larkEnabled: true }),
        input: {
          connectionId: `connection_${provider}_test`,
          gatewayRequestId: "rich_post",
          headers: { nonce: null, signature: null, timestamp: null },
          provider,
          rawBody: JSON.stringify(fixture),
          receivedAtMs: 1_710_000_000_100,
          surface: "events",
        },
      });
      expect(result).toMatchObject({
        status: "enqueue",
        envelope: {
          event: {
            kind: "message",
            mention: "group_mention",
            text: expect.stringContaining("if ready:\n    run()"),
          },
        },
      });
    } finally {
      harness.close();
    }
  });

  it("normalizes an official image message into a bounded provider resource reference", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: null,
      provider: "lark",
      verificationToken: VERIFICATION_TOKEN,
    });
    try {
      await expect(
        verifyLarkPlatformWebhook({
          db: harness.db,
          env: buildEnv({ larkEnabled: true }),
          input: {
            connectionId: "connection_lark_test",
            gatewayRequestId: "gateway_image_1",
            headers: {
              nonce: null,
              signature: null,
              timestamp: null,
            },
            provider: "lark",
            rawBody: JSON.stringify(IMAGE_MESSAGE_FIXTURE),
            receivedAtMs: 1_710_000_005_100,
            surface: "events",
          },
        })
      ).resolves.toMatchObject({
        envelope: {
          event: {
            kind: "message",
            locator: {
              chatId: "oc_direct_chat_test",
              rootMessageId: "om_image_test",
            },
            mention: "direct_message",
            messageId: "om_image_test",
            resources: [
              {
                fileKey: "img_v3_test_image_key",
                fileName: null,
                mimeType: null,
                sizeBytes: null,
                type: "image",
              },
            ],
            text: "Please review the attached image.",
          },
          providerEventId: "evt_lark_image_1",
        },
        status: "enqueue",
      });
    } finally {
      harness.close();
    }
  });

  it("routes a non-form button by its callback value without requiring a form name", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: null,
      provider: "lark",
      verificationToken: VERIFICATION_TOKEN,
    });
    try {
      // Card JSON 2.0 ordinary buttons use behaviors[].value; name is form-only.
      const payload = structuredClone(
        CARD_ACTION_FIXTURE
      ) as typeof CARD_ACTION_FIXTURE & { event: Record<string, unknown> };
      payload.event.action = {
        tag: "button",
        value: {
          openmeld_action: "control",
          v: 1,
          action: "stop",
          deliveryId: "delivery",
        },
      };
      const result = await verifyLarkPlatformWebhook({
        db: harness.db,
        env: buildEnv({ larkEnabled: true }),
        input: {
          connectionId: "connection_lark_test",
          gatewayRequestId: "ordinary-button",
          headers: { nonce: null, signature: null, timestamp: null },
          provider: "lark",
          rawBody: JSON.stringify(payload),
          receivedAtMs: 1_710_000_004_100,
          surface: "callbacks",
        },
      });
      expect(result).toMatchObject({
        status: "enqueue",
        envelope: {
          event: {
            actionName: "openmeld.center_agent.control",
            actionValue: JSON.stringify({
              v: 1,
              action: "stop",
              deliveryId: "delivery",
            }),
          },
        },
      });
    } finally {
      harness.close();
    }
  });

  it("preserves a maximum-length form reply when JSON escaping expands it", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: null,
      provider: "lark",
      verificationToken: VERIFICATION_TOKEN,
    });
    try {
      const text = '"'.repeat(1000);
      const payload = structuredClone(
        CARD_ACTION_FIXTURE
      ) as typeof CARD_ACTION_FIXTURE & { event: Record<string, unknown> };
      payload.event.action = {
        tag: "button",
        name: "openmeld.center_agent.control",
        value: { v: 1, action: "reply", deliveryId: "delivery" },
        form_value: { follow_up: text },
      };
      const result = await verifyLarkPlatformWebhook({
        db: harness.db,
        env: buildEnv({ larkEnabled: true }),
        input: {
          connectionId: "connection_lark_test",
          gatewayRequestId: "escaped-form",
          headers: { nonce: null, signature: null, timestamp: null },
          provider: "lark",
          rawBody: JSON.stringify(payload),
          receivedAtMs: 1_710_000_004_100,
          surface: "callbacks",
        },
      });
      expect(result).toMatchObject({
        status: "enqueue",
        envelope: {
          event: {
            actionName: "openmeld.center_agent.control",
            actionValue: JSON.stringify({
              v: 1,
              action: "reply",
              deliveryId: "delivery",
              text,
            }),
          },
        },
      });
    } finally {
      harness.close();
    }
  });

  it("verifies and normalizes a supported card action callback", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: null,
      provider: "lark",
      verificationToken: VERIFICATION_TOKEN,
    });
    try {
      await expect(
        verifyLarkPlatformWebhook({
          db: harness.db,
          env: buildEnv({ larkEnabled: true }),
          input: {
            connectionId: "connection_lark_test",
            gatewayRequestId: "gateway_card_action_1",
            headers: {
              nonce: null,
              signature: null,
              timestamp: null,
            },
            provider: "lark",
            rawBody: JSON.stringify(CARD_ACTION_FIXTURE),
            receivedAtMs: 1_710_000_004_100,
            surface: "callbacks",
          },
        })
      ).resolves.toEqual({
        envelope: {
          connectionId: "connection_lark_test",
          event: {
            actionId: "evt_lark_card_action_1",
            actionName: "openmeld.center_agent.submit",
            actionValue: "Continue with the launch plan.",
            kind: "card_action",
            locator: {
              appId: "cli_lark_test",
              chatId: "oc_chat_test",
              connectionId: "connection_lark_test",
              provider: "lark",
              rootMessageId: "om_card_test",
              tenantKey: "tenant_lark_test",
              threadId: null,
            },
            occurredAtMs: 1_710_000_004_000,
            senderId: "ou_sender_test",
          },
          gatewayRequestId: "gateway_card_action_1",
          kind: "remote_agent_message_channel_event",
          provider: "lark",
          providerEventId: "evt_lark_card_action_1",
          receivedAtMs: 1_710_000_004_100,
          v: 1,
        },
        status: "enqueue",
      });
    } finally {
      harness.close();
    }
  });

  it.each([
    "feishu",
    "lark",
  ] as const)("accepts %s encrypted URL challenges without signature headers", async (provider) => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: ENCRYPT_KEY,
      provider,
      status: "configuring",
      verificationToken: VERIFICATION_TOKEN,
    });
    try {
      for (const surface of ["events", "callbacks"] as const) {
        const encrypted = await encryptWebhookPayload({
          encryptKey: ENCRYPT_KEY,
          payload: {
            challenge: "provider_challenge",
            token: VERIFICATION_TOKEN,
            type: "url_verification",
          },
        });
        await expect(
          verifyLarkPlatformWebhook({
            db: harness.db,
            env: buildEnv({ feishuEnabled: true, larkEnabled: true }),
            input: {
              connectionId: `connection_${provider}_test`,
              gatewayRequestId: `challenge_${surface}`,
              headers: { nonce: null, signature: null, timestamp: null },
              provider,
              rawBody: JSON.stringify(encrypted),
              receivedAtMs: 1_710_000_000_100,
              surface,
            },
          })
        ).resolves.toEqual({
          challenge: "provider_challenge",
          status: "challenge",
        });
      }
    } finally {
      harness.close();
    }
  });

  it.each([
    "wrong-token",
    "ordinary-event",
    "partial-signature",
  ])("rejects an unsigned encrypted %s without recording reachability", async (scenario) => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: ENCRYPT_KEY,
      provider: "feishu",
      status: "configuring",
      verificationToken: VERIFICATION_TOKEN,
    });
    try {
      const encrypted = await encryptWebhookPayload({
        encryptKey: ENCRYPT_KEY,
        payload:
          scenario === "ordinary-event"
            ? MESSAGE_FIXTURE
            : {
                challenge: "provider_challenge",
                token:
                  scenario === "wrong-token" ? "wrong" : VERIFICATION_TOKEN,
                type: "url_verification",
              },
      });
      await expect(
        verifyLarkPlatformWebhook({
          db: harness.db,
          env: buildEnv({ feishuEnabled: true }),
          input: {
            connectionId: "connection_feishu_test",
            gatewayRequestId: "rejected_challenge",
            headers: {
              nonce: null,
              signature:
                scenario === "partial-signature" ? "0".repeat(64) : null,
              timestamp: null,
            },
            provider: "feishu",
            rawBody: JSON.stringify(encrypted),
            receivedAtMs: 1_710_000_000_100,
            surface: "events",
          },
        })
      ).resolves.toMatchObject({ status: "rejected" });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_feishu_test",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        eventsWebhookVerifiedAtMs: null,
        callbacksWebhookVerifiedAtMs: null,
        status: "configuring",
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a bad signature before decrypting or normalizing", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: ENCRYPT_KEY,
      provider: "lark",
      verificationToken: VERIFICATION_TOKEN,
    });
    const encryptedBody = await encryptWebhookPayload({
      encryptKey: ENCRYPT_KEY,
      payload: MESSAGE_FIXTURE,
    });
    try {
      await expect(
        verifyLarkPlatformWebhook({
          db: harness.db,
          env: buildEnv({ larkEnabled: true }),
          input: {
            connectionId: "connection_lark_test",
            gatewayRequestId: "gateway_bad_signature",
            headers: {
              nonce: "nonce_lark_1",
              signature: "0".repeat(64),
              timestamp: "1710000000",
            },
            provider: "lark",
            rawBody: JSON.stringify(encryptedBody),
            receivedAtMs: 1_710_000_000_100,
            surface: "events",
          },
        })
      ).resolves.toEqual({
        reasonCode: "message_channel.webhook_signature_invalid",
        status: "rejected",
      });
    } finally {
      harness.close();
    }
  });

  it("keeps each provider behind its independent feature gate", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: null,
      provider: "feishu",
      verificationToken: VERIFICATION_TOKEN,
    });
    try {
      await expect(
        verifyLarkPlatformWebhook({
          db: harness.db,
          env: buildEnv({ feishuEnabled: false }),
          input: {
            connectionId: "connection_feishu_test",
            gatewayRequestId: "gateway_feishu_disabled",
            headers: {
              nonce: null,
              signature: null,
              timestamp: null,
            },
            provider: "feishu",
            rawBody: JSON.stringify({
              challenge: "challenge_feishu_1",
              token: VERIFICATION_TOKEN,
              type: "url_verification",
            }),
            receivedAtMs: 1_710_000_000_100,
            surface: "events",
          },
        })
      ).resolves.toEqual({
        reasonCode: "message_channel.provider_disabled",
        status: "rejected",
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a globally enabled provider outside the connection Organization allowlist", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: null,
      provider: "lark",
      verificationToken: VERIFICATION_TOKEN,
    });
    try {
      await expect(
        verifyLarkPlatformWebhook({
          db: harness.db,
          env: buildEnv({
            larkEnabled: true,
            larkOrganizationIds: "org_pilot",
          }),
          input: {
            connectionId: "connection_lark_test",
            gatewayRequestId: "gateway_lark_outside_pilot",
            headers: {
              nonce: null,
              signature: null,
              timestamp: null,
            },
            provider: "lark",
            rawBody: JSON.stringify({
              challenge: "challenge_lark_1",
              token: VERIFICATION_TOKEN,
              type: "url_verification",
            }),
            receivedAtMs: 1_710_000_000_100,
            surface: "events",
          },
        })
      ).resolves.toEqual({
        reasonCode: "message_channel.provider_disabled",
        status: "rejected",
      });
    } finally {
      harness.close();
    }
  });

  it("reports stored webhook credential decryption failures explicitly", async () => {
    const harness = createSqliteD1Harness();
    applyConnectionMigration(harness);
    await seedConnection(harness, {
      encryptKey: null,
      provider: "lark",
      verificationToken: VERIFICATION_TOKEN,
    });
    harness.run({
      sql: `
        UPDATE openMeldRemoteAgent_lark_platform_channel_credentials
        SET encrypted_verification_token = 'corrupt-verification-token'
        WHERE connection_id = 'connection_lark_test'
      `,
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(
        verifyLarkPlatformWebhook({
          db: harness.db,
          env: buildEnv({ larkEnabled: true }),
          input: {
            connectionId: "connection_lark_test",
            gatewayRequestId: "gateway_corrupt_credentials",
            headers: {
              nonce: null,
              signature: null,
              timestamp: null,
            },
            provider: "lark",
            rawBody: JSON.stringify({
              challenge: "challenge_lark_1",
              token: VERIFICATION_TOKEN,
              type: "url_verification",
            }),
            receivedAtMs: 1_710_000_000_100,
            surface: "events",
          },
        })
      ).resolves.toEqual({
        reasonCode: "message_channel.webhook_credential_decryption_failed",
        status: "rejected",
      });
      expect(consoleError).toHaveBeenCalledWith(
        "[core.message_channel.webhook_credential_decryption_failed]",
        expect.objectContaining({
          connectionId: "connection_lark_test",
          error: expect.any(String),
        })
      );
    } finally {
      consoleError.mockRestore();
      harness.close();
    }
  });
});

async function verifyLarkPlatformWebhook(
  input: Omit<Parameters<typeof handleWebhook>[0], "waitUntil">
) {
  const pending: Promise<unknown>[] = [];
  const result = await handleWebhook({
    ...input,
    waitUntil: (promise) => {
      pending.push(promise);
    },
  });
  await Promise.all(pending);
  return result;
}

function buildEnv(input: {
  feishuEnabled?: boolean;
  feishuOrganizationIds?: string;
  larkEnabled?: boolean;
  larkOrganizationIds?: string;
}): CoreBindings {
  return {
    OPENMELD_FEISHU_CHANNEL_ENABLED: String(input.feishuEnabled ?? false),
    OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS:
      input.feishuOrganizationIds ?? "org_1",
    OPENMELD_LARK_CHANNEL_ENABLED: String(input.larkEnabled ?? false),
    OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS:
      input.larkOrganizationIds ?? "org_1",
    LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY: CRYPTO_KEY,
    OPENMELD_SPACES: {} as CoreBindings["OPENMELD_SPACES"],
  };
}

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
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_lark_platform_registration_attempts"
  );
}

async function seedConnection(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    encryptKey: string | null;
    provider: "feishu" | "lark";
    status?: "configuring" | "connected";
    verificationToken: string;
  }
): Promise<void> {
  const connectionId = `connection_${input.provider}_test`;
  const appId = `cli_${input.provider}_test`;
  const tenantKey = `tenant_${input.provider}_test`;
  const encryptedAppSecret = await encryptLarkPlatformCredential({
    credential: "app-secret",
    credentialName: "app secret",
    cryptoKey: CRYPTO_KEY,
  });
  const encryptedVerificationToken = await encryptLarkPlatformCredential({
    credential: input.verificationToken,
    credentialName: "verification token",
    cryptoKey: CRYPTO_KEY,
  });
  const encryptedEventEncryptKey = input.encryptKey
    ? await encryptLarkPlatformCredential({
        credential: input.encryptKey,
        credentialName: "event encrypt key",
        cryptoKey: CRYPTO_KEY,
      })
    : null;
  harness.run({
    params: [
      connectionId,
      input.provider,
      appId,
      tenantKey,
      input.status ?? "connected",
      input.status === "configuring" ? null : 1000,
    ],
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
        ?,
        'org_1',
        ?,
        ?,
        ?,
        'ou_bot_test',
        'Center Agent',
        'webhook',
        ?,
        'user_1',
        'channel-v1',
        '["messages","cards"]',
        1,
        ?,
        NULL,
        1000,
        1000
      )
    `,
  });
  harness.run({
    params: [
      connectionId,
      encryptedAppSecret,
      encryptedVerificationToken,
      encryptedEventEncryptKey,
      LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION,
    ],
    sql: `
      INSERT INTO openMeldRemoteAgent_lark_platform_channel_credentials (
        connection_id,
        encrypted_app_secret,
        encrypted_verification_token,
        encrypted_event_encrypt_key,
        credential_format_version,
        created_at_ms,
        updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, 1000, 1000)
    `,
  });
  if (input.status === "configuring") {
    harness.run({
      params: [
        `attempt_${input.provider}_test`,
        input.provider,
        input.provider,
        connectionId,
      ],
      sql: `
        INSERT INTO openMeldRemoteAgent_lark_platform_registration_attempts (
          attempt_id,
          organization_id,
          initiated_by_user_id,
          initiated_by_profile_id,
          provider,
          encrypted_device_code,
          encrypted_registration_url,
          account_domain,
          detected_brand,
          connection_id,
          poll_interval_ms,
          next_poll_at_ms,
          expires_at_ms,
          poll_claim_id,
          poll_claim_expires_at_ms,
          permission_mode,
          permission_bundle_version,
          return_path,
          status,
          failure_reason_code,
          consumed_at_ms,
          created_at_ms,
          updated_at_ms
        ) VALUES (
          ?,
          'org_1',
          'user_1',
          'profile_1',
          ?,
          'encrypted-device-code',
          'encrypted-registration-url',
          'https://accounts.example.test',
          ?,
          ?,
          1000,
          2000,
          1800000000000,
          NULL,
          NULL,
          'channel_only_template',
          'channel-v1',
          '/center-agent/channels',
          'configuring',
          NULL,
          NULL,
          1000,
          1000
        )
      `,
    });
  }
}

async function encryptWebhookPayload(input: {
  encryptKey: string;
  payload: Record<string, unknown>;
}): Promise<{ encrypt: string }> {
  const keyBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input.encryptKey)
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );
  const iv = new TextEncoder().encode("0123456789abcdef");
  const ciphertext = await crypto.subtle.encrypt(
    { iv, name: "AES-CBC" },
    key,
    new TextEncoder().encode(JSON.stringify(input.payload))
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return {
    encrypt: btoa(String.fromCharCode(...combined)),
  };
}

async function signWebhookBody(input: {
  body: string;
  encryptKey: string;
  nonce: string;
  timestamp: string;
}): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${input.timestamp}${input.nonce}${input.encryptKey}${input.body}`
    )
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
