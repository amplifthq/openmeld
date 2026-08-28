import {
  BETTER_AUTH_DEVICE_AUTHORIZATION_GRANT_TYPE,
  type BetterAuthDeviceAuthorizationTokenResponse,
  type BetterAuthSessionUserSnapshot,
  betterAuthDeviceAuthorizationErrorResponseSchema,
  betterAuthDeviceAuthorizationTokenRequestSchema,
  betterAuthDeviceAuthorizationTokenResponseSchema,
  betterAuthSessionSnapshotResponseSchema,
} from "@openmeld/schemas";

const DEFAULT_DEVICE_CLIENT_ID = "openmeld-cli";
const DEVICE_CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;

export type DeviceTokenSuccessResponse =
  BetterAuthDeviceAuthorizationTokenResponse;
export type AuthUserSnapshot = BetterAuthSessionUserSnapshot;

type DeviceTokenErrorResponse = {
  error?: string;
  error_description?: string;
  message?: string;
  detail?: string;
};

export type AuthDeviceSessionOperation =
  | "exchange_device_token"
  | "read_auth_session"
  | "revoke_auth_session";

export class AuthDeviceSessionClientError extends Error {
  readonly endpoint: string;
  readonly operation: AuthDeviceSessionOperation;
  readonly status: number | null;

  constructor(input: {
    endpoint: string;
    message: string;
    operation: AuthDeviceSessionOperation;
    status?: number | null;
    cause?: unknown;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause }
    );
    this.name = "AuthDeviceSessionClientError";
    this.endpoint = input.endpoint;
    this.operation = input.operation;
    this.status = input.status ?? null;
  }
}

export type RevokeAuthAccessTokenResult =
  | { ok: true }
  | { ok: false; error: AuthDeviceSessionClientError };

export async function requestDeviceToken(input: {
  authBaseUrl: string;
  clientId: string;
  deviceCode: string;
}): Promise<
  | { ok: true; data: DeviceTokenSuccessResponse }
  | { ok: false; error: DeviceTokenErrorResponse; status: number }
> {
  const endpoint = toAuthEndpoint(input.authBaseUrl, "/api/auth/device/token");
  const parsedRequest =
    betterAuthDeviceAuthorizationTokenRequestSchema.safeParse({
      grant_type: BETTER_AUTH_DEVICE_AUTHORIZATION_GRANT_TYPE,
      device_code: input.deviceCode,
      client_id: input.clientId,
    });
  if (!parsedRequest.success) {
    throw createClientError({
      endpoint,
      operation: "exchange_device_token",
      message: "computer authorization token request was invalid",
      cause: parsedRequest.error,
    });
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(parsedRequest.data),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw createClientError({
      endpoint,
      operation: "exchange_device_token",
      message: "computer authorization token request failed",
      cause: error,
    });
  }

  const payload = await parseResponseJson(response);
  if (response.ok) {
    const parsed =
      betterAuthDeviceAuthorizationTokenResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw createClientError({
        endpoint,
        operation: "exchange_device_token",
        status: response.status,
        message: "computer authorization token response was invalid",
        cause: parsed.error,
      });
    }
    return { ok: true, data: parsed.data };
  }

  const parsedError =
    betterAuthDeviceAuthorizationErrorResponseSchema.safeParse(payload);
  return {
    ok: false,
    error: parsedError.success
      ? parsedError.data
      : { message: response.statusText || `HTTP ${response.status}` },
    status: response.status,
  };
}

export async function fetchAuthUserSnapshot(input: {
  authBaseUrl: string;
  accessToken: string;
}): Promise<AuthUserSnapshot> {
  const endpoint = toAuthEndpoint(input.authBaseUrl, "/api/auth/get-session");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw createClientError({
      endpoint,
      operation: "read_auth_session",
      message: "computer authorization account request failed",
      cause: error,
    });
  }
  if (!response.ok) {
    const payload = await parseResponseJson(response);
    throw createClientError({
      endpoint,
      operation: "read_auth_session",
      status: response.status,
      message: `computer authorization account request failed: ${extractAuthApiErrorMessage(payload, response.status)}`,
    });
  }

  const payload = await parseResponseJson(response);
  const parsed = betterAuthSessionSnapshotResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw createClientError({
      endpoint,
      operation: "read_auth_session",
      status: response.status,
      message: "computer authorization account response was invalid",
      cause: parsed.error,
    });
  }
  if (!parsed.data?.user) {
    throw createClientError({
      endpoint,
      operation: "read_auth_session",
      status: response.status,
      message: "computer authorization account response did not include a user",
    });
  }
  return parsed.data.user;
}

export async function revokeAuthAccessToken(input: {
  accessToken: string;
  authBaseUrl: string;
  tokenType: string;
}): Promise<RevokeAuthAccessTokenResult> {
  const endpoint = toAuthEndpoint(input.authBaseUrl, "/api/auth/sign-out");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `${input.tokenType} ${input.accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      ok: false,
      error: createClientError({
        endpoint,
        operation: "revoke_auth_session",
        message: "unused computer authorization session could not be revoked",
        cause: error,
      }),
    };
  }
  if (!response.ok) {
    const payload = await parseResponseJson(response);
    return {
      ok: false,
      error: createClientError({
        endpoint,
        operation: "revoke_auth_session",
        status: response.status,
        message: `unused computer authorization session could not be revoked: ${extractAuthApiErrorMessage(payload, response.status)}`,
      }),
    };
  }
  return { ok: true };
}

export function resolveDeviceAuthClientId(value: string | undefined): string {
  const clientId =
    normalizeOptionalString(value) ??
    normalizeOptionalString(process.env.OPENMELD_AUTH_CLIENT_ID) ??
    DEFAULT_DEVICE_CLIENT_ID;
  if (!DEVICE_CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error(
      `invalid client_id "${clientId}" (allowed: letters, numbers, . _ : -)`
    );
  }
  return clientId;
}

export function resolveDeviceTokenExpiresAt(
  expiresIn: number | undefined
): string | undefined {
  if (
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    return undefined;
  }

  const now = Date.now();
  const MAX_DATE_MS = 8_640_000_000_000_000;
  const maxFutureMs = Math.max(
    0,
    Math.min(Number.MAX_SAFE_INTEGER, MAX_DATE_MS) - now
  );
  const safeExpiresInSeconds = Math.min(
    Math.floor(expiresIn),
    Math.floor(maxFutureMs / 1000)
  );
  if (safeExpiresInSeconds <= 0) {
    return undefined;
  }

  return new Date(now + safeExpiresInSeconds * 1000).toISOString();
}

export function extractAuthApiErrorMessage(
  payload: unknown,
  status: number
): string {
  const parsed =
    betterAuthDeviceAuthorizationErrorResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return `HTTP ${status}`;
  }
  return (
    normalizeOptionalString(parsed.data.error_description) ??
    normalizeOptionalString(parsed.data.detail) ??
    normalizeOptionalString(parsed.data.message) ??
    normalizeOptionalString(parsed.data.error) ??
    `HTTP ${status}`
  );
}

export function readAuthUserFromSessionPayload(
  payload: unknown
): AuthUserSnapshot | null {
  const parsed = betterAuthSessionSnapshotResponseSchema.safeParse(payload);
  return parsed.success ? (parsed.data?.user ?? null) : null;
}

function createClientError(input: {
  endpoint: string;
  message: string;
  operation: AuthDeviceSessionOperation;
  status?: number | null;
  cause?: unknown;
}): AuthDeviceSessionClientError {
  return new AuthDeviceSessionClientError(input);
}

function toAuthEndpoint(baseUrl: string, pathname: string): string {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function parseResponseJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}
