import {
  MAX_PROFILE_ID_LENGTH,
  MAX_VISITED_PROFILE_IDS,
  normalizeSpacePasswordText,
  openMeldRequestContextSchema,
  openMeldRequestedOrganizationSelectorSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  OpenMeldRequestedOrganizationSelector,
} from "@openmeld/schemas/types";

export type { OpenMeldRequestedOrganizationSelector } from "@openmeld/schemas/types";

export type OpenMeldRequestContextHeadersInput = {
  requestContext: OpenMeldRequestContext;
  spacePassword?: string;
};

export const OPENMELD_HEADER_REQUEST_ID = "x-openmeld-request-id";
export const OPENMELD_HEADER_CALLER_PRINCIPAL_ID =
  "x-openmeld-caller-principal-id";
export const OPENMELD_HEADER_PROFILE_ID = "x-openmeld-profile-id";
export const OPENMELD_HEADER_PROFILE_KIND = "x-openmeld-profile-kind";
export const OPENMELD_HEADER_PROFILE_HANDLE = "x-openmeld-profile-handle";
export const OPENMELD_HEADER_PROFILE_NAME = "x-openmeld-profile-name";
export const OPENMELD_HEADER_OWNER_USER_ID = "x-openmeld-owner-user-id";
export const OPENMELD_HEADER_OWNER_NAME = "x-openmeld-owner-name";
export const OPENMELD_HEADER_AVATAR_URL = "x-openmeld-avatar-url";
export const OPENMELD_HEADER_SPACE_PASSWORD = "x-openmeld-space-password";
export const OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID =
  "x-openmeld-active-organization-id";
export const OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID =
  "x-openmeld-requested-organization-id";
export const OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG =
  "x-openmeld-requested-organization-slug";
export const OPENMELD_HEADER_AGENT_CONTROLLER_REF =
  "x-openmeld-agent-controller-ref";
export const OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID =
  "x-openmeld-agent-controller-conversation-id";
export const OPENMELD_HEADER_DISPATCH_CHAIN_ID = "x-openmeld-dispatch-chain-id";
export const OPENMELD_HEADER_AUTO_RELAY_DEPTH = "x-openmeld-auto-relay-depth";
export const OPENMELD_HEADER_VISITED_PROFILE_IDS =
  "x-openmeld-visited-profile-ids";
export const OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH =
  "x-openmeld-visited-profile-ids-hash";
export const OPENMELD_HEADER_FORWARDED_BY = "x-openmeld-forwarded-by";
export const OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION =
  "x-openmeld-inbox-source-target-version";
export const OPENMELD_INBOX_SOURCE_TARGET_VERSION = "3";
export const OPENMELD_EXPECTED_FORWARDED_BY = "openmeld-gateway";

const MAX_HEADER_LENGTH = 128;
// Upper bound for raw header text accepted before decoding. A maximum-length
// profile label (64 chars) percent-encodes to at most 64 * 9 + 7 = 583 chars,
// so 1024 leaves headroom without admitting unbounded input.
const MAX_ENCODED_HEADER_LENGTH = 1024;
// Avatar URLs are http(s) ASCII strings far longer than a profile label, so
// they need a dedicated bound instead of the generic single-value cap (which
// would truncate the URL at 128 chars). Mirrors MAX_AVATAR_URL_LENGTH (2048)
// in the schemas package; downstream profile schemas re-validate the value.
const MAX_AVATAR_URL_HEADER_LENGTH = 2048;
// RFC 8187 ext-value marker for header text carried as percent-encoded UTF-8.
const OPENMELD_HEADER_TEXT_ENCODING_PREFIX = "utf-8''";
// x-openmeld-visited-profile-ids joins up to MAX_VISITED_PROFILE_IDS profile IDs
// (visitedProfileIdsSchema) of up to MAX_PROFILE_ID_LENGTH chars each with
// comma separators, so its decoded bound is sized from the schema limits
// instead of the generic single-value cap (which truncates the list after
// three agt_<uuid> entries).
const MAX_PROFILE_ID_LIST_HEADER_LENGTH =
  MAX_VISITED_PROFILE_IDS * MAX_PROFILE_ID_LENGTH +
  (MAX_VISITED_PROFILE_IDS - 1);
// Profile IDs are ASCII, so percent-encoding expands only the comma
// separators (3 chars each) plus the ext-value marker.
const MAX_ENCODED_PROFILE_ID_LIST_HEADER_LENGTH =
  MAX_VISITED_PROFILE_IDS * MAX_PROFILE_ID_LENGTH +
  (MAX_VISITED_PROFILE_IDS - 1) * 3 +
  OPENMELD_HEADER_TEXT_ENCODING_PREFIX.length;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]*$/;
const OPENMELD_MANAGED_REQUEST_CONTEXT_HEADERS = [
  OPENMELD_HEADER_REQUEST_ID,
  OPENMELD_HEADER_CALLER_PRINCIPAL_ID,
  OPENMELD_HEADER_PROFILE_ID,
  OPENMELD_HEADER_PROFILE_KIND,
  OPENMELD_HEADER_PROFILE_HANDLE,
  OPENMELD_HEADER_PROFILE_NAME,
  OPENMELD_HEADER_OWNER_USER_ID,
  OPENMELD_HEADER_OWNER_NAME,
  OPENMELD_HEADER_AVATAR_URL,
  OPENMELD_HEADER_SPACE_PASSWORD,
  OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID,
  OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID,
  OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG,
  OPENMELD_HEADER_AGENT_CONTROLLER_REF,
  OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID,
  OPENMELD_HEADER_DISPATCH_CHAIN_ID,
  OPENMELD_HEADER_AUTO_RELAY_DEPTH,
  OPENMELD_HEADER_VISITED_PROFILE_IDS,
  OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH,
  OPENMELD_HEADER_FORWARDED_BY,
] as const;

export function readOpenMeldRequestedOrganizationSelector(
  headers: Headers
): OpenMeldRequestedOrganizationSelector | null {
  const organizationId = safeHeader(
    headers.get(OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID)
  );
  const organizationSlug = safeHeader(
    headers.get(OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG)
  );
  if (!(organizationId || organizationSlug)) {
    return null;
  }
  return openMeldRequestedOrganizationSelectorSchema.parse({
    ...(organizationId ? { organizationId } : {}),
    ...(organizationSlug ? { organizationSlug } : {}),
  });
}

/**
 * Fetch header values are ByteStrings: undici and workerd throw a TypeError
 * for any code point above 0xff, so user-authored text (profile names, owner
 * names, Space passwords) cannot ride x-openmeld-* headers raw. Values that are
 * not printable ASCII travel RFC 8187-style as `utf-8''<percent-encoded>`;
 * printable-ASCII values pass through unchanged, keeping the wire format of
 * machine identifiers identical to older writers.
 */
export function encodeOpenMeldHeaderText(value: string): string {
  if (
    PRINTABLE_ASCII_PATTERN.test(value) &&
    !value.startsWith(OPENMELD_HEADER_TEXT_ENCODING_PREFIX)
  ) {
    return value;
  }
  return `${OPENMELD_HEADER_TEXT_ENCODING_PREFIX}${encodeURIComponent(value)}`;
}

export function decodeOpenMeldHeaderText(value: string): string {
  if (!value.startsWith(OPENMELD_HEADER_TEXT_ENCODING_PREFIX)) {
    return value;
  }
  const encoded = value.slice(OPENMELD_HEADER_TEXT_ENCODING_PREFIX.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    // Not produced by encodeOpenMeldHeaderText (e.g. truncated by a foreign hop);
    // surface the raw value instead of dropping the field.
    return value;
  }
}

export function readOpenMeldRequestContext(
  headers: Headers,
  fallbackRequestId: string
): OpenMeldRequestContext | null {
  const requestId =
    safeHeader(headers.get(OPENMELD_HEADER_REQUEST_ID)) ?? fallbackRequestId;
  const openMeldProfileId = safeHeader(headers.get(OPENMELD_HEADER_PROFILE_ID));
  const profileKind = parseProfileKind(
    safeHeader(headers.get(OPENMELD_HEADER_PROFILE_KIND))
  );
  if (!(openMeldProfileId && profileKind)) {
    return null;
  }

  const parsed = openMeldRequestContextSchema.safeParse({
    actorContext: {
      requestId,
      ...(safeHeader(headers.get(OPENMELD_HEADER_CALLER_PRINCIPAL_ID))
        ? {
            callerPrincipalId: safeHeader(
              headers.get(OPENMELD_HEADER_CALLER_PRINCIPAL_ID)
            ),
          }
        : {}),
      openMeldProfileId,
      profileKind,
      ...(safeHeader(headers.get(OPENMELD_HEADER_PROFILE_HANDLE))
        ? {
            profileHandle: safeHeader(
              headers.get(OPENMELD_HEADER_PROFILE_HANDLE)
            ),
          }
        : {}),
      ...(safeHeader(headers.get(OPENMELD_HEADER_PROFILE_NAME))
        ? { profileName: safeHeader(headers.get(OPENMELD_HEADER_PROFILE_NAME)) }
        : {}),
      ...(safeHeader(headers.get(OPENMELD_HEADER_OWNER_USER_ID))
        ? {
            ownerUserId: safeHeader(headers.get(OPENMELD_HEADER_OWNER_USER_ID)),
          }
        : {}),
      ...(safeHeader(headers.get(OPENMELD_HEADER_OWNER_NAME))
        ? { ownerName: safeHeader(headers.get(OPENMELD_HEADER_OWNER_NAME)) }
        : {}),
      ...(readAvatarUrlHeader(headers.get(OPENMELD_HEADER_AVATAR_URL))
        ? {
            avatarUrl: readAvatarUrlHeader(
              headers.get(OPENMELD_HEADER_AVATAR_URL)
            ),
          }
        : {}),
      ...(safeHeader(headers.get(OPENMELD_HEADER_AGENT_CONTROLLER_REF))
        ? {
            agentControllerRef: safeHeader(
              headers.get(OPENMELD_HEADER_AGENT_CONTROLLER_REF)
            ),
          }
        : {}),
      ...(safeHeader(headers.get(OPENMELD_HEADER_DISPATCH_CHAIN_ID))
        ? {
            dispatchChainId: safeHeader(
              headers.get(OPENMELD_HEADER_DISPATCH_CHAIN_ID)
            ),
          }
        : {}),
      ...(typeof parseOptionalNonNegativeIntHeader(
        headers.get(OPENMELD_HEADER_AUTO_RELAY_DEPTH)
      ) === "number"
        ? {
            autoRelayDepth: parseOptionalNonNegativeIntHeader(
              headers.get(OPENMELD_HEADER_AUTO_RELAY_DEPTH)
            ),
          }
        : {}),
      ...(parseOptionalProfileIdListHeader(
        headers.get(OPENMELD_HEADER_VISITED_PROFILE_IDS)
      ).length > 0
        ? {
            visitedProfileIds: parseOptionalProfileIdListHeader(
              headers.get(OPENMELD_HEADER_VISITED_PROFILE_IDS)
            ),
          }
        : {}),
      ...(safeHeader(headers.get(OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH))
        ? {
            visitedProfileIdsHash: safeHeader(
              headers.get(OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH)
            ),
          }
        : {}),
    },
    ...(safeHeader(headers.get(OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID))
      ? {
          activeOrganizationId: safeHeader(
            headers.get(OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID)
          ),
        }
      : {}),
    ...(safeHeader(
      headers.get(OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID)
    )
      ? {
          agentControllerConversationId: safeHeader(
            headers.get(OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID)
          ),
        }
      : {}),
  });

  return parsed.success ? parsed.data : null;
}

export function buildOpenMeldRequestContextHeaders(
  input: OpenMeldRequestContextHeadersInput
): Record<string, string> {
  const { actorContext } = input.requestContext;
  const headers: Record<string, string> = {
    [OPENMELD_HEADER_REQUEST_ID]: actorContext.requestId,
    [OPENMELD_HEADER_PROFILE_ID]: actorContext.openMeldProfileId,
    [OPENMELD_HEADER_PROFILE_KIND]: actorContext.profileKind,
  };

  const callerPrincipalId = normalize(actorContext.callerPrincipalId);
  if (callerPrincipalId) {
    headers[OPENMELD_HEADER_CALLER_PRINCIPAL_ID] = callerPrincipalId;
  }

  const profileHandle = normalize(actorContext.profileHandle);
  if (profileHandle) {
    headers[OPENMELD_HEADER_PROFILE_HANDLE] = profileHandle;
  }

  const profileName = normalize(actorContext.profileName);
  if (profileName) {
    headers[OPENMELD_HEADER_PROFILE_NAME] = profileName;
  }

  const ownerUserId = normalize(actorContext.ownerUserId);
  if (ownerUserId) {
    headers[OPENMELD_HEADER_OWNER_USER_ID] = ownerUserId;
  }

  const ownerName = normalize(actorContext.ownerName);
  if (ownerName) {
    headers[OPENMELD_HEADER_OWNER_NAME] = ownerName;
  }

  const avatarUrl = normalize(actorContext.avatarUrl);
  if (avatarUrl) {
    headers[OPENMELD_HEADER_AVATAR_URL] = avatarUrl;
  }

  const agentControllerRef = normalize(actorContext.agentControllerRef);
  if (agentControllerRef) {
    headers[OPENMELD_HEADER_AGENT_CONTROLLER_REF] = agentControllerRef;
  }

  const agentControllerConversationId = normalize(
    input.requestContext.agentControllerConversationId
  );
  if (agentControllerConversationId) {
    headers[OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID] =
      agentControllerConversationId;
  }

  const activeOrganizationId = normalize(
    input.requestContext.activeOrganizationId
  );
  if (activeOrganizationId) {
    headers[OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID] = activeOrganizationId;
  }

  const dispatchChainId = normalize(actorContext.dispatchChainId);
  if (dispatchChainId) {
    headers[OPENMELD_HEADER_DISPATCH_CHAIN_ID] = dispatchChainId;
  }

  if (
    Number.isInteger(actorContext.autoRelayDepth) &&
    (actorContext.autoRelayDepth ?? -1) >= 0
  ) {
    headers[OPENMELD_HEADER_AUTO_RELAY_DEPTH] = String(
      actorContext.autoRelayDepth
    );
  }

  const visitedProfileIds = normalizeProfileIdList(
    actorContext.visitedProfileIds
  );
  if (visitedProfileIds.length > 0) {
    headers[OPENMELD_HEADER_VISITED_PROFILE_IDS] = visitedProfileIds.join(",");
  }

  const visitedProfileIdsHash = normalize(actorContext.visitedProfileIdsHash);
  if (visitedProfileIdsHash) {
    headers[OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH] = visitedProfileIdsHash;
  }

  if (input.spacePassword !== undefined) {
    const spacePassword = normalizeSpacePasswordText(input.spacePassword);
    if (spacePassword.length > 0) {
      headers[OPENMELD_HEADER_SPACE_PASSWORD] = spacePassword;
    }
  }

  return encodeHeaderValues(headers);
}

function encodeHeaderValues(
  headers: Record<string, string>
): Record<string, string> {
  const encoded: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    encoded[key] = encodeOpenMeldHeaderText(value);
  }
  return encoded;
}

export function applyOpenMeldRequestContextHeaders(
  target: Headers,
  input: OpenMeldRequestContextHeadersInput,
  forwardedBy = OPENMELD_EXPECTED_FORWARDED_BY
): Headers {
  for (const key of OPENMELD_MANAGED_REQUEST_CONTEXT_HEADERS) {
    target.delete(key);
  }

  const headers = buildOpenMeldRequestContextHeaders(input);
  for (const [key, value] of Object.entries(headers)) {
    target.set(key, value);
  }
  target.set(OPENMELD_HEADER_FORWARDED_BY, forwardedBy);
  return target;
}

function safeHeader(
  value: string | null,
  {
    maxEncodedLength = MAX_ENCODED_HEADER_LENGTH,
    maxLength = MAX_HEADER_LENGTH,
  }: { maxEncodedLength?: number; maxLength?: number } = {}
): string | null {
  const normalized = normalize(value);
  if (!normalized) {
    return null;
  }
  // Decode before capping: an encoded CJK label is up to 9x its decoded
  // length, so the maxLength cap applies to the decoded text.
  const decoded = decodeOpenMeldHeaderText(
    normalized.slice(0, maxEncodedLength)
  ).trim();
  if (!decoded) {
    return null;
  }
  return decoded.slice(0, maxLength);
}

function readAvatarUrlHeader(value: string | null): string | null {
  // Avatar URLs exceed the generic single-value header bounds; cap them at the
  // avatar-specific length so the URL survives the round trip intact. Validity
  // (http(s) scheme, final length) is enforced by the downstream profile schema.
  return safeHeader(value, {
    maxEncodedLength: MAX_AVATAR_URL_HEADER_LENGTH,
    maxLength: MAX_AVATAR_URL_HEADER_LENGTH,
  });
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function parseOptionalNonNegativeIntHeader(
  value: string | null
): number | null {
  const normalized = safeHeader(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseOptionalProfileIdListHeader(value: string | null): string[] {
  // The joined list is far longer than any single-value header: the generic
  // bounds would truncate a relay chain after three visited profile IDs and
  // corrupt the trailing entry, failing the whole context parse downstream.
  const normalized = safeHeader(value, {
    maxEncodedLength: MAX_ENCODED_PROFILE_ID_LIST_HEADER_LENGTH,
    maxLength: MAX_PROFILE_ID_LIST_HEADER_LENGTH,
  });
  if (!normalized) {
    return [];
  }
  return normalizeProfileIdList(normalized.split(","));
}

function normalizeProfileIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalize(item)).filter((item) => item.length > 0);
}

function parseProfileKind(
  value: string | null
): "human" | "agent" | "system" | null {
  if (value === "human" || value === "agent" || value === "system") {
    return value;
  }
  return null;
}
