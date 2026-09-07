import {
  AUTH_SECRET_MIN_LENGTH,
  DEFAULT_AUTH_BRAND_NAME,
  DEFAULT_AUTH_FROM_EMAIL,
  DEFAULT_DEVICE_ALLOWED_CLIENT_IDS,
  DEFAULT_MAGIC_LINK_EXPIRES_IN_SECONDS,
} from "../configs/constants";
import { normalizeAuthBaseUrl } from "./auth-url";
import { normalizeCookieDomain } from "./cookie-domain";

export type AuthWorkerNodeEnv = "development" | "production";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const INVALID_HOST_VALUE_PATTERN = /[/:?#\s]/;
const COOKIE_PREFIX_PATTERN = /^[A-Za-z0-9_-]+$/;

export type AuthConfigInput = {
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_OPENMELD_SECRET?: string;
  AUTH_WORKER_NODE_ENV?: string;
  AUTH_DEVICE_ALLOWED_CLIENT_IDS?: string;
  AUTH_FROM_EMAIL?: string;
  AUTH_BRAND_NAME?: string;
  WEB_APP_URL?: string;
  AUTH_COOKIE_DOMAIN?: string;
  AUTH_COOKIE_PREFIX?: string;
  PASSKEY_RP_ID?: string;
  GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID?: string;
  GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID?: string;
  GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET?: string;
  AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS?: number | string;
};

export type ValidatedAuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_OPENMELD_SECRET: string;
  AUTH_WORKER_NODE_ENV: AuthWorkerNodeEnv;
  AUTH_DEVICE_ALLOWED_CLIENT_IDS: string[];
  AUTH_FROM_EMAIL: string;
  AUTH_BRAND_NAME: string;
  WEB_APP_URL: string;
  AUTH_COOKIE_DOMAIN?: string;
  AUTH_COOKIE_PREFIX?: string;
  PASSKEY_RP_ID?: string;
  GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID?: string;
  GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID?: string;
  GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET?: string;
  AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS: number;
};

export function validateAuthConfig(
  input: AuthConfigInput
): ValidatedAuthConfig {
  const env = resolveAuthWorkerNodeEnv(input.AUTH_WORKER_NODE_ENV);
  const allowedClientIds = parseAllowedClientIds(
    input.AUTH_DEVICE_ALLOWED_CLIENT_IDS
  );

  const url = normalizeAuthBaseUrl(input.BETTER_AUTH_URL);
  const appUrl = normalizeAuthBaseUrl(input.WEB_APP_URL, url);
  const secret = String(input.BETTER_AUTH_OPENMELD_SECRET ?? "").trim();

  if (!secret) {
    throw new Error("BETTER_AUTH_OPENMELD_SECRET is required");
  }

  if (secret.length < AUTH_SECRET_MIN_LENGTH) {
    throw new Error(
      `BETTER_AUTH_OPENMELD_SECRET must be at least ${AUTH_SECRET_MIN_LENGTH} characters`
    );
  }

  const brandName =
    normalizeOptional(input.AUTH_BRAND_NAME) ?? DEFAULT_AUTH_BRAND_NAME;
  const fromEmail =
    normalizeOptional(input.AUTH_FROM_EMAIL) ?? DEFAULT_AUTH_FROM_EMAIL;
  const cookieDomain = parseCookieDomain(input.AUTH_COOKIE_DOMAIN);
  const cookiePrefix = normalizeOptional(input.AUTH_COOKIE_PREFIX);
  if (cookiePrefix && !COOKIE_PREFIX_PATTERN.test(cookiePrefix)) {
    throw new Error(
      "AUTH_COOKIE_PREFIX must contain only letters, numbers, underscores or hyphens"
    );
  }
  const passkeyRpId = parseRpId(input.PASSKEY_RP_ID);
  const githubClientId = normalizeOptional(
    input.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID
  );
  const githubClientSecret = normalizeOptional(
    input.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET
  );
  const googleClientId = normalizeOptional(
    input.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID
  );
  const googleClientSecret = normalizeOptional(
    input.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET
  );

  assertOAuthPair("GITHUB", githubClientId, githubClientSecret);
  assertOAuthPair("GOOGLE", googleClientId, googleClientSecret);

  if (!isLikelyEmailEnvelope(fromEmail)) {
    throw new Error(
      "AUTH_FROM_EMAIL must be an email address or display-name envelope, e.g. 'OpenMeld <noreply@openmeld.ai>'"
    );
  }

  const magicLinkExpiresInSeconds = parsePositiveInteger(
    input.AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS,
    DEFAULT_MAGIC_LINK_EXPIRES_IN_SECONDS
  );

  return {
    BETTER_AUTH_URL: url,
    BETTER_AUTH_OPENMELD_SECRET: secret,
    AUTH_WORKER_NODE_ENV: env,
    AUTH_DEVICE_ALLOWED_CLIENT_IDS: allowedClientIds,
    AUTH_FROM_EMAIL: fromEmail,
    AUTH_BRAND_NAME: brandName,
    WEB_APP_URL: appUrl,
    AUTH_COOKIE_DOMAIN: cookieDomain,
    AUTH_COOKIE_PREFIX: cookiePrefix,
    PASSKEY_RP_ID: passkeyRpId,
    GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID: githubClientId,
    GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET: githubClientSecret,
    GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID: googleClientId,
    GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET: googleClientSecret,
    AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS: magicLinkExpiresInSeconds,
  };
}

function resolveAuthWorkerNodeEnv(
  value: string | undefined
): AuthWorkerNodeEnv {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "" || normalized === "development") {
    return "development";
  }
  if (normalized === "production") {
    return "production";
  }
  throw new Error(
    "AUTH_WORKER_NODE_ENV must be either 'development' or 'production'"
  );
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isLikelyEmailEnvelope(value: string): boolean {
  const candidate = value.includes("<")
    ? value.slice(value.indexOf("<") + 1, value.lastIndexOf(">")).trim()
    : value.trim();
  if (!candidate) {
    return false;
  }

  const atParts = candidate.split("@");
  if (atParts.length !== 2) {
    return false;
  }

  const [localPart, domainPart] = atParts;
  if (!(localPart && domainPart)) {
    return false;
  }

  const domainLabels = domainPart.split(".");
  return (
    domainLabels.length >= 2 && domainLabels.every((label) => label.length > 0)
  );
}

function parsePositiveInteger(
  value: number | string | undefined,
  fallback: number
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      "AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS must be a positive integer"
    );
  }

  return Math.floor(parsed);
}

function parseAllowedClientIds(value: string | undefined): string[] {
  const raw = normalizeOptional(value);
  const source = raw ? raw.split(",") : [...DEFAULT_DEVICE_ALLOWED_CLIENT_IDS];

  const uniqueValues = new Set<string>();
  for (const clientId of source) {
    const normalized = String(clientId).trim();
    if (!normalized) {
      continue;
    }
    if (!CLIENT_ID_PATTERN.test(normalized)) {
      throw new Error(
        `AUTH_DEVICE_ALLOWED_CLIENT_IDS contains invalid client_id: ${normalized}`
      );
    }
    uniqueValues.add(normalized);
  }

  const result = Array.from(uniqueValues);
  if (result.length === 0) {
    throw new Error("AUTH_DEVICE_ALLOWED_CLIENT_IDS must not be empty");
  }

  return result;
}

function parseCookieDomain(value: string | undefined): string | undefined {
  const raw = normalizeOptional(value);
  if (!raw) {
    return undefined;
  }

  const normalized = normalizeCookieDomain(raw);
  if (!isHostLikeValue(normalized)) {
    throw new Error("AUTH_COOKIE_DOMAIN must be a valid hostname");
  }

  return normalized;
}

function parseRpId(value: string | undefined): string | undefined {
  const normalized = normalizeOptional(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (!isHostLikeValue(normalized)) {
    throw new Error("PASSKEY_RP_ID must be a valid hostname");
  }
  return normalized;
}

function isHostLikeValue(value: string): boolean {
  return !(INVALID_HOST_VALUE_PATTERN.test(value) || value.includes(".."));
}

function assertOAuthPair(
  provider: "GITHUB" | "GOOGLE",
  clientId?: string,
  clientSecret?: string
): void {
  if (!(clientId || clientSecret)) {
    return;
  }

  const credentialPrefix = `${provider}_OPENMELD_AUTH_OAUTH`;

  if (!clientId) {
    throw new Error(
      `${credentialPrefix}_CLIENT_ID is required when ${credentialPrefix}_CLIENT_SECRET is set`
    );
  }

  if (!clientSecret) {
    throw new Error(
      `${credentialPrefix}_CLIENT_SECRET is required when ${credentialPrefix}_CLIENT_ID is set`
    );
  }
}
