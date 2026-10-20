import { createHash } from "node:crypto";
import {
  buildOpenMeldRequestContextHeaders,
  OPENMELD_HEADER_TASK_CREDENTIAL,
  type OpenMeldRequestContextHeadersInput,
  observeUserTimeZoneHeaders,
} from "@openmeld/gateway-contract";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import {
  type AuthRequestCompatibilityReason,
  resolveAuthRequestCompatibility,
} from "./auth-request-compatibility";
import {
  type AuthSessionStateReasonCode,
  getAuthSessionState,
  type StoredAuthSession,
} from "./auth-session";
import { resolveAuthSessionExpiryEligibility } from "./auth-session-expiry";
import type { OpenMeldProfile } from "./openmeld-profiles-api";
import {
  buildOpenMeldRequestContextFromProfile,
  buildOpenMeldRequestContextFromProfileIdentity,
  type OpenMeldRequestContextProfileIdentity,
} from "./openmeld-request-context";
import { readDispatchTaskCredentialHeader } from "./sensitive-operation-credentials";

const DEFAULT_TOKEN_TYPE = "Bearer";
const AUTHORIZATION_HEADER = "Authorization";

// Ephemeral correlation for the exact credential attached to a request/socket.
// Never include this fingerprint in persisted or uploaded diagnostics.
export function fingerprintRequestAuthorization(authorization: string): string {
  return createHash("sha256").update(authorization).digest("hex");
}

type RequestAuthHeadersInput = {
  authSession?: StoredAuthSession | null;
  expectedOwnerUserId?: string;
  requestUrl: string;
};

type OpenMeldRequestContextHeadersWithAuthInput =
  OpenMeldRequestContextHeadersInput & {
    authSession?: StoredAuthSession | null;
    requestUrl: string;
  };

export type AuthTokenAttachment =
  | {
      status: "attachable";
      token: string;
      tokenType: string;
    }
  | {
      status: "dropped";
      reason:
        | "empty_token"
        | "session_expired"
        | "session_expiry_invalid"
        | AuthRequestCompatibilityReason;
      requestHost: string | null;
      authHost: string | null;
      expectedGatewayHost: string | null;
    };

export type DroppedAuthTokenAttachment = Extract<
  AuthTokenAttachment,
  { status: "dropped" }
>;

export type AuthRequestCredentialFailureReason =
  | DroppedAuthTokenAttachment["reason"]
  | AuthSessionStateReasonCode
  | "session_invalid"
  | "session_revoked";

export class AuthRequestCredentialError extends Error {
  readonly retryAfterMs?: number;
  readonly authHost: string | null;
  readonly expectedGatewayHost: string | null;
  readonly reason: AuthRequestCredentialFailureReason;
  readonly requestHost: string | null;
  readonly droppedAttachment?: DroppedAuthTokenAttachment;

  constructor(input: {
    retryAfterMs?: number;
    authHost: string | null;
    expectedGatewayHost: string | null;
    reason: AuthRequestCredentialFailureReason;
    requestHost: string | null;
    droppedAttachment?: DroppedAuthTokenAttachment;
  }) {
    super(
      `OpenMeld refused to send a request with unusable stored credentials (${input.reason}).`
    );
    this.name = "AuthRequestCredentialError";
    this.authHost = input.authHost;
    this.expectedGatewayHost = input.expectedGatewayHost;
    this.reason = input.reason;
    this.requestHost = input.requestHost;
    this.droppedAttachment = input.droppedAttachment;
    this.retryAfterMs = input.retryAfterMs;
  }
}

export async function buildRequestAuthHeaders(
  input: RequestAuthHeadersInput
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  await attachAuthHeader(headers, input);
  Object.assign(headers, observeUserTimeZoneHeaders("service"));
  return headers;
}

export async function buildOpenMeldRequestContextHeadersWithAuth(
  input: OpenMeldRequestContextHeadersWithAuthInput
): Promise<Record<string, string>> {
  const headers = buildOpenMeldRequestContextHeaders(input);
  await attachAuthHeader(headers, input);
  Object.assign(headers, observeUserTimeZoneHeaders("service"));
  return headers;
}

export async function buildOpenMeldProfileRequestHeadersWithAuth(input: {
  openMeldProfile: OpenMeldProfile;
  requestUrl: string;
  authSession?: StoredAuthSession | null;
  agentControllerConversationId?: string;
  spacePassword?: string;
}): Promise<Record<string, string>> {
  return await buildOpenMeldRequestContextHeadersWithAuth({
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: input.openMeldProfile,
      agentControllerConversationId: input.agentControllerConversationId,
    }),
    requestUrl: input.requestUrl,
    ...(input.authSession === undefined
      ? {}
      : { authSession: input.authSession }),
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
  });
}

export async function buildOpenMeldProfileIdentityRequestHeadersWithAuth(input: {
  profileIdentity: OpenMeldRequestContextProfileIdentity;
  requestUrl: string;
  authSession?: StoredAuthSession | null;
  spacePassword?: string;
}): Promise<Record<string, string>> {
  return await buildOpenMeldRequestContextHeadersWithAuth({
    requestContext: buildOpenMeldRequestContextFromProfileIdentity({
      profileIdentity: input.profileIdentity,
    }),
    requestUrl: input.requestUrl,
    ...(input.authSession === undefined
      ? {}
      : { authSession: input.authSession }),
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
  });
}

export function withSpacePassword(
  requestContext: OpenMeldRequestContext,
  spacePassword?: string
): OpenMeldRequestContextHeadersInput {
  return {
    requestContext,
    ...(spacePassword === undefined ? {} : { spacePassword }),
  };
}

// One decision for "can this stored session authenticate this request", with
// the drop reason preserved. Header building and the daemon stream connect
// gate must share this so they cannot drift apart.
export function resolveAuthTokenAttachment(input: {
  session: StoredAuthSession;
  requestUrl: string;
}): AuthTokenAttachment {
  const compatibility = resolveAuthRequestCompatibility({
    session: input.session,
    requestUrl: input.requestUrl,
  });
  const token = normalizeAccessToken(input.session);
  if (!token) {
    return {
      status: "dropped",
      reason: "empty_token",
      requestHost: compatibility.requestHost,
      authHost: compatibility.authHost,
      expectedGatewayHost: compatibility.expectedGatewayHost,
    };
  }
  if (!compatibility.compatible) {
    return {
      status: "dropped",
      reason: compatibility.reason,
      requestHost: compatibility.requestHost,
      authHost: compatibility.authHost,
      expectedGatewayHost: compatibility.expectedGatewayHost,
    };
  }
  const expiryReason = resolveSessionExpiryReason(input.session);
  if (expiryReason) {
    return {
      status: "dropped",
      reason: expiryReason,
      requestHost: compatibility.requestHost,
      authHost: compatibility.authHost,
      expectedGatewayHost: compatibility.expectedGatewayHost,
    };
  }
  return {
    status: "attachable",
    token,
    tokenType: normalizeTokenType(input.session.tokenType),
  };
}

export function requireAuthTokenAttachment(input: {
  session: StoredAuthSession;
  requestUrl: string;
}): Extract<AuthTokenAttachment, { status: "attachable" }> {
  const attachment = resolveAuthTokenAttachment(input);
  if (attachment.status === "dropped") {
    throw createAuthRequestCredentialError(attachment);
  }
  return attachment;
}

async function attachAuthHeader(
  headers: Record<string, string>,
  input: RequestAuthHeadersInput
): Promise<void> {
  const session = await resolveAuthSessionForHeaders(input);
  if (
    input.expectedOwnerUserId &&
    session?.user?.id !== input.expectedOwnerUserId
  ) {
    throw new Error("auth.session_owner_changed");
  }
  if (session === null) {
    // No stored credentials exist, so there is nothing to strip: the caller
    // is knowingly sending an unauthenticated request.
    return;
  }

  let attachment: Extract<AuthTokenAttachment, { status: "attachable" }>;
  try {
    attachment = requireAuthTokenAttachment({
      session,
      requestUrl: input.requestUrl,
    });
  } catch (error) {
    if (error instanceof AuthRequestCredentialError) {
      logRejectedAuthRequestCredential(error);
    }
    throw error;
  }
  headers[AUTHORIZATION_HEADER] = `${attachment.tokenType} ${attachment.token}`;
  // Inside a Wake, Core decides sensitive operations by the task's root.
  const taskCredential = readDispatchTaskCredentialHeader();
  if (taskCredential) {
    headers[OPENMELD_HEADER_TASK_CREDENTIAL] = taskCredential;
  }
}

function logRejectedAuthRequestCredential(
  error: AuthRequestCredentialError
): void {
  console.error("[openmeld.auth.request_credential_rejected]", {
    authHost: error.authHost,
    expectedGatewayHost: error.expectedGatewayHost,
    reason: error.reason,
    requestHost: error.requestHost,
  });
}

async function resolveAuthSessionForHeaders(
  input: RequestAuthHeadersInput
): Promise<StoredAuthSession | null> {
  if (input.authSession !== undefined) {
    return input.authSession;
  }

  const sessionState = await getAuthSessionState({ refreshExpired: true });
  if (sessionState.state === "missing") {
    return null;
  }
  if (sessionState.state !== "valid" || sessionState.session === null) {
    const error = new AuthRequestCredentialError({
      retryAfterMs: sessionState.retryAfterMs,
      authHost: null,
      expectedGatewayHost: null,
      reason:
        sessionState.reasonCode ??
        (sessionState.state === "revoked"
          ? "session_revoked"
          : "session_invalid"),
      requestHost: parseRequestHost(input.requestUrl),
    });
    logRejectedAuthRequestCredential(error);
    throw error;
  }

  return sessionState.session;
}

function createAuthRequestCredentialError(
  attachment: DroppedAuthTokenAttachment
): AuthRequestCredentialError {
  return new AuthRequestCredentialError({
    authHost: attachment.authHost,
    expectedGatewayHost: attachment.expectedGatewayHost,
    reason: attachment.reason,
    requestHost: attachment.requestHost,
    droppedAttachment: attachment,
  });
}

function parseRequestHost(requestUrl: string): string | null {
  try {
    return new URL(requestUrl).host || null;
  } catch {
    return null;
  }
}

function normalizeAccessToken(session: StoredAuthSession): string {
  return String(session.accessToken ?? "").trim();
}

function normalizeTokenType(tokenType: string | undefined): string {
  const normalized = String(tokenType ?? "").trim();
  return normalized.length > 0 ? normalized : DEFAULT_TOKEN_TYPE;
}

function resolveSessionExpiryReason(
  session: StoredAuthSession
): "session_expired" | "session_expiry_invalid" | null {
  const eligibility = resolveAuthSessionExpiryEligibility(session.expiresAt);
  if (eligibility.status === "invalid") {
    return "session_expiry_invalid";
  }
  return eligibility.status === "expired" ? "session_expired" : null;
}

export function canAttachAuthTokenToRequest(
  session: StoredAuthSession,
  requestUrl: string
): boolean {
  return (
    resolveAuthTokenAttachment({
      session,
      requestUrl,
    }).status === "attachable"
  );
}
