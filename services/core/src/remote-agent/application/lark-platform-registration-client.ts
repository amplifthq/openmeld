import type { RemoteAgentLarkPlatformProvider } from "../infrastructure/d1/lark-platform-channel-connection-repo";
import {
  encodeLarkPlatformRegistrationAddons,
  LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE,
} from "./lark-platform-permission-bundles";

const REGISTRATION_BEGIN_ACCOUNT_DOMAIN = "accounts.feishu.cn";
const REGISTRATION_PATH = "/oauth/v1/app/registration";
const REGISTRATION_POLL_ACCOUNT_DOMAINS = new Set([
  REGISTRATION_BEGIN_ACCOUNT_DOMAIN,
  "accounts.larksuite.com",
]);
const SLOW_DOWN_INCREMENT_MS = 5000;
const FORM_HEADERS = {
  "content-type": "application/x-www-form-urlencoded",
};

type JsonObject = Record<string, unknown>;

type LarkPlatformRegistrationReason =
  | "registration_denied"
  | "registration_expired"
  | "registration_http_failed"
  | "registration_input_invalid"
  | "registration_poll_not_due"
  | "registration_provider_brand_mismatch"
  | "registration_response_invalid"
  | "registration_response_unknown"
  | "registration_transport_failed";

export class LarkPlatformRegistrationError extends Error {
  readonly reasonCode: string;

  constructor(input: {
    provider: RemoteAgentLarkPlatformProvider;
    reason: LarkPlatformRegistrationReason;
  }) {
    const reasonCode = `${input.provider}.${input.reason}`;
    super(reasonCode);
    this.name = "LarkPlatformRegistrationError";
    this.reasonCode = reasonCode;
  }
}

export async function beginLarkPlatformRegistration(input: {
  appDescription: string;
  appName: string;
  expectedProvider: RemoteAgentLarkPlatformProvider;
  fetchImpl?: typeof fetch;
  nowMs: number;
  source: string;
}): Promise<{
  accountDomain: string;
  deviceCode: string;
  expiresAtMs: number;
  nextPollAtMs: number;
  pollIntervalMs: number;
  registrationUrl: string;
  userCode: string;
}> {
  assertNonEmpty(input.appName, input.expectedProvider);
  assertNonEmpty(input.appDescription, input.expectedProvider);
  assertNonEmpty(input.source, input.expectedProvider);
  assertTimestamp(input.nowMs, input.expectedProvider);

  const response = await requestRegistration({
    accountDomain: REGISTRATION_BEGIN_ACCOUNT_DOMAIN,
    fetchImpl: input.fetchImpl ?? fetch,
    parameters: new URLSearchParams({
      action: "begin",
      archetype: "PersonalAgent",
      auth_method: "client_secret",
      request_user_info: "open_id",
    }),
    provider: input.expectedProvider,
  });
  const deviceCode = readRequiredString(
    response,
    "device_code",
    input.expectedProvider
  );
  const userCode = readRequiredString(
    response,
    "user_code",
    input.expectedProvider
  );
  const verificationUriComplete = readRequiredString(
    response,
    "verification_uri_complete",
    input.expectedProvider
  );
  const pollIntervalMs = readPositiveInteger(response, "interval", 5) * 1000;
  const expiresInMs = readPositiveInteger(response, "expires_in", 600) * 1000;
  const registrationUrl = new URL(verificationUriComplete);
  if (
    registrationUrl.protocol !== "https:" ||
    registrationUrl.host !== "open.feishu.cn" ||
    registrationUrl.pathname !== "/page/launcher"
  ) {
    throw registrationError(
      input.expectedProvider,
      "registration_response_invalid"
    );
  }
  registrationUrl.searchParams.set(
    "addons",
    await encodeLarkPlatformRegistrationAddons(
      LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE
    )
  );
  registrationUrl.searchParams.set("createOnly", "true");
  registrationUrl.searchParams.set("desc", input.appDescription.trim());
  registrationUrl.searchParams.set("from", "sdk");
  registrationUrl.searchParams.set("name", input.appName.trim());
  registrationUrl.searchParams.set("source", `node-sdk/${input.source.trim()}`);
  registrationUrl.searchParams.set("tp", "sdk");

  return {
    accountDomain: REGISTRATION_BEGIN_ACCOUNT_DOMAIN,
    deviceCode,
    expiresAtMs: input.nowMs + expiresInMs,
    nextPollAtMs: input.nowMs,
    pollIntervalMs,
    registrationUrl: registrationUrl.toString(),
    userCode,
  };
}

export async function pollLarkPlatformRegistration(input: {
  accountDomain: string;
  deviceCode: string;
  expectedProvider: RemoteAgentLarkPlatformProvider;
  expiresAtMs: number;
  fetchImpl?: typeof fetch;
  nextPollAtMs: number;
  nowMs: number;
  pollIntervalMs: number;
}): Promise<{
  accountDomain: string;
  credential: {
    appId: string;
    appSecret: string;
    operatorOpenId: string;
    provider: RemoteAgentLarkPlatformProvider;
  } | null;
  detectedBrand: RemoteAgentLarkPlatformProvider | null;
  nextPollAtMs: number;
  pollIntervalMs: number;
  status:
    | "authorization_pending"
    | "credentials_received"
    | "domain_switched"
    | "slow_down";
}> {
  validatePollInput(input);
  if (input.nowMs >= input.expiresAtMs) {
    throw registrationError(input.expectedProvider, "registration_expired");
  }
  if (input.nowMs < input.nextPollAtMs) {
    throw registrationError(
      input.expectedProvider,
      "registration_poll_not_due"
    );
  }

  const response = await requestRegistration({
    accountDomain: input.accountDomain,
    fetchImpl: input.fetchImpl ?? fetch,
    parameters: new URLSearchParams({
      action: "poll",
      device_code: input.deviceCode.trim(),
    }),
    provider: input.expectedProvider,
  });
  const tenantBrand = readProvider(response);
  const appId = readString(response, "client_id");
  const appSecret = readString(response, "client_secret");

  if (
    tenantBrand === "lark" &&
    input.accountDomain === REGISTRATION_BEGIN_ACCOUNT_DOMAIN
  ) {
    assertExpectedBrand(input.expectedProvider, tenantBrand);
    return {
      accountDomain: "accounts.larksuite.com",
      credential: null,
      detectedBrand: tenantBrand,
      nextPollAtMs: input.nowMs,
      pollIntervalMs: input.pollIntervalMs,
      status: "domain_switched",
    };
  }

  if (appId || appSecret) {
    const operatorOpenId = readNestedString(response, "user_info", "open_id");
    if (!(appId && appSecret && operatorOpenId && tenantBrand)) {
      throw registrationError(
        input.expectedProvider,
        "registration_response_invalid"
      );
    }
    assertExpectedBrand(input.expectedProvider, tenantBrand);
    return {
      accountDomain: input.accountDomain,
      credential: {
        appId,
        appSecret,
        operatorOpenId,
        provider: tenantBrand,
      },
      detectedBrand: tenantBrand,
      nextPollAtMs: input.nowMs,
      pollIntervalMs: input.pollIntervalMs,
      status: "credentials_received",
    };
  }

  const providerError = readString(response, "error");
  if (providerError === "authorization_pending") {
    return {
      accountDomain: input.accountDomain,
      credential: null,
      detectedBrand: tenantBrand,
      nextPollAtMs: input.nowMs + input.pollIntervalMs,
      pollIntervalMs: input.pollIntervalMs,
      status: "authorization_pending",
    };
  }
  if (providerError === "slow_down") {
    const pollIntervalMs = input.pollIntervalMs + SLOW_DOWN_INCREMENT_MS;
    return {
      accountDomain: input.accountDomain,
      credential: null,
      detectedBrand: tenantBrand,
      nextPollAtMs: input.nowMs + pollIntervalMs,
      pollIntervalMs,
      status: "slow_down",
    };
  }
  if (providerError === "access_denied") {
    throw registrationError(input.expectedProvider, "registration_denied");
  }
  if (providerError === "expired_token") {
    throw registrationError(input.expectedProvider, "registration_expired");
  }
  throw registrationError(
    input.expectedProvider,
    "registration_response_unknown"
  );
}

async function requestRegistration(input: {
  accountDomain: string;
  fetchImpl: typeof fetch;
  parameters: URLSearchParams;
  provider: RemoteAgentLarkPlatformProvider;
}): Promise<JsonObject> {
  let response: Response;
  try {
    const fetchImpl = input.fetchImpl;
    response = await fetchImpl(
      `https://${input.accountDomain}${REGISTRATION_PATH}`,
      {
        body: input.parameters,
        headers: FORM_HEADERS,
        method: "POST",
      }
    );
  } catch {
    throw registrationError(input.provider, "registration_transport_failed");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw registrationError(input.provider, "registration_response_invalid");
  }
  if (!isJsonObject(body)) {
    throw registrationError(input.provider, "registration_response_invalid");
  }
  if (!(response.ok || readString(body, "error"))) {
    throw registrationError(input.provider, "registration_http_failed");
  }
  return body;
}

function validatePollInput(
  input: Parameters<typeof pollLarkPlatformRegistration>[0]
): void {
  if (!REGISTRATION_POLL_ACCOUNT_DOMAINS.has(input.accountDomain)) {
    throw registrationError(
      input.expectedProvider,
      "registration_input_invalid"
    );
  }
  assertNonEmpty(input.deviceCode, input.expectedProvider);
  for (const value of [
    input.expiresAtMs,
    input.nextPollAtMs,
    input.nowMs,
    input.pollIntervalMs,
  ]) {
    assertTimestamp(value, input.expectedProvider);
  }
  if (input.pollIntervalMs <= 0) {
    throw registrationError(
      input.expectedProvider,
      "registration_input_invalid"
    );
  }
}

function assertExpectedBrand(
  expectedProvider: RemoteAgentLarkPlatformProvider,
  actualProvider: RemoteAgentLarkPlatformProvider
): void {
  if (expectedProvider !== actualProvider) {
    throw registrationError(
      expectedProvider,
      "registration_provider_brand_mismatch"
    );
  }
}

function assertNonEmpty(
  value: string,
  provider: RemoteAgentLarkPlatformProvider
): void {
  if (!value.trim()) {
    throw registrationError(provider, "registration_input_invalid");
  }
}

function assertTimestamp(
  value: number,
  provider: RemoteAgentLarkPlatformProvider
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw registrationError(provider, "registration_input_invalid");
  }
}

function readRequiredString(
  body: JsonObject,
  key: string,
  provider: RemoteAgentLarkPlatformProvider
): string {
  const value = readString(body, key);
  if (!value) {
    throw registrationError(provider, "registration_response_invalid");
  }
  return value;
}

function readPositiveInteger(
  body: JsonObject,
  key: string,
  fallback: number
): number {
  const value = body[key];
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : fallback;
}

function readProvider(
  body: JsonObject
): RemoteAgentLarkPlatformProvider | null {
  const value = readNestedString(body, "user_info", "tenant_brand");
  return value === "lark" || value === "feishu" ? value : null;
}

function readNestedString(
  body: JsonObject,
  parentKey: string,
  key: string
): string | null {
  const parent = body[parentKey];
  return isJsonObject(parent) ? readString(parent, key) : null;
}

function readString(body: JsonObject, key: string): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function registrationError(
  provider: RemoteAgentLarkPlatformProvider,
  reason: LarkPlatformRegistrationReason
): LarkPlatformRegistrationError {
  return new LarkPlatformRegistrationError({ provider, reason });
}
