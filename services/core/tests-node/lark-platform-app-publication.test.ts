import type { Client } from "@larksuiteoapi/node-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  configureAndVerifyLarkPlatformPersistentApp,
  publishLarkPlatformApp,
  verifyLarkPlatformPublishedVersion,
} from "../src/remote-agent/application/lark-platform-app-configuration";
import { LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE } from "../src/remote-agent/application/lark-platform-permission-bundles";

// Captured from the official Feishu API explorer with a launcher-created bot.
const published: Awaited<
  ReturnType<Client["application"]["v7"]["applicationPublish"]["create"]>
> = {
  code: 0,
  data: {
    version: "1.0.1",
    version_id: "oav_891317066bc7293f87ece44674050107",
  },
  msg: "success",
};

describe("Lark-platform application publication", () => {
  it("verifies event identifiers rather than localized names in the captured version response", async () => {
    const response = {
      code: 0,
      data: {
        app_version: {
          app_id: "cli_test",
          version_id: "oav_test",
          status: 1,
          events: ["机器人进群", "机器人被移出群", "接收消息"],
          event_infos: [
            {
              event_type: "im.chat.member.bot.added_v1",
              event_name: "机器人进群",
            },
            {
              event_type: "im.chat.member.bot.deleted_v1",
              event_name: "机器人被移出群",
            },
            { event_type: "im.message.receive_v1", event_name: "接收消息" },
          ],
        },
      },
    };
    await expect(
      verifyLarkPlatformPublishedVersion({
        apiHost: "https://open.feishu.cn",
        appId: "cli_test",
        provider: "feishu",
        tenantAccessToken: "test-token",
        versionId: "oav_test",
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(Response.json(response)),
      })
    ).resolves.toBeUndefined();
  });
  it("resumes the saved version without configuring or publishing again", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "test-token",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: {
            scopes: LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.scopes.map(
              (scope_name) => ({
                scope_name,
                grant_status: 1,
                scope_type: "tenant",
              })
            ),
          },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: {
            app_version: {
              app_id: "cli_test",
              version_id: "oav_saved",
              status: 3,
            },
          },
        })
      );
    const onPublicationSubmitted = vi.fn();
    await expect(
      configureAndVerifyLarkPlatformPersistentApp({
        appId: "cli_test",
        appSecret: "test-secret",
        applicationVersionId: "oav_saved",
        migrateWebhook: true,
        provider: "feishu",
        fetchImpl,
        onPublicationSubmitted,
      })
    ).rejects.toMatchObject({
      reasonCode: "feishu.application_publication_pending",
    });
    expect(onPublicationSubmitted).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      "https://open.feishu.cn/open-apis/application/v6/scopes",
      "https://open.feishu.cn/open-apis/application/v6/applications/cli_test/app_versions/oav_saved?lang=en_us",
    ]);
  });
  it.each([
    [0, "application_publication_pending"],
    [2, "application_publication_rejected"],
    [3, "application_publication_pending"],
    [4, "application_publication_pending"],
  ] as const)("does not connect an application with provider status %s", async (status, reason) => {
    const response: Awaited<
      ReturnType<Client["application"]["v6"]["applicationAppVersion"]["get"]>
    > = {
      code: 0,
      data: {
        app_version: { app_id: "cli_test", version_id: "oav_test", status },
      },
    };
    await expect(
      verifyLarkPlatformPublishedVersion({
        apiHost: "https://open.feishu.cn",
        appId: "cli_test",
        provider: "feishu",
        tenantAccessToken: "test-token",
        versionId: "oav_test",
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(Response.json(response)),
      })
    ).rejects.toMatchObject({ reasonCode: `feishu.${reason}` });
  });
  it.each([
    "feishu",
    "lark",
  ] as const)("submits the %s bot configuration and returns the exact version to verify", async (provider) => {
    const apiHost =
      provider === "feishu"
        ? "https://open.feishu.cn"
        : "https://open.larksuite.com";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(published));
    await expect(
      publishLarkPlatformApp({
        apiHost,
        appId: "cli_test",
        fetchImpl,
        provider,
        tenantAccessToken: "test-token",
      })
    ).resolves.toBe(published.data?.version_id);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${apiHost}/open-apis/application/v7/applications/cli_test/publish`,
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      mobile_default_ability: "bot",
      pc_default_ability: "bot",
    });
    // Let the provider choose the next version; retries must not hard-code 1.0.1.
    expect(body).not.toHaveProperty("version");
  });

  it.each([
    { code: 210_302, msg: "under review" },
    { code: 0, data: {} },
  ])("does not treat an unverified publication response as success", async (response) => {
    await expect(
      publishLarkPlatformApp({
        apiHost: "https://open.feishu.cn",
        appId: "cli_test",
        provider: "feishu",
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(Response.json(response)),
        tenantAccessToken: "test-token",
      })
    ).rejects.toMatchObject({
      reasonCode: "feishu.application_publish_failed",
    });
  });
});
