import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  encodeLarkPlatformRegistrationAddons,
  FEISHU_HISTORY_BUNDLE_VERSION,
  LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE,
  requiresLarkPlatformAuthorizationUpdate,
} from "../src/remote-agent/application/lark-platform-permission-bundles";

describe("Lark-platform permission bundles", () => {
  it.each([
    LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.version,
    FEISHU_HISTORY_BUNDLE_VERSION,
  ])("keeps connected Feishu bots current with either permission choice: %s", (version) => {
    expect(
      requiresLarkPlatformAuthorizationUpdate({
        status: "connected",
        provider: "feishu",
        permissionBundleVersion: version,
        failureReasonCode: null,
      })
    ).toBe(false);
  });
  it("pins the real channel-only grant without business-action permissions", () => {
    expect(LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE).toEqual({
      callbacks: ["card.action.trigger"],
      events: [
        "im.chat.member.bot.added_v1",
        "im.chat.member.bot.deleted_v1",
        "im.message.receive_v1",
      ],
      mode: "channel_only_template",
      preset: false,
      scopes: [
        "cardkit:card:read",
        "cardkit:card:write",
        "im:chat.members:bot_access",
        "im:chat:read",
        "im:message",
        "im:message.group_at_msg:readonly",
        "im:message.p2p_msg:readonly",
        "im:message:readonly",
        "im:message:send_as_bot",
        "im:resource",
      ],
      sdkGitHead: "1711494d0cb848b93472f03fb1e8f5366122bcf7",
      sdkVersion: "1.71.1",
      version: "channel-only-2026-07-18",
    });
  });

  it.each([
    false,
    true,
  ])("requests setup consent with Feishu history permissions: %s", async (history) => {
    const encoded = await encodeLarkPlatformRegistrationAddons(
      LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE,
      history
    );
    const decoded = JSON.parse(
      gunzipSync(Buffer.from(encoded, "base64url")).toString("utf8")
    );

    expect(decoded).toEqual({
      callbacks: { items: ["card.action.trigger"] },
      events: {
        items: {
          tenant: [
            "im.chat.member.bot.added_v1",
            "im.chat.member.bot.deleted_v1",
            "im.message.receive_v1",
          ],
        },
      },
      preset: false,
      scopes: {
        tenant: [
          "cardkit:card:read",
          "cardkit:card:write",
          "im:chat.members:bot_access",
          "im:chat:read",
          "im:message",
          "im:message.group_at_msg:readonly",
          "im:message.p2p_msg:readonly",
          "im:message:readonly",
          "im:message:send_as_bot",
          "im:resource",
          ...(history ? ["im:message.group_msg", "im:chat.members:read"] : []),
          "application:application:patch",
          "application:application:self_manage",
        ],
      },
    });
  });
});
