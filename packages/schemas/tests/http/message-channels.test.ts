import { describe, expect, it } from "vitest";
import {
  gatewayErrorCodeSchema,
  larkPlatformActiveRegistrationListResponseSchema,
  larkPlatformRegistrationBeginModeSchema,
  larkPlatformRegistrationResponseSchema,
  MESSAGE_CHANNEL_CONNECTION_STATUSES,
  MESSAGE_CHANNEL_ERROR_CODES,
  messageChannelConnectionListResponseSchema,
  messageChannelConnectionProjectionSchema,
  messageChannelIdentityLinkIdSchema,
} from "../../src/index";

describe("Message Channel HTTP contracts", () => {
  const connection = {
    id: "channel_connection_123",
    provider: "lark",
    transport: "webhook",
    status: "connected",
    externalAccountId: "tenant_123",
    externalAccountName: "OpenMeld Labs",
    permissionBundleVersion: "lark-channel-v1",
    grantedCapabilityGroups: ["messages", "cards"],
    lastVerifiedAt: "2026-07-18T08:00:00.000Z",
    reasonCode: null,
  } as const;

  it("keeps the Organization-required refusal stable across Core and Gateway", () => {
    expect(MESSAGE_CHANNEL_ERROR_CODES).toContain(
      "message_channel.organization_required"
    );
    expect(
      gatewayErrorCodeSchema.safeParse("message_channel.organization_required")
        .success
    ).toBe(true);
  });

  it("keeps one canonical public lifecycle status", () => {
    expect(MESSAGE_CHANNEL_CONNECTION_STATUSES).toEqual([
      "pending_registration",
      "credentials_received",
      "configuring",
      "connected",
      "repair_required",
      "revoked",
      "disconnected",
    ]);
    expect(messageChannelConnectionProjectionSchema.parse(connection)).toEqual(
      connection
    );
    expect(
      messageChannelConnectionListResponseSchema.parse({
        organizationId: "org_123",
        availableLarkPlatformProviders: ["lark"],
        connections: [
          connection,
          {
            ...connection,
            id: "slack_connection_123",
            provider: "slack",
            externalAccountId: "T123",
            permissionBundleVersion: null,
          },
        ],
      })
    ).toMatchObject({
      organizationId: "org_123",
      availableLarkPlatformProviders: ["lark"],
      connections: [{ provider: "lark" }, { provider: "slack" }],
    });
  });

  it("keeps one canonical opaque identity-link reference", () => {
    expect(
      messageChannelIdentityLinkIdSchema.safeParse(
        `channel_identity_${"a".repeat(64)}`
      ).success
    ).toBe(true);
    expect(
      messageChannelIdentityLinkIdSchema.safeParse("channel_identity_short")
        .success
    ).toBe(false);
  });

  it("exposes a provider account email separately from its display name", () => {
    const response = messageChannelConnectionListResponseSchema.parse({
      availableLarkPlatformProviders: [],
      connections: [],
      identityLinks: [
        {
          connectedAt: "2026-08-20T00:00:00.000Z",
          id: `channel_identity_${"a".repeat(64)}`,
          openMeldUserId: "user_123",
          provider: "slack",
          providerAccountEmail: "felix@amplift.ai",
          providerAccountName: "Felix Lu",
        },
      ],
      organizationId: "org_123",
    });

    expect(response.identityLinks[0]).toMatchObject({
      providerAccountEmail: "felix@amplift.ai",
      providerAccountName: "Felix Lu",
    });
  });

  it("rejects duplicate lifecycle facts, secrets, raw scopes, and invalid timestamps", () => {
    expect(
      messageChannelConnectionProjectionSchema.safeParse({
        ...connection,
        connected: true,
      }).success
    ).toBe(false);
    expect(
      messageChannelConnectionProjectionSchema.safeParse({
        ...connection,
        appSecret: "secret",
      }).success
    ).toBe(false);
    expect(
      messageChannelConnectionProjectionSchema.safeParse({
        ...connection,
        rawScopes: ["im:message"],
      }).success
    ).toBe(false);
    expect(
      messageChannelConnectionProjectionSchema.safeParse({
        ...connection,
        lastVerifiedAt: "yesterday",
      }).success
    ).toBe(false);
  });

  it("keeps the Personal Agent setup link inside a pending attempt", () => {
    const response = {
      attempt: {
        expiresAt: "2026-07-18T09:00:00.000Z",
        id: "registration_123",
        nextPollAt: "2026-07-18T08:00:05.000Z",
        provider: "lark",
        reasonCode: null,
        registrationUrl:
          "https://open.larksuite.com/page/launcher?user_code=redacted",
        status: "pending_registration",
      },
      connection: null,
      organizationId: "org_123",
    } as const;

    expect(larkPlatformRegistrationResponseSchema.parse(response)).toEqual(
      response
    );
    expect(
      larkPlatformRegistrationResponseSchema.safeParse({
        ...response,
        attempt: {
          ...response.attempt,
          registrationUrl:
            "https://open.feishu.cn/page/launcher?user_code=redacted",
        },
      }).success
    ).toBe(true);
    for (const registrationUrl of [
      "https://open.larksuite.com/page/launcher",
      "https://open.larksuite.com:444/page/launcher?user_code=redacted",
      "https://open.feishu.cn/page/launcher?user_code=a&user_code=b",
      "https://user@open.feishu.cn/page/launcher?user_code=a",
      "https://open.feishu.cn/page/launcher?user_code=a#fragment",
    ]) {
      expect(
        larkPlatformRegistrationResponseSchema.safeParse({
          ...response,
          attempt: { ...response.attempt, registrationUrl },
        }).success
      ).toBe(false);
    }
    expect(
      larkPlatformRegistrationResponseSchema.safeParse({
        ...response,
        attempt: {
          ...response.attempt,
          provider: "feishu",
          registrationUrl:
            "https://open.feishu.cn/page/launcher?user_code=redacted",
        },
      }).success
    ).toBe(true);
    expect(
      larkPlatformRegistrationResponseSchema.safeParse({
        ...response,
        attempt: { ...response.attempt, provider: "feishu" },
      }).success
    ).toBe(false);
    expect(
      larkPlatformRegistrationResponseSchema.safeParse({
        ...response,
        attempt: {
          ...response.attempt,
          registrationUrl: "https://attacker.example/scan",
        },
      }).success
    ).toBe(false);
    expect(
      larkPlatformRegistrationResponseSchema.safeParse({
        ...response,
        attempt: {
          ...response.attempt,
          appSecret: "secret",
        },
      }).success
    ).toBe(false);
  });

  it("lists active setup without exposing its setup URL or credentials", () => {
    const response = {
      organizationId: "org_123",
      registrations: [
        {
          canResume: true,
          expiresAt: "2026-07-18T09:00:00.000Z",
          id: "registration_123",
          nextPollAt: "2026-07-18T08:00:05.000Z",
          provider: "lark",
          reasonCode: null,
          status: "pending_registration",
        },
      ],
    } as const;

    expect(
      larkPlatformActiveRegistrationListResponseSchema.parse(response)
    ).toEqual(response);
    expect(
      larkPlatformActiveRegistrationListResponseSchema.safeParse({
        ...response,
        registrations: [
          {
            ...response.registrations[0],
            registrationUrl: "https://open.feishu.cn/page/launcher?secret=1",
          },
        ],
      }).success
    ).toBe(false);
    expect(
      larkPlatformActiveRegistrationListResponseSchema.safeParse({
        ...response,
        registrations: [
          {
            ...response.registrations[0],
            status: "connected",
          },
        ],
      }).success
    ).toBe(false);
  });

  it("accepts resume, restart, or an explicit existing-app repair", () => {
    expect(larkPlatformRegistrationBeginModeSchema.parse("resume")).toBe(
      "resume"
    );
    expect(larkPlatformRegistrationBeginModeSchema.parse("restart")).toBe(
      "restart"
    );
    expect(larkPlatformRegistrationBeginModeSchema.parse("repair")).toBe(
      "repair"
    );
    expect(
      larkPlatformRegistrationBeginModeSchema.safeParse("replace").success
    ).toBe(false);
  });
});
