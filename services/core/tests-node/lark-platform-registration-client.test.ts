import { describe, expect, it, vi } from "vitest";
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

  it("starts at the provider-derived Feishu account host and builds a channel-only QR URL", async () => {
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
        accountDomain: "accounts.feishu.cn",
        deviceCode: "device-code",
        expectedProvider: "lark",
        expiresAtMs: NOW_MS + 60_000,
        fetchImpl,
        nextPollAtMs: NOW_MS,
        nowMs: NOW_MS,
        pollIntervalMs: 5000,
      })
    ).resolves.toEqual({
      accountDomain: "accounts.feishu.cn",
      credential: null,
      detectedBrand: null,
      nextPollAtMs: NOW_MS + 5000,
      pollIntervalMs: 5000,
      status: "authorization_pending",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("moves a Lark attempt to its brand host without recursively polling", async () => {
    const fetchImpl = jsonFetch({
      user_info: { tenant_brand: "lark" },
    });

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
    ).resolves.toEqual({
      accountDomain: "accounts.larksuite.com",
      credential: null,
      detectedBrand: "lark",
      nextPollAtMs: NOW_MS,
      pollIntervalMs: 5000,
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
        accountDomain: "accounts.feishu.cn",
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
        accountDomain: "accounts.feishu.cn",
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
        accountDomain: "accounts.feishu.cn",
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
        accountDomain: "accounts.feishu.cn",
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
