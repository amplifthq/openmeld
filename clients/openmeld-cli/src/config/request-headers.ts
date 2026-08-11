import {
  buildOpenMeldRequestContextHeaders,
  type OpenMeldRequestContextHeadersInput,
} from "@openmeld/gateway-contract";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import {
  type AuthRequestCompatibilityReason,
  canUseAuthSessionForRequest,
  resolveAuthRequestCompatibility,
} from "./auth-request-compatibility";
import { getAuthSessionState, type StoredAuthSession } from "./auth-session";
import type { OpenMeldProfile } from "./openmeld-profiles-api";
import {
  buildOpenMeldRequestContextFromProfile,
  buildOpenMeldRequestContextFromProfileIdentity,
  type OpenMeldRequestContextProfileIdentity,
} from "./openmeld-request-context";

const DEFAULT_TOKEN_TYPE = "Bearer";
const AUTHORIZATION_HEADER = "Authorization";

type RequestAuthHeadersInput = {
  authSession?: StoredAuthSession | null;
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
      reason: "empty_token" | AuthRequestCompatibilityReason;
      requestHost: string | null;
      authHost: string | null;
      expectedGatewayHost: string | null;
    };

export type DroppedAuthTokenAttachment = Extract<
  AuthTokenAttachment,
  { status: "dropped" }
>;

export async function buildRequestAuthHeaders(
  input: RequestAuthHeadersInput
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  await attachAuthHeader(headers, input);
  return headers;
}

export async function buildOpenMeldRequestContextHeadersWithAuth(
  input: OpenMeldRequestContextHeadersWithAuthInput
): Promise<Record<string, string>> {
  const headers = buildOpenMeldRequestContextHeaders(input);
  await attachAuthHeader(headers, input);
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
  return {
    status: "attachable",
    token,
    tokenType: normalizeTokenType(input.session.tokenType),
  };
}

async function attachAuthHeader(
  headers: Record<string, string>,
  input: RequestAuthHeadersInput
): Promise<void> {
  const session = await resolveAuthSessionForHeaders(input);
  if (session === null) {
    // No stored credentials exist, so there is nothing to strip: the caller
    // is knowingly sending an unauthenticated request.
    return;
  }

  const attachment = resolveAuthTokenAttachment({
    session,
    requestUrl: input.requestUrl,
  });
  if (attachment.status === "dropped") {
    // The caller holds a session it believes is usable. Dropping the token is
    // still the safe outcome (never leak credentials to an incompatible
    // host), but it must stay visible in diagnostics instead of silently
    // dialing bare and surfacing as a remote 401.
    warnDroppedAuthToken(attachment);
    return;
  }
  headers[AUTHORIZATION_HEADER] = `${attachment.tokenType} ${attachment.token}`;
}

function warnDroppedAuthToken(attachment: DroppedAuthTokenAttachment): void {
  console.warn("[openmeld.auth.request_token_dropped]", {
    authHost: attachment.authHost,
    expectedGatewayHost: attachment.expectedGatewayHost,
    reason: attachment.reason,
    requestHost: attachment.requestHost,
  });
}

async function resolveAuthSessionForHeaders(
  input: RequestAuthHeadersInput
): Promise<StoredAuthSession | null> {
  if (input.authSession !== undefined) {
    return input.authSession;
  }

  const sessionState = await getAuthSessionState();
  if (sessionState.state !== "valid" || sessionState.session === null) {
    return null;
  }

  return sessionState.session;
}

function normalizeAccessToken(session: StoredAuthSession): string {
  return String(session.accessToken ?? "").trim();
}

function normalizeTokenType(tokenType: string | undefined): string {
  const normalized = String(tokenType ?? "").trim();
  return normalized.length > 0 ? normalized : DEFAULT_TOKEN_TYPE;
}

export function canAttachAuthTokenToRequest(
  session: StoredAuthSession,
  requestUrl: string
): boolean {
  return canUseAuthSessionForRequest({
    session,
    requestUrl,
  });
}
