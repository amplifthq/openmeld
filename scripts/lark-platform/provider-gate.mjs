#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import permissionBundleSource from "../../config/message-channels/lark-platform-channel-only-permission-bundle.json" with {
  type: "json",
};
import registrationDomains from "../../packages/schemas/src/schemas/http/lark-platform-registration-domains.json" with {
  type: "json",
};

const REGISTRATION_PATH = "/oauth/v1/app/registration";
const REGISTRATION_BEGIN_HOST = registrationDomains.feishu.accountDomain;
const PRIVATE_IPV4_PREFIX_PATTERN = /^(?:10|127|169\.254|192\.168)\./u;
const PRIVATE_172_PREFIX_PATTERN = /^172\.(?:1[6-9]|2\d|3[01])\./u;
const SUPPORTED_PROVIDERS = new Set(Object.keys(registrationDomains));
const SLOW_DOWN_INCREMENT_SECONDS = 5;

export const CHANNEL_ONLY_PERMISSION_BUNDLE = Object.freeze({
  ...permissionBundleSource,
  callbacks: Object.freeze([...permissionBundleSource.callbacks]),
  events: Object.freeze([...permissionBundleSource.events]),
  scopes: Object.freeze([...permissionBundleSource.scopes]),
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runProviderGateCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "Run `pnpm run verify:lark-platform-provider -- --help` for usage."
    );
    process.exitCode = 1;
  }
}

export function assertSafeDevelopmentTarget(input) {
  if (input.environment !== "development") {
    throw new Error(
      "The Lark platform provider gate only targets the development environment."
    );
  }
  assertProvider(input.provider);
  assertNonEmptyString(input.expectedAppId, "expected App ID");
  assertNonEmptyString(input.callbackHost, "callback host");

  const callbackHost = normalizeHost(input.callbackHost);
  if (!isPublicHostname(callbackHost)) {
    throw new Error(
      "The provider gate requires an explicit public HTTPS callback host."
    );
  }

  const productionAppIds = new Set(input.productionAppIds ?? []);
  if (productionAppIds.has(input.expectedAppId)) {
    throw new Error(
      `Refusing to target production App ID ${input.expectedAppId}.`
    );
  }

  const productionCallbackHosts = new Set(
    (input.productionCallbackHosts ?? []).map(normalizeHost)
  );
  if (productionCallbackHosts.has(callbackHost)) {
    throw new Error(
      `Refusing to target production callback host ${callbackHost}.`
    );
  }

  return {
    callbackHost,
    expectedAppId: input.expectedAppId,
    provider: input.provider,
  };
}

export async function beginRegistration(input) {
  assertProvider(input.expectedProvider);
  const response = await requestRegistration({
    fetchImpl: input.fetchImpl ?? fetch,
    host: REGISTRATION_BEGIN_HOST,
    parameters: {
      action: "begin",
      archetype: "PersonalAgent",
      auth_method: "client_secret",
      request_user_info: "open_id",
    },
  });
  const deviceCode = requireResponseString(response, "device_code");
  const userCode = requireResponseString(response, "user_code");
  const verificationUri = requireResponseString(
    response,
    "verification_uri_complete"
  );
  const intervalSeconds = positiveIntegerOrDefault(response.interval, 5);
  const expiresInSeconds = positiveIntegerOrDefault(response.expires_in, 600);

  return {
    beginResponse: {
      expires_in: expiresInSeconds,
      interval: intervalSeconds,
      verification_uri_complete: verificationUri,
    },
    state: {
      deviceCode,
      expectedProvider: input.expectedProvider,
      expiresAtMs: input.nowMs + expiresInSeconds * 1000,
      intervalSeconds,
      nextPollAtMs: input.nowMs,
      pollHost: REGISTRATION_BEGIN_HOST,
      status: "pending_registration",
    },
    userCode,
  };
}

export function buildRegistrationUrl(input) {
  assertProvider(input.provider);
  const url = new URL(input.beginResponse.verification_uri_complete);
  if (
    url.protocol !== "https:" ||
    url.host !== registrationDomains.feishu.launcherHost ||
    url.pathname !== "/page/launcher" ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.getAll("user_code").length !== 1 ||
    !url.searchParams.get("user_code")?.trim() ||
    url.searchParams.get("user_code") !== input.beginResponse.user_code
  ) {
    throw new Error("Unexpected registration verification details.");
  }
  assertNonEmptyString(input.appId, "development App ID");
  assertNonEmptyString(input.appName, "development app name");
  assertNonEmptyString(input.appDescription, "development app description");
  assertNonEmptyString(input.source, "registration source");

  url.searchParams.set("addons", encodeRegistrationAddons());
  url.searchParams.set("clientID", input.appId);
  url.searchParams.set("desc", input.appDescription);
  url.hostname = registrationDomains[input.provider].launcherHost;
  url.searchParams.set("from", "sdk");
  url.searchParams.set("name", input.appName);
  url.searchParams.set("source", `node-sdk/${input.source}`);
  url.searchParams.set("tp", "sdk");
  return url.toString();
}

export function encodeRegistrationAddons(
  bundle = CHANNEL_ONLY_PERMISSION_BUNDLE
) {
  const payload = {
    callbacks: {
      items: [...bundle.callbacks],
    },
    events: {
      items: {
        tenant: [...bundle.events],
      },
    },
    preset: bundle.preset,
    scopes: {
      tenant: [...bundle.scopes],
    },
  };
  return gzipSync(Buffer.from(JSON.stringify(payload), "utf8")).toString(
    "base64url"
  );
}

export async function pollRegistration(input) {
  const state = validateRegistrationState(input.state);
  if (input.nowMs >= state.expiresAtMs) {
    throw new Error("expired_token: Registration state has expired.");
  }
  if (input.nowMs < state.nextPollAtMs) {
    throw new Error(
      `registration_poll_not_due: Retry at ${state.nextPollAtMs}.`
    );
  }

  const response = await requestRegistration({
    fetchImpl: input.fetchImpl ?? fetch,
    host: state.pollHost,
    parameters: {
      action: "poll",
      device_code: state.deviceCode,
    },
  });
  const tenantBrand = response.user_info?.tenant_brand;
  const appId = response.client_id;
  const appSecret = response.client_secret;

  if (tenantBrand && tenantBrand !== state.expectedProvider) {
    throw new Error(
      `provider_brand_mismatch: expected ${state.expectedProvider} but received ${tenantBrand}.`
    );
  }

  if (tenantBrand === "lark" && state.pollHost === REGISTRATION_BEGIN_HOST) {
    return {
      credential: null,
      state: {
        ...state,
        nextPollAtMs: input.nowMs,
        pollHost: registrationDomains.lark.accountDomain,
      },
      status: "domain_switched",
    };
  }

  if (appId || appSecret) {
    if (!(appId && appSecret && tenantBrand)) {
      throw new Error(
        "invalid_registration_credentials: Provider returned an incomplete credential response."
      );
    }
    if (tenantBrand !== state.expectedProvider) {
      throw new Error(
        `provider_brand_mismatch: expected ${state.expectedProvider} but received ${tenantBrand}.`
      );
    }
    const operatorOpenId = response.user_info?.open_id;
    if (!operatorOpenId) {
      throw new Error(
        "invalid_registration_credentials: Provider omitted the requested operator open ID."
      );
    }
    return {
      credential: {
        appId,
        appSecret,
        operatorOpenId,
        provider: tenantBrand,
      },
      state: {
        ...state,
        nextPollAtMs: input.nowMs,
        status: "credentials_received",
      },
      status: "credentials_received",
    };
  }

  if (response.error === "authorization_pending") {
    return {
      credential: null,
      state: {
        ...state,
        nextPollAtMs: input.nowMs + state.intervalSeconds * 1000,
      },
      status: "authorization_pending",
    };
  }
  if (response.error === "slow_down") {
    const intervalSeconds = state.intervalSeconds + SLOW_DOWN_INCREMENT_SECONDS;
    return {
      credential: null,
      state: {
        ...state,
        intervalSeconds,
        nextPollAtMs: input.nowMs + intervalSeconds * 1000,
      },
      status: "slow_down",
    };
  }
  if (response.error) {
    throw new Error(
      `${response.error}: ${response.error_description || "Provider registration failed."}`
    );
  }

  throw new Error(
    "invalid_registration_response: Provider returned no recognized state."
  );
}

async function runProviderGateCli(rawArgs) {
  const options = parseProviderGateArgs(rawArgs);
  if (options.help) {
    printUsage();
    return;
  }
  const target = assertSafeDevelopmentTarget({
    callbackHost: options.callbackHost,
    environment: options.environment,
    expectedAppId: options.appId,
    productionAppIds: splitList(
      process.env.OPENMELD_PRODUCTION_LARK_PLATFORM_APP_IDS
    ),
    productionCallbackHosts: splitList(
      process.env.OPENMELD_PRODUCTION_LARK_PLATFORM_CALLBACK_HOSTS
    ),
    provider: options.provider,
  });

  if (options.action === "begin") {
    const nowMs = Date.now();
    const result = await beginRegistration({
      expectedProvider: target.provider,
      nowMs,
    });
    const registrationUrl = buildRegistrationUrl({
      appDescription:
        "Development-only OpenMeld Center Agent message channel probe.",
      appId: target.expectedAppId,
      appName: "OpenMeld Center Agent Dev",
      beginResponse: result.beginResponse,
      provider: target.provider,
      source: "openmeld-gate-0",
    });
    await writePrivateJson(options.stateFile, {
      callbackHost: target.callbackHost,
      permissionBundleVersion: CHANNEL_ONLY_PERMISSION_BUNDLE.version,
      registrationUrl,
      state: result.state,
    });
    console.log(
      JSON.stringify({
        expiresAtMs: result.state.expiresAtMs,
        permissionBundleVersion: CHANNEL_ONLY_PERMISSION_BUNDLE.version,
        registrationUrl,
        stateFile: options.stateFile,
        status: result.state.status,
      })
    );
    return;
  }

  const persisted = JSON.parse(await readFile(options.stateFile, "utf8"));
  if (
    persisted.callbackHost !== target.callbackHost ||
    persisted.state?.expectedProvider !== target.provider
  ) {
    throw new Error(
      "Persisted registration target does not match the explicit command target."
    );
  }
  const result = await pollRegistration({
    nowMs: Date.now(),
    state: persisted.state,
  });
  if (result.credential && result.credential.appId !== target.expectedAppId) {
    throw new Error(
      `Provider returned App ID ${result.credential.appId}, not the explicit development target.`
    );
  }
  await writePrivateJson(options.stateFile, {
    ...persisted,
    state: result.state,
  });
  if (result.credential) {
    await writePrivateJson(options.credentialFile, result.credential);
  }
  console.log(
    JSON.stringify({
      credentialFile: result.credential ? options.credentialFile : null,
      nextPollAtMs: result.state.nextPollAtMs,
      stateFile: options.stateFile,
      status: result.status,
    })
  );
}

function parseProviderGateArgs(rawArgs) {
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : [...rawArgs];
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }

  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.`);
    }
    switch (option) {
      case "--action":
        parsed.action = value;
        break;
      case "--app-id":
        parsed.appId = value;
        break;
      case "--callback-host":
        parsed.callbackHost = value;
        break;
      case "--credential-file":
        parsed.credentialFile = value;
        break;
      case "--environment":
        parsed.environment = value;
        break;
      case "--provider":
        parsed.provider = value;
        break;
      case "--state-file":
        parsed.stateFile = value;
        break;
      default:
        throw new Error(`Unknown option ${option}.`);
    }
    index += 1;
  }

  if (!["begin", "poll"].includes(parsed.action)) {
    throw new Error("Provider gate action must be begin or poll.");
  }
  for (const [name, value] of [
    ["App ID", parsed.appId],
    ["callback host", parsed.callbackHost],
    ["environment", parsed.environment],
    ["provider", parsed.provider],
    ["state file", parsed.stateFile],
  ]) {
    assertNonEmptyString(value, name);
  }
  if (parsed.action === "poll") {
    assertNonEmptyString(parsed.credentialFile, "credential file");
  }
  return parsed;
}

async function requestRegistration(input) {
  const response = await input.fetchImpl(
    `https://${input.host}${REGISTRATION_PATH}`,
    {
      body: new URLSearchParams(input.parameters),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    }
  );
  const result = await response.json();
  if (!(response.ok || result.error)) {
    throw new Error(
      `registration_http_${response.status}: Provider returned an unexpected HTTP error.`
    );
  }
  return result;
}

function validateRegistrationState(state) {
  if (!state || typeof state !== "object") {
    throw new Error("Registration state is missing.");
  }
  assertProvider(state.expectedProvider);
  if (
    state.pollHost !== REGISTRATION_BEGIN_HOST &&
    state.pollHost !== registrationDomains[state.expectedProvider].accountDomain
  ) {
    throw new Error(`Unexpected registration poll host ${state.pollHost}.`);
  }
  for (const field of ["expiresAtMs", "intervalSeconds", "nextPollAtMs"]) {
    if (!Number.isFinite(state[field]) || state[field] < 0) {
      throw new Error(`Registration state ${field} is invalid.`);
    }
  }
  assertNonEmptyString(state.deviceCode, "registration device code");
  return { ...state };
}

function positiveIntegerOrDefault(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function requireResponseString(response, field) {
  const value = response[field];
  assertNonEmptyString(value, `registration response ${field}`);
  return value;
}

function assertProvider(provider) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported Lark platform provider ${provider}.`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing ${name}.`);
  }
}

function normalizeHost(value) {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.includes("://")) {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.pathname !== "/") {
      throw new Error("Callback host must be an HTTPS origin without a path.");
    }
    return url.hostname;
  }
  if (trimmed.includes("/") || trimmed.includes(":")) {
    throw new Error("Callback host must be a hostname without a path or port.");
  }
  return trimmed;
}

function isPublicHostname(host) {
  return (
    host.includes(".") &&
    host !== "localhost" &&
    !host.endsWith(".internal") &&
    !host.endsWith(".local") &&
    !host.endsWith(".localhost") &&
    !host.endsWith(".test") &&
    !PRIVATE_IPV4_PREFIX_PATTERN.test(host) &&
    !PRIVATE_172_PREFIX_PATTERN.test(host)
  );
}

function splitList(value) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(filePath, 0o600);
}

function printUsage() {
  console.log(`Usage:
  pnpm run verify:lark-platform-provider -- --action begin --provider lark --environment development --app-id <development-app-id> --callback-host <development-host> --state-file <private-state-file>
  pnpm run verify:lark-platform-provider -- --action poll --provider lark --environment development --app-id <development-app-id> --callback-host <development-host> --state-file <private-state-file> --credential-file <private-credential-file>

The command never targets production and performs at most one provider poll per invocation.`);
}
