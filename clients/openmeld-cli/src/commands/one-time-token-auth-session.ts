import {
  type AuthDeviceSessionClientError,
  extractAuthApiErrorMessage,
  fetchAuthUserSnapshot,
  readAuthUserFromSessionPayload,
  revokeAuthAccessToken,
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

  constructor(
    code: OneTimeTokenAuthFailureCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "OneTimeTokenAuthError";
    this.code = code;
  }
}

export type OneTimeTokenErrorDiagnostic = {
  cause?: OneTimeTokenErrorDiagnostic;
  code?: number | string;
  endpoint?: string;
  message: string;
  name: string;
  operation?: string;
  path?: string;
  stack?: string;
  status?: number | null;
};

export class OneTimeTokenCandidateSessionCleanupError extends OneTimeTokenAuthError {
  readonly cleanup: OneTimeTokenErrorDiagnostic;

  constructor(input: {
    cause: unknown;
    cleanupError: AuthDeviceSessionClientError;
    redactedValues?: readonly string[];
  }) {
    const redactedValues = input.redactedValues ?? [];
    const cleanup = createSanitizedErrorDiagnostic(
      input.cleanupError,
      redactedValues
    );
    const primary = createSanitizedErrorDiagnostic(input.cause, redactedValues);
    const safeCause =
      input.cause instanceof OneTimeTokenLocalSessionRecoveryError
        ? input.cause
        : createErrorFromDiagnostic(primary);
    const status =
      cleanup.status === null
        ? "network error"
        : `HTTP ${String(cleanup.status)}`;
    super(
      input.cause instanceof OneTimeTokenAuthError
        ? input.cause.code
        : "unknown",
      `${primary.message}; cleanup failed at ${cleanup.endpoint ?? "unknown endpoint"} (${status}): ${cleanup.message}`,
      { cause: safeCause }
    );
    this.name = "OneTimeTokenCandidateSessionCleanupError";
    this.cleanup = cleanup;
  }
}

export class OneTimeTokenLocalSessionRecoveryError extends OneTimeTokenAuthError {
  readonly primary: OneTimeTokenErrorDiagnostic;
  readonly recovery: OneTimeTokenErrorDiagnostic;

  constructor(input: {
    cause: unknown;
    recoveryError: unknown;
    redactedValues?: readonly string[];
  }) {
    const redactedValues = input.redactedValues ?? [];
    const primary = createSanitizedErrorDiagnostic(input.cause, redactedValues);
    const recovery = createSanitizedErrorDiagnostic(
      input.recoveryError,
      redactedValues
    );
    const aggregateCause = new AggregateError(
      [createErrorFromDiagnostic(primary), createErrorFromDiagnostic(recovery)],
      "one-time token local session recovery failed"
    );
    super(
      input.cause instanceof OneTimeTokenAuthError
        ? input.cause.code
        : "unknown",
      `${primary.message}; local session recovery failed: ${recovery.message}`,
      { cause: aggregateCause }
    );
    this.name = "OneTimeTokenLocalSessionRecoveryError";
    this.primary = primary;
    this.recovery = recovery;
  }
}

export async function rejectOneTimeTokenCandidateSession(input: {
  cause: unknown;
  session: {
    accessToken: string;
    authBaseUrl: string;
    tokenType: string;
  };
}): Promise<never> {
  const cleanup = await revokeAuthAccessToken(input.session);
  if (cleanup.ok) {
    throw input.cause;
  }
  throw new OneTimeTokenCandidateSessionCleanupError({
    cause: input.cause,
    cleanupError: cleanup.error,
    redactedValues: [input.session.accessToken],
  });
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

  try {
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
  } catch (error) {
    return await rejectOneTimeTokenCandidateSession({
      cause: error,
      session: {
        accessToken,
        authBaseUrl: input.authBaseUrl,
        tokenType: "Bearer",
      },
    });
  }
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

function createSanitizedErrorDiagnostic(
  error: unknown,
  redactedValues: readonly string[],
  seen = new Set<unknown>(),
  depth = 0
): OneTimeTokenErrorDiagnostic {
  if (depth >= 8) {
    return {
      message: "Nested error cause omitted after maximum diagnostic depth",
      name: "ErrorCauseDepthLimit",
    };
  }
  if (
    (typeof error === "object" && error !== null) ||
    typeof error === "function"
  ) {
    if (seen.has(error)) {
      return {
        message: "Circular error cause omitted",
        name: "CircularErrorCause",
      };
    }
    seen.add(error);
  }

  const record = isRecord(error) ? error : null;
  const name =
    error instanceof Error && error.name.trim()
      ? error.name.trim()
      : (readDiagnosticString(record?.name) ?? "Error");
  const diagnostic: OneTimeTokenErrorDiagnostic = {
    name: redactSensitiveText(name, redactedValues),
    message: redactSensitiveText(toErrorMessage(error), redactedValues),
  };
  const stack =
    error instanceof Error ? readDiagnosticString(error.stack) : undefined;
  if (stack) {
    diagnostic.stack = redactSensitiveText(stack, redactedValues);
  }
  copyDiagnosticString(record, diagnostic, "path", redactedValues);
  copyDiagnosticString(record, diagnostic, "endpoint", redactedValues);
  copyDiagnosticString(record, diagnostic, "operation", redactedValues);
  const code = record?.code;
  if (typeof code === "string" || typeof code === "number") {
    diagnostic.code =
      typeof code === "string"
        ? redactSensitiveText(code, redactedValues)
        : code;
  }
  const status = record?.status;
  if (status === null || typeof status === "number") {
    diagnostic.status = status;
  }
  if (record && "cause" in record && record.cause !== undefined) {
    diagnostic.cause = createSanitizedErrorDiagnostic(
      record.cause,
      redactedValues,
      seen,
      depth + 1
    );
  }
  return diagnostic;
}

function createErrorFromDiagnostic(
  diagnostic: OneTimeTokenErrorDiagnostic
): Error {
  const cause = diagnostic.cause
    ? createErrorFromDiagnostic(diagnostic.cause)
    : undefined;
  const error = new Error(
    diagnostic.message,
    cause === undefined ? undefined : { cause }
  );
  error.name = diagnostic.name;
  if (diagnostic.stack) {
    error.stack = diagnostic.stack;
  }
  const enriched = error as Error & {
    code?: number | string;
    endpoint?: string;
    operation?: string;
    path?: string;
    status?: number | null;
  };
  enriched.code = diagnostic.code;
  enriched.endpoint = diagnostic.endpoint;
  enriched.operation = diagnostic.operation;
  enriched.path = diagnostic.path;
  enriched.status = diagnostic.status;
  return enriched;
}

function copyDiagnosticString(
  source: Record<string, unknown> | null,
  target: OneTimeTokenErrorDiagnostic,
  key: "endpoint" | "operation" | "path",
  redactedValues: readonly string[]
): void {
  const value = readDiagnosticString(source?.[key]);
  if (value) {
    target[key] = redactSensitiveText(value, redactedValues);
  }
}

function readDiagnosticString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function redactSensitiveText(
  value: string,
  redactedValues: readonly string[]
): string {
  let redacted = value;
  for (const sensitiveValue of redactedValues) {
    if (sensitiveValue) {
      redacted = redacted.split(sensitiveValue).join("[REDACTED]");
    }
  }
  return redacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
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
