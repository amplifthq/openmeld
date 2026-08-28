import {
  extractAuthApiErrorMessage,
  fetchAuthUserSnapshot,
  readAuthUserFromSessionPayload,
} from "./auth-device-session-client";
import type { PreparedAuthSession } from "./prepared-auth-session";

export type OneTimeTokenAuthFailureCode =
  | "invalid_token"
  | "expired_token"
  | "missing_access_token"
  | "session_not_saved"
  | "unknown";

export class OneTimeTokenAuthError extends Error {
  readonly code: OneTimeTokenAuthFailureCode;

  constructor(code: OneTimeTokenAuthFailureCode, message: string) {
    super(message);
    this.name = "OneTimeTokenAuthError";
    this.code = code;
  }
}

export async function exchangeOneTimeTokenAuthSession(input: {
  authBaseUrl: string;
  clientId: string;
  token: string;
}): Promise<PreparedAuthSession> {
  const endpoint = toAuthEndpoint(
    input.authBaseUrl,
    "/api/auth/one-time-token/verify"
  );
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: input.token }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new OneTimeTokenAuthError(
      "unknown",
      `one-time token verification request failed at ${endpoint}: ${toErrorMessage(error)}`
    );
  }
  const payload = await parseResponseJson(response);
  if (!response.ok) {
    throw mapOneTimeTokenHttpError(payload, response.status);
  }

  const accessToken = normalizeOptionalString(
    response.headers.get("set-auth-token")
  );
  if (!accessToken) {
    throw new OneTimeTokenAuthError(
      "missing_access_token",
      "one-time token verified but auth response is missing set-auth-token"
    );
  }

  const user =
    readAuthUserFromSessionPayload(payload) ??
    (await fetchAuthUserSnapshot({
      authBaseUrl: input.authBaseUrl,
      accessToken,
    }));
  const userId = normalizeOptionalString(user.id);
  if (!userId) {
    throw new OneTimeTokenAuthError(
      "unknown",
      "one-time token account response did not include a user id"
    );
  }

  return {
    accessToken,
    tokenType: "Bearer",
    authBaseUrl: input.authBaseUrl,
    clientId: input.clientId,
    ...readSessionExpiresAtFromPayload(payload),
    user: {
      ...user,
      id: userId,
    },
  };
}

function mapOneTimeTokenHttpError(
  payload: unknown,
  status: number
): OneTimeTokenAuthError {
  const message = extractAuthApiErrorMessage(payload, status);
  const normalizedMessage = message.toLowerCase();
  if (normalizedMessage.includes("expired")) {
    return new OneTimeTokenAuthError(
      "expired_token",
      "one-time token expired; generate a new token and retry"
    );
  }
  if (normalizedMessage.includes("session not found")) {
    return new OneTimeTokenAuthError(
      "expired_token",
      "one-time token session is no longer valid; sign in to OpenMeld Web again, copy a fresh command, and retry"
    );
  }
  if (normalizedMessage.includes("invalid")) {
    return new OneTimeTokenAuthError(
      "invalid_token",
      "invalid one-time token; generate a new token and retry"
    );
  }
  return new OneTimeTokenAuthError(
    "unknown",
    `one-time token verification failed: ${message}`
  );
}

function readSessionExpiresAtFromPayload(payload: unknown): {
  expiresAt?: string;
} {
  if (!(payload && typeof payload === "object" && "session" in payload)) {
    return {};
  }
  const session = (payload as Record<string, unknown>).session;
  if (!(session && typeof session === "object")) {
    return {};
  }
  const raw = normalizeOptionalString(
    (session as Record<string, unknown>).expiresAt
  );
  if (!raw) {
    return {};
  }
  const expiresAtMs = Date.parse(raw);
  return Number.isNaN(expiresAtMs)
    ? {}
    : { expiresAt: new Date(expiresAtMs).toISOString() };
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error ?? "unknown error");
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
