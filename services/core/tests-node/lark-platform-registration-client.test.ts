import { describe, expect, it, vi } from "vitest";
import capturedFeishuBegin from "../../../scripts/lark-platform/fixtures/registration-begin.feishu.json";
import capturedBegin from "../../../scripts/lark-platform/fixtures/registration-begin.lark.json";
import capturedPending from "../../../scripts/lark-platform/fixtures/registration-pending.lark.json";
import capturedSuccess from "../../../scripts/lark-platform/fixtures/registration-success.lark.json";
import {
  beginLarkPlatformRegistration,
  LarkPlatformRegistrationError,
  pollLarkPlatformRegistration,
} from "../src/remote-agent/application/lark-platform-registration-client";

const NOW_MS = Date.parse("2026-07-18T07:30:00.000Z");
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

describe("Lark-platform Personal Agent registration client", () => {
  it.each([
    ["feishu", capturedFeishuBegin, "accounts.feishu.cn", "open.feishu.cn"],
    ["lark", capturedBegin, "accounts.feishu.cn", "open.feishu.cn"],
  ] as const)("preserves the shared issuer URL for %s storage and HTTP compatibility", async (provider, fixture, accountDomain, launcherHost) => {
    const fetchImpl = jsonFetch(fixture);
    const result = await beginLarkPlatformRegistration({
      appDescription: "Development registration",
      appName: "OpenMeld Center Agent",
      expectedProvider: provider,
      fetchImpl,
      nowMs: NOW_MS,
      source: "openmeld-core",
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `https://${accountDomain}/oauth/v1/app/registration`
    );
    expect(result.accountDomain).toBe(accountDomain);
    const url = new URL(result.registrationUrl);
    expect(url.host).toBe(launcherHost);
    expect(url.searchParams.get("user_code")).toBe(fixture.user_code);
  });

  it.each([
    "lark",
    "feishu",
  ] as const)("rejects a different brand before %s credentials are returned", async (provider) => {
    const fetchImpl = jsonFetch(
      {
        error: "authorization_pending",
        user_info: { tenant_brand: provider === "lark" ? "feishu" : "lark" },
      },
      400
    );
    await expect(
      pollLarkPlatformRegistration({
        accountDomain:
          provider === "lark" ? "accounts.larksuite.com" : "accounts.feishu.cn",
        deviceCode: "device-code",
        expectedProvider: provider,
        expiresAtMs: NOW_MS + 60_000,
        fetchImpl,
        nextPollAtMs: NOW_MS,
        nowMs: NOW_MS,
        pollIntervalMs: 5000,
      })
    ).rejects.toMatchObject({
      reasonCode: `${provider}.registration_provider_brand_mismatch`,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://open.larksuite.com/page/launcher?user_code=%3Credacted-user-code%3E",
    "https://open.feishu.cn/page/launcher",
    "https://open.feishu.cn/page/launcher?user_code=other",
  ])("rejects an unrelated or unbound Lark launcher: %s", async (registrationUrl) => {
    await expect(
      beginLarkPlatformRegistration({
        appDescription: "Development registration",
        appName: "OpenMeld Center Agent",
        expectedProvider: "lark",
        fetchImpl: jsonFetch({
          ...capturedBegin,
          verification_uri_complete: registrationUrl,
        }),
        nowMs: NOW_MS,
        source: "openmeld-core",
      })
    ).rejects.toMatchObject({
      reasonCode: "lark.registration_response_invalid",
    });
  });

  it("invokes the provider transport without an object receiver", async () => {
    const fetchImpl = receiverSensitiveJsonFetch(capturedBegin);

    await expect(
      beginLarkPlatformRegistration({
        appDescription:
          "Connect your Center Agent to conversations in your workspace.",
        appName: "OpenMeld Center Agent",
        expectedProvider: "lark",
        fetchImpl,
        nowMs: NOW_MS,
        source: "openmeld-core",
      })
    ).resolves.toMatchObject({
      accountDomain: "accounts.feishu.cn",
      deviceCode: "<redacted-device-code>",
    });
  });

  it("preserves the shared issuer code and launcher options", async () => {
    const fetchImpl = jsonFetch(capturedBegin);

    const result = await beginLarkPlatformRegistration({
      appDescription:
        "Connect your Center Agent to conversations in your workspace.",
      appName: "OpenMeld Center Agent",
      expectedProvider: "lark",
      fetchImpl,
      nowMs: NOW_MS,
      source: "openmeld-core",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] ?? [];
    expect(requestUrl).toBe(
      "https://accounts.feishu.cn/oauth/v1/app/registration"
    );
    const body = new URLSearchParams(String(requestInit?.body));
    expect(body.get("action")).toBe("begin");
    expect(body.get("archetype")).toBe("PersonalAgent");
    expect(body.get("auth_method")).toBe("client_secret");
    expect(body.get("request_user_info")).toBe("open_id");

    const registrationUrl = new URL(result.registrationUrl);
    expect(registrationUrl.host).toBe("open.feishu.cn");
    expect(registrationUrl.searchParams.get("createOnly")).toBe("true");
    expect(registrationUrl.searchParams.get("from")).toBe("sdk");
    expect(registrationUrl.searchParams.get("source")).toBe(
      "node-sdk/openmeld-core"
    );
    expect(registrationUrl.searchParams.get("tp")).toBe("sdk");
    expect(registrationUrl.searchParams.get("addons")).toMatch(
      BASE64_URL_PATTERN
    );
    expect(registrationUrl.searchParams.has("client_secret")).toBe(false);
    expect(result).toMatchObject({
      accountDomain: "accounts.feishu.cn",
      deviceCode: "<redacted-device-code>",
      expiresAtMs: NOW_MS + 3_600_000,
      nextPollAtMs: NOW_MS,
      pollIntervalMs: 5000,
      userCode: "<redacted-user-code>",
    });
  });

  it("performs at most one provider poll and advances a pending attempt", async () => {
    const fetchImpl = jsonFetch(capturedPending, 400);

    await expect(
      pollLarkPlatformRegistration({
        accountDomain: "accounts.larksuite.com",
        deviceCode: "device-code",
        expectedProvider: "lark",
        expiresAtMs: NOW_MS + 60_000,
        fetchImpl,
        nextPollAtMs: NOW_MS,
        nowMs: NOW_MS,
        pollIntervalMs: 5000,
      })
    ).resolves.toEqual({
      accountDomain: "accounts.larksuite.com",
      credential: null,
      detectedBrand: null,
      nextPollAtMs: NOW_MS + 5000,
      pollIntervalMs: 5000,
      status: "authorization_pending",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a cross-provider poll route before sending its device code", async () => {
    const fetchImpl = jsonFetch(capturedPending, 400);
    await expect(
      pollLarkPlatformRegistration({
        accountDomain: "accounts.larksuite.com",
        deviceCode: "device-code",
        expectedProvider: "feishu",
        expiresAtMs: NOW_MS + 60_000,
        fetchImpl,
        nextPollAtMs: NOW_MS,
        nowMs: NOW_MS,
        pollIntervalMs: 5000,
      })
    ).rejects.toMatchObject({
      reasonCode: "feishu.registration_input_invalid",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("moves a confirmed Lark attempt from the shared issuer to Lark polling", async () => {
    const fetchImpl = jsonFetch({ user_info: { tenant_brand: "lark" } });
    await expect(
      pollLarkPlatformRegistration({
        accountDomain: "accounts.feishu.cn",
        deviceCode: "device-code",
        expectedProvider: "lark",
        expiresAtMs: NOW_MS + 60_000,
        fetchImpl,
        nextPollAtMs: NOW_MS,
        nowMs: NOW_MS,
        pollIntervalMs: 5000,
      })
    ).resolves.toMatchObject({
      accountDomain: "accounts.larksuite.com",
      credential: null,
      detectedBrand: "lark",
      status: "domain_switched",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns complete credentials only for the expected provider brand", async () => {
    await expect(
      pollLarkPlatformRegistration({
        accountDomain: "accounts.larksuite.com",
        deviceCode: "device-code",
        expectedProvider: "lark",
        expiresAtMs: NOW_MS + 60_000,
        fetchImpl: jsonFetch(capturedSuccess),
        nextPollAtMs: NOW_MS,
        nowMs: NOW_MS,
        pollIntervalMs: 5000,
      })
    ).resolves.toEqual({
      accountDomain: "accounts.larksuite.com",
      credential: {
        appId: "<redacted-development-app-id>",
        appSecret: "<redacted-development-app-secret>",
        operatorOpenId: "<redacted-operator-open-id>",
        provider: "lark",
      },
      detectedBrand: "lark",
      nextPollAtMs: NOW_MS,
      pollIntervalMs: 5000,
      status: "credentials_received",
    });

    await expect(
      pollLarkPlatformRegistration({
        accountDomain: "accounts.larksuite.com",
        deviceCode: "device-code",
        expectedProvider: "lark",
        expiresAtMs: NOW_MS + 60_000,
        fetchImpl: jsonFetch({
          client_id: "cli_wrong_brand",
          client_secret: "secret",
          user_info: {
            open_id: "ou_operator",
            tenant_brand: "feishu",
          },
        }),
        nextPollAtMs: NOW_MS,
        nowMs: NOW_MS,
        pollIntervalMs: 5000,
      })
    ).rejects.toMatchObject({
      reasonCode: "lark.registration_provider_brand_mismatch",
    });
  });

  it("fails closed before network access for early, expired, or unknown states", async () => {
    const fetchImpl = jsonFetch({ error: "unexpected_provider_state" });

    await expect(
      pollLarkPlatformRegistration({
        accountDomain: "accounts.larksuite.com",
        deviceCode: "device-code",
        expectedProvider: "lark",
        expiresAtMs: NOW_MS + 60_000,
        fetchImpl,
        nextPollAtMs: NOW_MS + 5000,
        nowMs: NOW_MS,
        pollIntervalMs: 5000,
      })
    ).rejects.toMatchObject({
      reasonCode: "lark.registration_poll_not_due",
    });
    await expect(
      pollLarkPlatformRegistration({
        accountDomain: "accounts.larksuite.com",
        deviceCode: "device-code",
        expectedProvider: "lark",
        expiresAtMs: NOW_MS,
        fetchImpl,
        nextPollAtMs: NOW_MS,
        nowMs: NOW_MS,
        pollIntervalMs: 5000,
      })
    ).rejects.toMatchObject({
      reasonCode: "lark.registration_expired",
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      pollLarkPlatformRegistration({
        accountDomain: "accounts.larksuite.com",
        deviceCode: "device-code",
        expectedProvider: "lark",
        expiresAtMs: NOW_MS + 60_000,
        fetchImpl,
        nextPollAtMs: NOW_MS,
        nowMs: NOW_MS,
        pollIntervalMs: 5000,
      })
    ).rejects.toBeInstanceOf(LarkPlatformRegistrationError);
    await expect(
      pollLarkPlatformRegistration({
        accountDomain: "accounts.larksuite.com",
        deviceCode: "device-code",
        expectedProvider: "lark",
        expiresAtMs: NOW_MS + 60_000,
        fetchImpl: jsonFetch({ error: "unexpected_provider_state" }),
        nextPollAtMs: NOW_MS,
        nowMs: NOW_MS,
        pollIntervalMs: 5000,
      })
    ).rejects.toMatchObject({
      reasonCode: "lark.registration_response_unknown",
    });
  });
});

function jsonFetch(payload: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    Response.json(payload, {
      status,
    })
  );
}

function receiverSensitiveJsonFetch(payload: unknown) {
  return vi.fn<typeof fetch>(function (this: unknown) {
    if (this !== undefined) {
      throw new TypeError("Illegal invocation");
    }
    return Promise.resolve(Response.json(payload));
  });
}
