import {
  type AuthClaims,
  type AuthProfileKind,
  createUnauthenticatedClaims,
} from "../types/auth-claims";

export const OPENMELD_AUTH_HEADER_AUTHENTICATED = "x-openmeld-authenticated";
export const OPENMELD_AUTH_HEADER_CALLER_PRINCIPAL_ID =
  "x-openmeld-auth-caller-principal-id";
export const OPENMELD_AUTH_HEADER_PROFILE_ID = "x-openmeld-auth-profile-id";
export const OPENMELD_AUTH_HEADER_PROFILE_KIND = "x-openmeld-auth-profile-kind";
export const OPENMELD_AUTH_HEADER_OWNER_IDS = "x-openmeld-auth-owner-ids";
export const OPENMELD_AUTH_HEADER_METHOD = "x-openmeld-auth-method";
export const OPENMELD_AUTH_HEADER_REQUEST_ID = "x-openmeld-auth-request-id";

const MAX_HEADER_LENGTH = 256;

export function buildAuthClaimsHeaders(
  claims: AuthClaims
): Record<string, string> {
  const headers: Record<string, string> = {
    [OPENMELD_AUTH_HEADER_AUTHENTICATED]: claims.authenticated ? "1" : "0",
    [OPENMELD_AUTH_HEADER_METHOD]: claims.authMethod,
    [OPENMELD_AUTH_HEADER_REQUEST_ID]: claims.requestId,
  };

  if (claims.profileId) {
    headers[OPENMELD_AUTH_HEADER_PROFILE_ID] = claims.profileId;
  }

  if (claims.callerPrincipalId) {
    headers[OPENMELD_AUTH_HEADER_CALLER_PRINCIPAL_ID] =
      claims.callerPrincipalId;
  }

  if (claims.profileKind) {
    headers[OPENMELD_AUTH_HEADER_PROFILE_KIND] = claims.profileKind;
  }

  if (claims.ownerIds.length > 0) {
    headers[OPENMELD_AUTH_HEADER_OWNER_IDS] = claims.ownerIds.join(",");
  }

  return headers;
}

export function readAuthClaimsHeaders(
  headers: Headers,
  fallbackRequestId: string
): AuthClaims {
  const requestId =
    safeHeader(headers.get(OPENMELD_AUTH_HEADER_REQUEST_ID)) ??
    fallbackRequestId;
  const authenticated =
    safeHeader(headers.get(OPENMELD_AUTH_HEADER_AUTHENTICATED)) === "1";

  if (!authenticated) {
    return createUnauthenticatedClaims(requestId);
  }

  const profileId = safeHeader(headers.get(OPENMELD_AUTH_HEADER_PROFILE_ID));
  const callerPrincipalId = safeHeader(
    headers.get(OPENMELD_AUTH_HEADER_CALLER_PRINCIPAL_ID)
  );
  const profileKind = parseProfileKind(
    safeHeader(headers.get(OPENMELD_AUTH_HEADER_PROFILE_KIND))
  );

  if (!(profileId && profileKind)) {
    return createUnauthenticatedClaims(requestId);
  }

  const ownerIdsRaw = safeHeader(headers.get(OPENMELD_AUTH_HEADER_OWNER_IDS));
  const ownerIds = ownerIdsRaw
    ? ownerIdsRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  const method = safeHeader(headers.get(OPENMELD_AUTH_HEADER_METHOD));
  const authMethod =
    method === "session" || method === "api_key" ? method : "none";

  return {
    authenticated: true,
    requestId,
    ...(callerPrincipalId ? { callerPrincipalId } : {}),
    profileId,
    profileKind,
    ownerIds,
    authMethod,
  };
}

function safeHeader(value: string | null): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, MAX_HEADER_LENGTH);
}

function parseProfileKind(value: string | null): AuthProfileKind | null {
  if (value === "human" || value === "agent" || value === "system") {
    return value;
  }
  return null;
}
