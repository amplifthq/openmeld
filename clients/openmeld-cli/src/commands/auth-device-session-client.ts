const DEFAULT_DEVICE_CLIENT_ID = "openmeld-cli";
const DEVICE_CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export type DeviceTokenSuccessResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

type DeviceTokenErrorResponse = {
  error?: string;
  error_description?: string;
  message?: string;
};

export type AuthUserSnapshot = {
  id?: string;
  email?: string;
  name?: string;
};

export async function requestDeviceToken(input: {
  authBaseUrl: string;
  clientId: string;
  deviceCode: string;
}): Promise<
  | { ok: true; data: DeviceTokenSuccessResponse }
  | { ok: false; error: DeviceTokenErrorResponse; status: number }
> {
  const endpoint = toAuthEndpoint(input.authBaseUrl, "/api/auth/device/token");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      grant_type: DEVICE_GRANT_TYPE,
      device_code: input.deviceCode,
      client_id: input.clientId,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const payload = await parseResponseJson(response);
  if (response.ok) {
    const accessToken = normalizeRequiredString(
      readStringField(payload, "access_token"),
      "missing access_token in device token response"
    );

    return {
      ok: true,
      data: {
        access_token: accessToken,
        token_type:
          normalizeOptionalString(readStringField(payload, "token_type")) ??
          undefined,
        expires_in: readNumberField(payload, "expires_in"),
        scope:
          normalizeOptionalString(readStringField(payload, "scope")) ??
          undefined,
      },
    };
  }

  return {
    ok: false,
    error: {
      error:
        normalizeOptionalString(readStringField(payload, "error")) ?? undefined,
      error_description:
        normalizeOptionalString(
          readStringField(payload, "error_description")
        ) ?? undefined,
      message:
        normalizeOptionalString(readStringField(payload, "message")) ??
        undefined,
    },
    status: response.status,
  };
}

export async function fetchAuthUserSnapshot(input: {
  authBaseUrl: string;
  accessToken: string;
}): Promise<AuthUserSnapshot | null> {
  const endpoint = toAuthEndpoint(input.authBaseUrl, "/api/auth/get-session");
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return null;
    }
    return readAuthUserFromSessionPayload(await parseResponseJson(response));
  } catch {
    return null;
  }
}

export async function revokeAuthAccessToken(input: {
  accessToken: string;
  authBaseUrl: string;
  tokenType: string;
}): Promise<boolean> {
  try {
    const response = await fetch(
      toAuthEndpoint(input.authBaseUrl, "/api/auth/sign-out"),
      {
        method: "POST",
        headers: {
          authorization: `${input.tokenType} ${input.accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
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
  const errorDescription = normalizeOptionalString(
    readStringField(payload, "error_description")
  );
  if (errorDescription) {
    return errorDescription;
  }
  const detail = normalizeOptionalString(readStringField(payload, "detail"));
  if (detail) {
    return detail;
  }
  const message = normalizeOptionalString(readStringField(payload, "message"));
  if (message) {
    return message;
  }
  const errorCode = normalizeOptionalString(readStringField(payload, "error"));
  return errorCode ?? `HTTP ${status}`;
}

export function readAuthUserFromSessionPayload(
  payload: unknown
): AuthUserSnapshot | null {
  if (!(payload && typeof payload === "object" && "user" in payload)) {
    return null;
  }
  const user = (payload as Record<string, unknown>).user;
  if (!(user && typeof user === "object")) {
    return null;
  }

  const userRecord = user as Record<string, unknown>;
  const id = readOptionalStringField(userRecord, "id");
  const email = readOptionalStringField(userRecord, "email");
  const name = readOptionalStringField(userRecord, "name");
  if (!(id || email || name)) {
    return null;
  }
  return {
    ...(id ? { id } : {}),
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
  };
}

function toAuthEndpoint(baseUrl: string, pathname: string): string {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeRequiredString(
  value: string | null,
  message: string
): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function normalizeOptionalString(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function readStringField(payload: unknown, key: string): string | null {
  if (!(payload && typeof payload === "object" && key in payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readOptionalStringField(
  payload: Record<string, unknown>,
  key: string
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumberField(payload: unknown, key: string): number | undefined {
  if (!(payload && typeof payload === "object" && key in payload)) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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
