import type { Client } from "@larksuiteoapi/node-sdk";
import { describe, expect, it, vi } from "vitest";
import capturedScopes from "../../../scripts/lark-platform/fixtures/application-scopes-with-setup.feishu.json";
import { configureAndVerifyLarkPlatformPersistentApp as configureApp } from "../src/remote-agent/application/lark-platform-app-configuration";
import { LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE as bundle } from "../src/remote-agent/application/lark-platform-permission-bundles";

const scopes = bundle.scopes.map((scope_name) => ({
  scope_name,
  grant_status: 1,
  scope_type: "tenant",
}));
const token = { code: 0, expire: 7200, tenant_access_token: "test-token" };
const bot = { code: 0, bot: { open_id: "ou_bot", app_name: "Test bot" } };
const input = {
  appId: "cli_test",
  appSecret: "test-secret",
  provider: "feishu",
  migrateWebhook: false,
  applicationVersionId: null,
  onPublicationSubmitted: () => Promise.resolve(),
} as const;

describe("Lark-platform persistent app configuration", () => {
  it.each([
    "lark",
    "feishu",
  ] as const)("uses the official %s launcher's configuration without patching or publishing again", async (provider) => {
    const fetchImpl = vi.fn<typeof fetch>(function (this: unknown, resource) {
      expect(this).toBeUndefined();
      const url = String(resource);
      if (url.endsWith("/tenant_access_token/internal")) {
        return Promise.resolve(Response.json(token));
      }
      if (url.endsWith("/scopes")) {
        return Promise.resolve(Response.json({ code: 0, data: { scopes } }));
      }
      if (url.endsWith("/bot/v3/info")) {
        return Promise.resolve(Response.json(bot));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    await expect(
      configureApp({ ...input, provider, fetchImpl })
    ).resolves.toEqual({
      botName: "Test bot",
      botOpenId: "ou_bot",
      grantedCapabilityGroups: ["conversation.text"],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(
      fetchImpl.mock.calls.every(([url]) =>
        String(url).startsWith(
          provider === "feishu"
            ? "https://open.feishu.cn/"
            : "https://open.larksuite.com/"
        )
      )
    ).toBe(true);
  });

  it("accepts captured setup grants without granting app-management tools to the agent", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(token))
      .mockResolvedValueOnce(Response.json(capturedScopes))
      .mockResolvedValueOnce(Response.json(bot));
    await expect(configureApp({ ...input, fetchImpl })).resolves.toMatchObject({
      grantedCapabilityGroups: ["conversation.text"],
    });
  });

  it.each([
    { scopes: scopes.slice(1) },
    { scopes: [{ ...scopes[0], grant_status: 0 }, ...scopes.slice(1)] },
    { scopes: [{ ...scopes[0], scope_type: "user" }, ...scopes.slice(1)] },
    {
      scopes: [
        ...scopes,
        { scope_name: "drive:drive", grant_status: 1, scope_type: "tenant" },
      ],
    },
  ])("rejects missing, denied, user, and unexpected permission grants", async (data) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(token))
      .mockResolvedValueOnce(Response.json({ code: 0, data }));
    await expect(configureApp({ ...input, fetchImpl })).rejects.toMatchObject({
      reasonCode: "feishu.permission_bundle_mismatch",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("migrates explicitly repaired Webhook apps to persistent events and card callbacks", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(token))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { scopes } }))
      .mockResolvedValueOnce(Response.json({ code: 0 }))
      .mockResolvedValueOnce(
        Response.json({ code: 0, data: { version_id: "oav_test" } })
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: {
            app_version: {
              app_id: "cli_test",
              version_id: "oav_test",
              status: 1,
              event_infos: bundle.events.map((event_type) => ({ event_type })),
            },
          },
        })
      )
      .mockResolvedValueOnce(Response.json(bot));
    const onPublicationSubmitted = vi.fn();
    await configureApp({
      ...input,
      fetchImpl,
      migrateWebhook: true,
      onPublicationSubmitted,
    });
    const patch: NonNullable<
      Parameters<Client["application"]["v7"]["applicationConfig"]["patch"]>[0]
    >["data"] = JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body));
    expect(patch).toEqual({
      event: { subscription_type: "websocket", add_events: [...bundle.events] },
      callback: {
        callback_type: "websocket",
        add_callbacks: [...bundle.callbacks],
      },
    });
    expect(onPublicationSubmitted).toHaveBeenCalledWith("oav_test");
  });

  it.each([
    200, 403,
  ])("preserves missing migration permission on HTTP %s", async (status) => {
    const denial: Awaited<
      ReturnType<Client["application"]["v7"]["applicationConfig"]["patch"]>
    > = { code: 99_991_672 };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(token))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { scopes } }))
      .mockResolvedValueOnce(Response.json(denial, { status }));
    await expect(
      configureApp({ ...input, fetchImpl, migrateWebhook: true })
    ).rejects.toMatchObject({
      reasonCode: "feishu.application_config_permission_required",
    });
  });
});
