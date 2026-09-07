import { describe, expect, it, vi } from "vitest";
import capturedSetupScopes from "../../../scripts/lark-platform/fixtures/application-scopes-with-setup.feishu.json";
import {
  configureAndVerifyLarkPlatformWebhookApp,
  LarkPlatformAppConfigurationError,
} from "../src/remote-agent/application/lark-platform-app-configuration";
import { LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE } from "../src/remote-agent/application/lark-platform-permission-bundles";

const EXPECTED_SCOPES = LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.scopes.map(
  (scopeName) => ({
    grant_status: 1,
    scope_name: scopeName,
    scope_type: "tenant",
  })
);

describe("Lark-platform app configuration", () => {
  it("invokes every provider request without an object receiver", async () => {
    const fetchImpl = vi.fn<typeof fetch>(function (
      this: unknown,
      request,
      init
    ) {
      if (this !== undefined) {
        throw new TypeError("Illegal invocation");
      }
      const route = `${init?.method ?? "GET"} ${request.toString()}`;
      switch (route) {
        case "POST https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal":
          return Promise.resolve(
            Response.json({
              code: 0,
              expire: 7200,
              tenant_access_token: "tenant-token",
            })
          );
        case "PATCH https://open.larksuite.com/open-apis/application/v7/applications/cli_test/config":
          return Promise.resolve(
            Response.json({ code: 0, data: {}, msg: "ok" })
          );
        case "GET https://open.larksuite.com/open-apis/application/v6/scopes":
          return Promise.resolve(
            Response.json({
              code: 0,
              data: { scopes: EXPECTED_SCOPES },
              msg: "success",
            })
          );
        case "GET https://open.larksuite.com/open-apis/bot/v3/info":
          return Promise.resolve(
            Response.json({
              bot: {
                app_name: "OpenMeld Center Agent",
                open_id: "ou_bot",
              },
              code: 0,
              msg: "success",
            })
          );
        default:
          throw new Error(`Unexpected provider request: ${route}`);
      }
    });

    await expect(
      configureAndVerifyLarkPlatformWebhookApp({
        appId: "cli_test",
        appSecret: "app-secret",
        connectionId: "connection-1",
        eventEncryptKey: "event-encrypt-key",
        fetchImpl,
        gatewayOrigin: "https://gateway-dev.openmeld.ai",
        provider: "lark",
        verificationToken: "verification-token",
      })
    ).resolves.toMatchObject({
      botOpenId: "ou_bot",
      transport: "webhook",
    });
  });

  it("configures Webhook URLs and verifies the exact channel-only app", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(Response.json({ code: 0, data: {}, msg: "ok" }))
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: { scopes: EXPECTED_SCOPES },
          msg: "success",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          bot: {
            app_name: "OpenMeld Center Agent",
            open_id: "ou_bot",
          },
          code: 0,
          msg: "success",
        })
      );

    await expect(
      configureAndVerifyLarkPlatformWebhookApp({
        appId: "cli_test",
        appSecret: "app-secret",
        connectionId: "connection-1",
        eventEncryptKey: "event-encrypt-key",
        fetchImpl,
        gatewayOrigin: "https://gateway-dev.openmeld.ai",
        provider: "lark",
        verificationToken: "verification-token",
      })
    ).resolves.toEqual({
      botName: "OpenMeld Center Agent",
      botOpenId: "ou_bot",
      grantedCapabilityGroups: ["conversation.text"],
      transport: "webhook",
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://open.larksuite.com/open-apis/application/v7/applications/cli_test/config",
      {
        body: JSON.stringify({
          callback: {
            add_callbacks: ["card.action.trigger"],
            callback_type: "webhook",
            request_url:
              "https://gateway-dev.openmeld.ai/message-channels/lark/connection-1/callbacks",
          },
          event: {
            add_events: [
              "im.chat.member.bot.added_v1",
              "im.chat.member.bot.deleted_v1",
              "im.message.receive_v1",
            ],
            request_url:
              "https://gateway-dev.openmeld.ai/message-channels/lark/connection-1/events",
            subscription_type: "webhook",
          },
          event_and_callback_encrypt_strategy: {
            encryption_key: "event-encrypt-key",
            verification_token: "verification-token",
          },
          scope: {
            add_scopes: EXPECTED_SCOPES.map(({ scope_name: scopeName }) => ({
              scope_name: scopeName,
              token_type: "tenant",
            })),
          },
        }),
        headers: {
          Authorization: "Bearer tenant-token",
          "Content-Type": "application/json; charset=utf-8",
        },
        method: "PATCH",
      }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://open.larksuite.com/open-apis/application/v6/scopes",
      {
        headers: {
          Authorization: "Bearer tenant-token",
        },
        method: "GET",
      }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      "https://open.larksuite.com/open-apis/bot/v3/info",
      {
        headers: {
          Authorization: "Bearer tenant-token",
        },
        method: "GET",
      }
    );
  });

  it("accepts the explicitly granted app-configuration scope alongside Channel scopes", async () => {
    const fetchImpl = configuredAppFetch(
      capturedSetupScopes.data.scopes
    ).mockResolvedValueOnce(
      Response.json({
        bot: { app_name: "OpenMeld Center Agent", open_id: "ou_bot" },
        code: 0,
      })
    );
    await expect(
      configureAndVerifyLarkPlatformWebhookApp({
        appId: "cli_test",
        appSecret: "app-secret",
        connectionId: "connection-1",
        eventEncryptKey: "event-encrypt-key",
        fetchImpl,
        gatewayOrigin: "https://gateway-dev.openmeld.ai",
        provider: "feishu",
        verificationToken: "verification-token",
      })
    ).resolves.toMatchObject({ botOpenId: "ou_bot", transport: "webhook" });
  });

  it("rejects missing, denied, user, or unexpected grants", async () => {
    for (const scopes of [
      EXPECTED_SCOPES.slice(1),
      EXPECTED_SCOPES.map((scope, index) =>
        index === 0 ? { ...scope, grant_status: 2 } : scope
      ),
      EXPECTED_SCOPES.map((scope, index) =>
        index === 0 ? { ...scope, scope_type: "user" } : scope
      ),
      [
        ...EXPECTED_SCOPES,
        {
          grant_status: 1,
          scope_name: "calendar:calendar",
          scope_type: "tenant",
        },
      ],
      [
        ...capturedSetupScopes.data.scopes,
        {
          grant_status: 1,
          scope_name: "calendar:calendar",
          scope_type: "tenant",
        },
      ],
      [
        ...EXPECTED_SCOPES,
        {
          grant_status: 1,
          scope_name: "application:application:patch",
          scope_type: "user",
        },
      ],
    ]) {
      const fetchImpl = configuredAppFetch(scopes);

      await expect(
        configureAndVerifyLarkPlatformWebhookApp({
          appId: "cli_test",
          appSecret: "app-secret",
          connectionId: "connection-1",
          eventEncryptKey: "event-encrypt-key",
          fetchImpl,
          gatewayOrigin: "https://gateway-dev.openmeld.ai",
          provider: "lark",
          verificationToken: "verification-token",
        })
      ).rejects.toMatchObject({
        reasonCode: "lark.permission_bundle_mismatch",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    }
  });

  it("rejects an unsafe callback origin before sending credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      configureAndVerifyLarkPlatformWebhookApp({
        appId: "cli_test",
        appSecret: "app-secret",
        connectionId: "connection-1",
        eventEncryptKey: "event-encrypt-key",
        fetchImpl,
        gatewayOrigin: "http://localhost:8080",
        provider: "lark",
        verificationToken: "verification-token",
      })
    ).rejects.toBeInstanceOf(LarkPlatformAppConfigurationError);
    await expect(
      configureAndVerifyLarkPlatformWebhookApp({
        appId: "cli_test",
        appSecret: "app-secret",
        connectionId: "connection-1",
        eventEncryptKey: "event-encrypt-key",
        fetchImpl,
        gatewayOrigin: "http://localhost:8080",
        provider: "lark",
        verificationToken: "verification-token",
      })
    ).rejects.toMatchObject({
      reasonCode: "lark.callback_origin_invalid",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function configuredAppFetch(scopes: unknown[]) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        code: 0,
        expire: 7200,
        tenant_access_token: "tenant-token",
      })
    )
    .mockResolvedValueOnce(Response.json({ code: 0, data: {}, msg: "ok" }))
    .mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: { scopes },
        msg: "success",
      })
    );
}
