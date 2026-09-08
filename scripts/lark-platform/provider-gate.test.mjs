import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

const UNEXPECTED_POLL_HOST_PATTERN = /Unexpected registration poll host/u;

import capturedBegin from "./fixtures/registration-begin.lark.json" with {
  type: "json",
};
import capturedPending from "./fixtures/registration-pending.lark.json" with {
  type: "json",
};
import capturedSuccess from "./fixtures/registration-success.lark.json" with {
  type: "json",
};
import {
  assertSafeDevelopmentTarget,
  beginRegistration,
  buildRegistrationUrl,
  CHANNEL_ONLY_PERMISSION_BUNDLE,
  encodeRegistrationAddons,
  pollRegistration,
} from "./provider-gate.mjs";

const NOW_MS = Date.parse("2026-07-18T07:30:00.000Z");
const ACCESS_DENIED_PATTERN = /access_denied: Denied/u;
const DEVELOPMENT_PATTERN = /development/u;
const EXPIRED_TOKEN_PATTERN = /expired_token/u;
const NOT_DUE_PATTERN = /registration_poll_not_due/u;
const PRODUCTION_APP_ID_PATTERN = /production App ID/u;
const PRODUCTION_CALLBACK_PATTERN = /production callback host/u;
const PROVIDER_MISMATCH_PATTERN = /expected lark but received feishu/u;
const PUBLIC_CALLBACK_PATTERN = /public HTTPS callback host/u;
const UNKNOWN_PROVIDER_STATE_PATTERN = /unexpected_provider_state/u;

test("keeps the channel-only permission bundle free of business actions", () => {
  assert.deepEqual(CHANNEL_ONLY_PERMISSION_BUNDLE, {
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

test("encodes the exact one-click registration add-ons contract", () => {
  const encoded = encodeRegistrationAddons(CHANNEL_ONLY_PERMISSION_BUNDLE);
  const decoded = JSON.parse(
    gunzipSync(Buffer.from(encoded, "base64url")).toString("utf8")
  );

  assert.deepEqual(decoded, {
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
      ],
    },
  });
});

test("starts resumable registration at the shared issuer", async () => {
  const requests = [];
  const result = await beginRegistration({
    expectedProvider: "lark",
    fetchImpl: createJsonFetch(capturedBegin, requests),
    nowMs: NOW_MS,
  });

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://accounts.feishu.cn/oauth/v1/app/registration"
  );
  assert.equal(requests[0].body.get("action"), "begin");
  assert.equal(requests[0].body.get("archetype"), "PersonalAgent");
  assert.deepEqual(result.state, {
    deviceCode: "<redacted-device-code>",
    expectedProvider: "lark",
    expiresAtMs: NOW_MS + 3_600_000,
    intervalSeconds: 5,
    nextPollAtMs: NOW_MS,
    pollHost: "accounts.feishu.cn",
    status: "pending_registration",
  });
  assert.equal(result.userCode, "<redacted-user-code>");
});

test("builds a development update URL without embedding credentials", () => {
  const url = new URL(
    buildRegistrationUrl({
      appDescription: "Development-only OpenMeld channel probe.",
      appId: "cli_development",
      appName: "OpenMeld Center Agent Dev",
      beginResponse: capturedBegin,
      provider: "lark",
      source: "openmeld-gate-0",
    })
  );

  assert.equal(url.host, "open.larksuite.com");
  assert.equal(url.searchParams.get("clientID"), "cli_development");
  assert.equal(url.searchParams.get("name"), "OpenMeld Center Agent Dev");
  assert.equal(url.searchParams.get("from"), "sdk");
  assert.equal(url.searchParams.get("tp"), "sdk");
  assert.ok(url.searchParams.get("addons"));
  assert.equal(url.searchParams.has("client_secret"), false);
});

test("reports invalid verification details without exposing user codes", () => {
  for (const uri of [
    "https://open.feishu.cn/wrong-path?user_code=do-not-log",
    "https://open.feishu.cn/page/launcher?user_code=do-not-log",
    "https://open.feishu.cn/page/launcher",
  ]) {
    assert.throws(
      () =>
        buildRegistrationUrl({
          provider: "lark",
          beginResponse: { ...capturedBegin, verification_uri_complete: uri },
        }),
      { message: "Unexpected registration verification details." }
    );
  }
});

test("performs only one pending platform poll per invocation", async () => {
  const requests = [];
  const result = await pollRegistration({
    fetchImpl: createJsonFetch(capturedPending, requests, 400),
    nowMs: NOW_MS,
    state: pendingState(),
  });

  assert.equal(requests.length, 1);
  assert.equal(result.status, "authorization_pending");
  assert.equal(result.state.nextPollAtMs, NOW_MS + 5000);
  assert.equal(result.credential, null);
});

test("rejects a cross-provider route before polling", async () => {
  const requests = [];
  await assert.rejects(
    pollRegistration({
      fetchImpl: createJsonFetch(capturedPending, requests, 400),
      nowMs: NOW_MS,
      state: {
        ...pendingState(),
        expectedProvider: "feishu",
        pollHost: "accounts.larksuite.com",
      },
    }),
    UNEXPECTED_POLL_HOST_PATTERN
  );
  assert.equal(requests.length, 0);
});

test("moves only the selected Lark registration to Lark polling", async () => {
  const requests = [];
  const result = await pollRegistration({
    fetchImpl: createJsonFetch(
      { user_info: { tenant_brand: "lark" } },
      requests
    ),
    nowMs: NOW_MS,
    state: { ...pendingState(), pollHost: "accounts.feishu.cn" },
  });
  assert.equal(result.status, "domain_switched");
  assert.equal(result.state.expectedProvider, "lark");
  assert.equal(result.state.pollHost, "accounts.larksuite.com");
  assert.equal(result.credential, null);
  assert.equal(requests.length, 1);

  await assert.rejects(
    pollRegistration({
      fetchImpl: createJsonFetch({ user_info: { tenant_brand: "feishu" } }, []),
      nowMs: NOW_MS,
      state: { ...pendingState(), pollHost: "accounts.feishu.cn" },
    }),
    PROVIDER_MISMATCH_PATTERN
  );
});

test("honors slow_down and terminal provider failures", async () => {
  const slowDown = await pollRegistration({
    fetchImpl: createJsonFetch({ error: "slow_down" }, []),
    nowMs: NOW_MS,
    state: pendingState(),
  });
  assert.equal(slowDown.state.intervalSeconds, 10);
  assert.equal(slowDown.state.nextPollAtMs, NOW_MS + 10_000);

  await assert.rejects(
    pollRegistration({
      fetchImpl: createJsonFetch(
        { error: "access_denied", error_description: "Denied" },
        [],
        400
      ),
      nowMs: NOW_MS,
      state: pendingState(),
    }),
    ACCESS_DENIED_PATTERN
  );
  await assert.rejects(
    pollRegistration({
      fetchImpl: createJsonFetch({ error: "unexpected_provider_state" }, []),
      nowMs: NOW_MS,
      state: pendingState(),
    }),
    UNKNOWN_PROVIDER_STATE_PATTERN
  );
});

test("rejects an early or expired platform poll before network access", async () => {
  const requests = [];
  await assert.rejects(
    pollRegistration({
      fetchImpl: createJsonFetch(capturedPending, requests, 400),
      nowMs: NOW_MS,
      state: {
        ...pendingState(),
        nextPollAtMs: NOW_MS + 5000,
      },
    }),
    NOT_DUE_PATTERN
  );
  await assert.rejects(
    pollRegistration({
      fetchImpl: createJsonFetch(capturedPending, requests, 400),
      nowMs: NOW_MS,
      state: {
        ...pendingState(),
        expiresAtMs: NOW_MS,
      },
    }),
    EXPIRED_TOKEN_PATTERN
  );
  assert.equal(requests.length, 0);
});

test("returns credentials only after the expected brand is confirmed", async () => {
  const result = await pollRegistration({
    fetchImpl: createJsonFetch(capturedSuccess, []),
    nowMs: NOW_MS,
    state: {
      ...pendingState(),
      pollHost: "accounts.larksuite.com",
    },
  });

  assert.equal(result.status, "credentials_received");
  assert.equal(result.state.status, "credentials_received");
  assert.deepEqual(result.credential, {
    appId: "<redacted-development-app-id>",
    appSecret: "<redacted-development-app-secret>",
    operatorOpenId: "<redacted-operator-open-id>",
    provider: "lark",
  });

  await assert.rejects(
    pollRegistration({
      fetchImpl: createJsonFetch(
        {
          client_id: "cli_wrong_brand",
          client_secret: "development-secret",
          user_info: { tenant_brand: "feishu" },
        },
        []
      ),
      nowMs: NOW_MS,
      state: {
        ...pendingState(),
        pollHost: "accounts.larksuite.com",
      },
    }),
    PROVIDER_MISMATCH_PATTERN
  );
});

test("rejects implicit, local, or production provider targets", () => {
  assert.deepEqual(
    assertSafeDevelopmentTarget({
      callbackHost: "lark-gateway-dev.openmeld.ai",
      environment: "development",
      expectedAppId: "cli_development",
      productionAppIds: ["cli_production"],
      productionCallbackHosts: ["gateway.openmeld.ai"],
      provider: "lark",
    }),
    {
      callbackHost: "lark-gateway-dev.openmeld.ai",
      expectedAppId: "cli_development",
      provider: "lark",
    }
  );

  assert.throws(
    () =>
      assertSafeDevelopmentTarget({
        callbackHost: "gateway.openmeld.ai",
        environment: "development",
        expectedAppId: "cli_development",
        productionAppIds: [],
        productionCallbackHosts: ["gateway.openmeld.ai"],
        provider: "lark",
      }),
    PRODUCTION_CALLBACK_PATTERN
  );
  assert.throws(
    () =>
      assertSafeDevelopmentTarget({
        callbackHost: "lark-gateway-dev.openmeld.ai",
        environment: "development",
        expectedAppId: "cli_production",
        productionAppIds: ["cli_production"],
        productionCallbackHosts: [],
        provider: "lark",
      }),
    PRODUCTION_APP_ID_PATTERN
  );
  assert.throws(
    () =>
      assertSafeDevelopmentTarget({
        callbackHost: "localhost",
        environment: "development",
        expectedAppId: "cli_development",
        productionAppIds: [],
        productionCallbackHosts: [],
        provider: "lark",
      }),
    PUBLIC_CALLBACK_PATTERN
  );
  assert.throws(
    () =>
      assertSafeDevelopmentTarget({
        callbackHost: "lark-gateway-dev.openmeld.ai",
        environment: "production",
        expectedAppId: "cli_development",
        productionAppIds: [],
        productionCallbackHosts: [],
        provider: "lark",
      }),
    DEVELOPMENT_PATTERN
  );
});

function createJsonFetch(responseBody, requests, status = 200) {
  return (url, init) => {
    requests.push({
      body: new URLSearchParams(init.body),
      method: init.method,
      url,
    });
    return new Response(JSON.stringify(responseBody), {
      headers: { "content-type": "application/json" },
      status,
    });
  };
}

function pendingState() {
  return {
    deviceCode: "<redacted-device-code>",
    expectedProvider: "lark",
    expiresAtMs: NOW_MS + 3_600_000,
    intervalSeconds: 5,
    nextPollAtMs: NOW_MS,
    pollHost: "accounts.larksuite.com",
    status: "pending_registration",
  };
}
