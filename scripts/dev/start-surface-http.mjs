#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_GATEWAY_URL = "https://gateway.openmeld.ai";
const TRAILING_SLASHES_PATTERN = /\/+$/u;
const TOKEN_FILE_KEY_PATTERN = /^[a-f0-9]{64}$/u;
const OPENMELD_HOME_BY_LANE = {
  canary: ".openmeld-canary",
  "dev-local": ".openmeld-dev",
  prod: ".openmeld",
};

async function main() {
  const { command, options } = parseCli(process.argv.slice(2));
  const gatewayUrl = await resolveGatewayUrl({
    openMeldHome: resolveOpenMeldHome(options),
    explicitGatewayUrl: options["gateway-url"] ?? null,
  });

  const result = await runCommand({
    openMeldHome: resolveOpenMeldHome(options),
    command,
    gatewayUrl,
    options,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runCommand(input) {
  switch (input.command) {
    case "get-current-device":
      return await requestWithAuth({
        openMeldHome: input.openMeldHome,
        gatewayUrl: input.gatewayUrl,
        method: "GET",
        path: "/v1/devices/current",
      });
    case "set-current-device":
      return await requestWithAuth({
        openMeldHome: input.openMeldHome,
        body: {
          deviceId: requireOption(input.options, "device-id"),
        },
        gatewayUrl: input.gatewayUrl,
        method: "PUT",
        path: "/v1/devices/current",
      });
    case "list-local-runtimes":
      return await requestWithAuth({
        openMeldHome: input.openMeldHome,
        gatewayUrl: input.gatewayUrl,
        method: "GET",
        path: "/v1/local-runtimes",
      });
    case "get-local-runtime-readiness":
      return await requestWithAuth({
        openMeldHome: input.openMeldHome,
        gatewayUrl: input.gatewayUrl,
        method: "GET",
        path: "/v1/local-runtimes/current/reply-readiness",
      });
    case "create-space":
      return await requestWithAuth({
        openMeldHome: input.openMeldHome,
        body: buildCreateSpaceBody(input.options),
        gatewayUrl: input.gatewayUrl,
        method: "POST",
        path: "/v1/spaces",
      });
    case "join-space":
      return await requestWithAuth({
        openMeldHome: input.openMeldHome,
        body: buildJoinSpaceBody(input.options),
        gatewayUrl: input.gatewayUrl,
        headers: buildSpacePasswordHeaders(input.options),
        method: "POST",
        path: `/v1/spaces/${requireOption(input.options, "space-id")}/members`,
      });
    case "get-space-status":
      return await requestWithAuth({
        openMeldHome: input.openMeldHome,
        gatewayUrl: input.gatewayUrl,
        headers: buildSpacePasswordHeaders(input.options),
        method: "GET",
        path: `/v1/spaces/${requireOption(input.options, "space-id")}/status`,
      });
    case "write-setup-token-observed-metadata":
      return await requestWithoutAuth({
        body: {
          opaqueToken: requireOption(input.options, "opaque-token"),
          metadata: parseJsonOption(input.options, "body-json"),
        },
        gatewayUrl: input.gatewayUrl,
        method: "PUT",
        path: "/v1/local-runtimes/current/observed-metadata",
      });
    default:
      throw new Error(`Unsupported command "${input.command}"`);
  }
}

async function requestWithAuth(input) {
  const session = await readStoredAuthSession({
    openMeldHome: input.openMeldHome,
  });

  return await sendJsonRequest({
    bearerToken: session.accessToken,
    body: input.body ?? null,
    gatewayUrl: input.gatewayUrl,
    headers: input.headers ?? null,
    method: input.method,
    path: input.path,
    tokenType: session.tokenType,
  });
}

async function requestWithoutAuth(input) {
  return await sendJsonRequest({
    bearerToken: null,
    body: input.body ?? null,
    gatewayUrl: input.gatewayUrl,
    headers: input.headers ?? null,
    method: input.method,
    path: input.path,
    tokenType: null,
  });
}

async function sendJsonRequest(input) {
  const url = new URL(input.path, ensureTrailingSlash(input.gatewayUrl));
  const headers = {
    accept: "application/json",
    ...(input.headers ?? {}),
  };
  if (input.bearerToken) {
    headers.authorization = `${normalizeTokenType(input.tokenType)} ${input.bearerToken}`;
  }
  if (input.body !== null) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    method: input.method,
    headers,
    ...(input.body === null ? {} : { body: JSON.stringify(input.body) }),
  });
  const body = await parseResponseBody(response);

  return {
    ok: response.ok,
    request: {
      body: input.body,
      method: input.method,
      path: input.path,
      url: url.toString(),
    },
    response: {
      body,
      ok: response.ok,
      requestId: readCanonicalRequestId(response.headers),
      webProxyRequestId: response.headers.get("x-web-proxy-request-id"),
      status: response.status,
    },
  };
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (text.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function buildCreateSpaceBody(options) {
  return {
    ...(options.name === undefined
      ? {}
      : { name: String(options.name).trim() }),
    ...(options.purpose === undefined
      ? {}
      : { purpose: String(options.purpose).trim() }),
    ...(options.guide === undefined
      ? {}
      : { guide: String(options.guide).trim() }),
    ...(options.password === undefined
      ? {}
      : { password: String(options.password) }),
  };
}

export function buildJoinSpaceBody(options) {
  return {
    memberProfileIds: parseCsvOption(
      requireOption(options, "member-profile-ids")
    ),
  };
}

function buildSpacePasswordHeaders(options) {
  const spacePassword = normalizeNonEmptyString(options["space-password"]);
  if (!spacePassword) {
    return null;
  }
  return {
    "x-openmeld-space-password": spacePassword,
  };
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    throw new Error("A command is required");
  }

  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}"`);
    }
    const optionName = token.slice(2);
    const optionValue = rest[index + 1];
    if (!optionValue || optionValue.startsWith("--")) {
      throw new Error(`Missing value for option "--${optionName}"`);
    }
    options[optionName] = optionValue;
    index += 1;
  }

  return {
    command,
    options,
  };
}

function parseJsonOption(options, name) {
  const raw = requireOption(options, name);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON for --${name}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function parseCsvOption(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function requireOption(options, name) {
  const value = String(options[name] ?? "").trim();
  if (value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function resolveOpenMeldHome(options) {
  const explicitOpenMeldHome = String(
    options["openmeld-home"] ?? process.env.OPENMELD_HOME ?? ""
  ).trim();
  if (explicitOpenMeldHome) {
    return explicitOpenMeldHome;
  }

  const lane = normalizeLane(
    options.lane ?? process.env.OPENMELD_ENV_PRESET ?? "dev-local"
  );
  return join(homedir(), OPENMELD_HOME_BY_LANE[lane]);
}

function normalizeLane(value) {
  if (value === "prod" || value === "dev-local" || value === "canary") {
    return value;
  }
  throw new Error(`Unsupported lane "${value}"`);
}

async function resolveGatewayUrl(input) {
  const explicitGatewayUrl = String(
    input.explicitGatewayUrl ?? process.env.OPENMELD_GATEWAY_URL ?? ""
  ).trim();
  if (explicitGatewayUrl) {
    return normalizeGatewayUrl(explicitGatewayUrl);
  }

  const runtimeConfigPath = join(input.openMeldHome, "config.json");
  const runtimeConfig = await readJsonFile(runtimeConfigPath);
  if (runtimeConfig && typeof runtimeConfig.baseUrl === "string") {
    return normalizeGatewayUrl(runtimeConfig.baseUrl);
  }

  const authSession = await readStoredAuthSession({
    openMeldHome: input.openMeldHome,
  }).catch(() => null);
  if (authSession) {
    const derivedGatewayUrl = deriveGatewayUrlFromAuthBaseUrl(
      authSession.authBaseUrl
    );
    if (derivedGatewayUrl) {
      return derivedGatewayUrl;
    }
  }

  return normalizeGatewayUrl(DEFAULT_GATEWAY_URL);
}

async function readStoredAuthSession(input) {
  const sessionPath = join(input.openMeldHome, "auth", "session.json");
  const payload = await readJsonFile(sessionPath);
  if (payload?.v !== 1 || !payload.tokenRef) {
    throw new Error(`No valid auth session found at ${sessionPath}`);
  }
  const tokenRef = normalizeStoredTokenRef(payload.tokenRef);
  if (!tokenRef) {
    throw new Error(`Auth session at ${sessionPath} has an invalid tokenRef`);
  }

  const authBaseUrl = normalizeNonEmptyString(payload.authBaseUrl);
  const tokenType = normalizeTokenType(payload.tokenType);
  if (!authBaseUrl) {
    throw new Error(`Auth session at ${sessionPath} is missing authBaseUrl`);
  }

  const accessToken = await readStoredAccessToken({
    openMeldHome: input.openMeldHome,
    tokenRef,
  });

  return {
    accessToken,
    authBaseUrl,
    tokenType,
  };
}

export async function readStoredAccessToken(input) {
  const tokenRef = input.tokenRef;
  if (tokenRef.provider === "macos-keychain") {
    throw new Error(
      "start-surface-http cannot read a macOS Keychain session because this " +
        "developer tool runs unattended and must not open authorization windows. " +
        "Run this request through the current packaged OpenMeld CLI, or sign in " +
        "to an isolated dev-local lane that uses private local token storage."
    );
  }

  if (tokenRef.provider === "insecure-file") {
    const tokenFileKey = requireValidStoredTokenFileKey(tokenRef.key);
    const raw = await readFile(
      join(input.openMeldHome, "auth", "tokens", `${tokenFileKey}.token`),
      "utf8"
    );
    const accessToken = raw.trim();
    if (accessToken.length === 0) {
      throw new Error("insecure token file is empty");
    }
    return accessToken;
  }

  throw new Error(
    `Unsupported token provider "${String(tokenRef.provider)}" for start-surface-http`
  );
}

async function readJsonFile(path) {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function deriveGatewayUrlFromAuthBaseUrl(authBaseUrl) {
  let parsed;
  try {
    parsed = new URL(authBaseUrl);
  } catch {
    return null;
  }
  if (!parsed.hostname.startsWith("auth.")) {
    return null;
  }

  parsed.hostname = `gateway.${parsed.hostname.slice("auth.".length)}`;
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return normalizeGatewayUrl(parsed.toString());
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeGatewayUrl(value) {
  const parsed = new URL(value);
  parsed.pathname =
    parsed.pathname.replace(TRAILING_SLASHES_PATTERN, "") || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function normalizeNonEmptyString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function readCanonicalRequestId(headers) {
  return (
    headers.get("x-openmeld-request-id") ?? headers.get("x-request-id") ?? null
  );
}

function normalizeTokenType(value) {
  return normalizeNonEmptyString(value) ?? "Bearer";
}

export function normalizeStoredTokenFileKey(value) {
  const normalized = normalizeNonEmptyString(value);
  if (!(normalized && TOKEN_FILE_KEY_PATTERN.test(normalized))) {
    return null;
  }
  return normalized;
}

function requireValidStoredTokenFileKey(value) {
  const normalized = normalizeStoredTokenFileKey(value);
  if (!normalized) {
    throw new Error("stored token key is invalid");
  }
  return normalized;
}

function normalizeStoredTokenRef(value) {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const record = value;
  const provider = normalizeNonEmptyString(record.provider);
  if (provider === "macos-keychain") {
    const service = normalizeNonEmptyString(record.service);
    const account = normalizeNonEmptyString(record.account);
    if (!(service && account)) {
      return null;
    }
    return {
      provider,
      service,
      account,
    };
  }

  if (provider === "windows-dpapi" || provider === "insecure-file") {
    const key = normalizeStoredTokenFileKey(record.key);
    if (!key) {
      return null;
    }
    return {
      provider,
      key,
    };
  }

  return null;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${errorMessage}\n`);
    process.exitCode = 1;
  });
}
