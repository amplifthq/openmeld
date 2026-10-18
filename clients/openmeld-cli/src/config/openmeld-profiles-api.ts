import { OPENMELD_HEADER_TASK_CREDENTIAL } from "@openmeld/gateway-contract";
import {
  ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
  authProfileManagedRoleSchema,
  profileCapabilitiesResponseSchema,
  profileErrorResponseSchema,
} from "@openmeld/schemas";
import type { z } from "zod/v4";
import {
  createAuthenticationError,
  resolveAuthenticationReasonFromState,
} from "../auth/auth-guidance";
import { touchDaemonCatalogSyncSignal } from "../local-service/state/catalog-sync-signal";
import { getAuthSessionState, type StoredAuthSession } from "./auth-session";
import { resolveBaseUrl } from "./base-url";
import { isLoopbackHostname } from "./loopback-hostname";
import { assertAdditionalHumanProfileCreationEnabled } from "./profile-creation-capability";
import {
  readDispatchTaskCredentialHeader,
  sendWithCredentialConfirmation,
} from "./sensitive-operation-credentials";

export type OpenMeldProfileKind = "human" | "agent" | "system";
export type OpenMeldProfileStatus = "active" | "disabled";
export type OpenMeldProfileManagedRole = z.infer<
  typeof authProfileManagedRoleSchema
>;
export type OpenMeldProfileCapabilities = z.infer<
  typeof profileCapabilitiesResponseSchema
>;

export type OpenMeldProfile = {
  openMeldProfileId: string;
  profileName: string;
  profileHandle: string;
  profileKind: OpenMeldProfileKind;
  isDefault?: boolean;
  status: OpenMeldProfileStatus;
  ownerUserId: string;
  ownerName?: string;
  source: string;
  managedRole?: OpenMeldProfileManagedRole | null;
  createdByUserId: string | null;
  defaultProjectId?: string | null;
  creationActorProfileId?: string | null;
  creatorProfileId?: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const VALIDATED_SESSION_CACHE_TTL_MS = 5000;
const DEFAULT_OPENMELD_PROFILES_API_TIMEOUT_MS = 10_000;
const LOOPBACK_OPENMELD_PROFILES_API_TIMEOUT_MS = 2500;
const PROFILE_HANDLE_PREFIX_RE = /^@+/;

let validatedSessionCache: {
  session: StoredAuthSession;
  validatedAtMs: number;
} | null = null;

export function resetOpenMeldProfilesSessionCacheForTests(): void {
  validatedSessionCache = null;
}

export function primeOpenMeldProfilesSessionCache(
  session: StoredAuthSession
): void {
  validatedSessionCache = {
    session,
    validatedAtMs: Date.now(),
  };
}

class AuthProfilesApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly code: string | null;

  constructor(input: {
    message: string;
    status: number;
    endpoint: string;
    code?: string | null;
  }) {
    super(input.message);
    this.name = "AuthProfilesApiError";
    this.status = input.status;
    this.endpoint = input.endpoint;
    this.code = normalizeOptionalString(input.code);
  }
}

function isAuthProfilesApiError(error: unknown): error is AuthProfilesApiError {
  return error instanceof AuthProfilesApiError;
}

export async function listOpenMeldProfiles(): Promise<OpenMeldProfile[]> {
  const payload = await requestOpenMeldProfilesApi({
    method: "GET",
    path: "/v1/profiles",
  });

  const profiles = readArrayField(payload, "profiles");
  return profiles.map(parseOpenMeldProfileItem);
}

export async function getOpenMeldProfileCapabilities(): Promise<OpenMeldProfileCapabilities> {
  const payload = await requestOpenMeldProfilesApi({
    method: "GET",
    path: "/v1/profiles/capabilities",
  });
  const parsed = profileCapabilitiesResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("invalid profile capabilities payload", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export async function resolveOpenMeldProfile(input: {
  openMeldProfileId?: string;
  profileKind?: OpenMeldProfileKind;
}): Promise<OpenMeldProfile> {
  const payload = await requestOpenMeldProfilesApi({
    method: "POST",
    path: "/v1/profiles/resolve",
    body: {
      ...(normalizeOptionalString(input.openMeldProfileId)
        ? {
            openMeldProfileId: normalizeOptionalString(input.openMeldProfileId),
          }
        : {}),
      ...(input.profileKind ? { profileKind: input.profileKind } : {}),
    },
  });

  return parseOpenMeldProfileItem(readRecordField(payload, "profile"));
}

export async function resolveOpenMeldProfileByIdOrName(input: {
  profileIdentifier: string;
  profileKind?: OpenMeldProfileKind;
}): Promise<OpenMeldProfile> {
  const profileIdentifier = normalizeOptionalString(input.profileIdentifier);
  if (!profileIdentifier) {
    throw new Error("profile identifier is required");
  }

  try {
    return await resolveOpenMeldProfile({
      openMeldProfileId: profileIdentifier,
      ...(input.profileKind ? { profileKind: input.profileKind } : {}),
    });
  } catch (idError) {
    const matched = await findOpenMeldProfileByNameOrHandle({
      profileIdentifier,
      ...(input.profileKind ? { profileKind: input.profileKind } : {}),
    });
    if (matched.status === "found") {
      return matched.profile;
    }
    if (matched.status === "ambiguous") {
      throw new Error(
        `OpenMeld profile name is ambiguous: ${profileIdentifier}. Pass the profile ID instead.`
      );
    }
    if (isAuthProfilesApiError(idError)) {
      throw new Error(`OpenMeld profile not found: ${profileIdentifier}`);
    }
    throw idError;
  }
}

export function createOpenMeldAgentProfile(input: {
  profileName: string;
  creatorProfileId?: string | null;
}): Promise<OpenMeldProfile> {
  const profileName = normalizeOptionalString(input.profileName);
  const creatorProfileId =
    normalizeOptionalString(input.creatorProfileId) ?? undefined;
  if (!profileName) {
    throw new Error("profile name is required");
  }
  return createOpenMeldAgentProfileRequest({
    profileName,
    ...(creatorProfileId ? { creatorProfileId } : {}),
  });
}

export function ensureOpenMeldManagedAgentProfile(input: {
  profileName: string;
  managedRole: OpenMeldProfileManagedRole;
  creatorProfileId?: string | null;
}): Promise<OpenMeldProfile> {
  const profileName = normalizeOptionalString(input.profileName);
  const creatorProfileId =
    normalizeOptionalString(input.creatorProfileId) ?? undefined;
  if (!profileName) {
    throw new Error("profile name is required");
  }
  return ensureOpenMeldManagedAgentProfileRequest({
    profileName,
    managedRole: input.managedRole,
    ...(creatorProfileId ? { creatorProfileId } : {}),
  });
}

export async function createOpenMeldHumanProfile(input: {
  profileName: string;
  creatorProfileId?: string | null;
}): Promise<OpenMeldProfile> {
  const profileName = normalizeOptionalString(input.profileName);
  const creatorProfileId =
    normalizeOptionalString(input.creatorProfileId) ?? undefined;
  if (!profileName) {
    throw new Error("profile name is required");
  }

  try {
    const capabilities = await getOpenMeldProfileCapabilities();
    assertAdditionalHumanProfileCreationEnabled(capabilities);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE
    ) {
      throw error;
    }
    assertAdditionalHumanProfileCreationEnabled({
      additionalHumanProfileCreationEnabled: false,
      cause: error,
    });
  }

  const payload = await requestOpenMeldProfilesApi({
    method: "POST",
    path: "/v1/profiles/humans",
    body: {
      profileName,
      ...(creatorProfileId ? { creatorProfileId } : {}),
    },
  });

  const created = parseOpenMeldProfileItem(readRecordField(payload, "profile"));
  await emitRouteCatalogSync("profile_created");
  return created;
}

export async function updateOpenMeldProfile(input: {
  openMeldProfileId: string;
  profileName?: string;
}): Promise<OpenMeldProfile> {
  const openMeldProfileId = normalizeOptionalString(input.openMeldProfileId);
  if (!openMeldProfileId) {
    throw new Error("openMeldProfileId is required");
  }

  const profileName = normalizeOptionalString(input.profileName);
  const hasProfileName = Boolean(profileName);

  if (!hasProfileName) {
    throw new Error("profileName is required");
  }

  const payload = await requestOpenMeldProfilesApi({
    method: "PATCH",
    path: `/v1/profiles/${encodeURIComponent(openMeldProfileId)}`,
    body: {
      ...(profileName ? { profileName } : {}),
    },
  });

  const updated = parseOpenMeldProfileItem(readRecordField(payload, "profile"));
  await emitRouteCatalogSync("profile_updated");
  return updated;
}

export async function deleteOpenMeldProfile(input: {
  openMeldProfileId: string;
}): Promise<OpenMeldProfile> {
  const openMeldProfileId = normalizeOptionalString(input.openMeldProfileId);
  if (!openMeldProfileId) {
    throw new Error("openMeldProfileId is required");
  }

  const payload = await requestOpenMeldProfilesApi({
    method: "DELETE",
    path: `/v1/profiles/${encodeURIComponent(openMeldProfileId)}`,
  });

  const deleted = parseOpenMeldProfileItem(readRecordField(payload, "profile"));
  await emitRouteCatalogSync("profile_deleted");
  return deleted;
}

async function requestOpenMeldProfilesApi(input: {
  method: "GET" | "POST" | "DELETE" | "PATCH";
  path: string;
  body?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const session = await requireOpenMeldProfilesSession();
  const endpoint = toAuthEndpoint(session.authBaseUrl, input.path);
  const authorization = `${normalizeTokenType(session.tokenType)} ${session.accessToken}`;
  const taskCredential = readDispatchTaskCredentialHeader();
  const send = (headers: Record<string, string>) =>
    fetch(endpoint, {
      method: input.method,
      headers,
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      signal: AbortSignal.timeout(
        resolveOpenMeldProfilesApiTimeoutMs(endpoint)
      ),
    });
  const headers = {
    Authorization: authorization,
    ...(taskCredential
      ? { [OPENMELD_HEADER_TASK_CREDENTIAL]: taskCredential }
      : {}),
    ...(input.body ? { "content-type": "application/json" } : {}),
  };
  // Deleting an Agent Profile is a sensitive operation: inside the risk
  // window it waits for the owner's confirmation (member-agent-program.md §4.7).
  const response =
    input.method === "DELETE"
      ? await sendWithCredentialConfirmation({
          baseUrl: await resolveBaseUrl(),
          headers,
          method: input.method,
          readConfirmation: async ({ url }) =>
            await fetch(url, {
              headers: { Authorization: authorization },
              signal: AbortSignal.timeout(
                resolveOpenMeldProfilesApiTimeoutMs(url)
              ),
            }),
          send,
        })
      : await send(headers);

  const payload = await parseResponseJson(response);

  if (!response.ok) {
    const parsedError = profileErrorResponseSchema.safeParse(payload);
    const status = response.status;
    const code = parsedError.success ? parsedError.data.code : null;
    if (
      status === 401 ||
      (status === 403 && !isSensitiveOperationRefusalCode(code)) ||
      code === "auth.unauthenticated"
    ) {
      validatedSessionCache = null;
      throw createAuthenticationError({
        reason: "required",
      });
    }

    const message = resolveProfilesApiErrorMessage({
      payload: parsedError.success ? parsedError.data : payload,
      status,
      code,
      endpoint,
    });
    throw new AuthProfilesApiError({
      status,
      endpoint,
      code,
      message,
    });
  }

  const record = isRecord(payload) ? payload : {};
  const ok = readBooleanField(record, "ok");
  if (!ok) {
    const parsedError = profileErrorResponseSchema.safeParse(payload);
    const code = parsedError.success ? parsedError.data.code : null;
    throw new AuthProfilesApiError({
      status: response.status,
      endpoint,
      code,
      message: resolveProfilesApiErrorMessage({
        payload: parsedError.success ? parsedError.data : payload,
        status: response.status,
        code,
        endpoint,
      }),
    });
  }

  return record;
}

async function createOpenMeldAgentProfileRequest(input: {
  profileName: string;
  creatorProfileId?: string;
}): Promise<OpenMeldProfile> {
  const payload = await requestOpenMeldProfilesApi({
    method: "POST",
    path: "/v1/profiles/agents",
    body: {
      profileName: input.profileName,
      ...(input.creatorProfileId
        ? { creatorProfileId: input.creatorProfileId }
        : {}),
    },
  });

  const created = parseOpenMeldProfileItem(readRecordField(payload, "profile"));
  await emitRouteCatalogSync("profile_created");
  return created;
}

async function ensureOpenMeldManagedAgentProfileRequest(input: {
  profileName: string;
  managedRole: OpenMeldProfileManagedRole;
  creatorProfileId?: string;
}): Promise<OpenMeldProfile> {
  const payload = await requestOpenMeldProfilesApi({
    method: "POST",
    path: "/v1/profiles/agents/managed/ensure",
    body: {
      profileName: input.profileName,
      managedRole: input.managedRole,
      ...(input.creatorProfileId
        ? { creatorProfileId: input.creatorProfileId }
        : {}),
    },
  });

  const ensured = parseOpenMeldProfileItem(readRecordField(payload, "profile"));
  await emitRouteCatalogSync("profile_ensured");
  return ensured;
}

async function requireOpenMeldProfilesSession(): Promise<StoredAuthSession> {
  const now = Date.now();
  if (
    validatedSessionCache &&
    now - validatedSessionCache.validatedAtMs <= VALIDATED_SESSION_CACHE_TTL_MS
  ) {
    const localState = await getAuthSessionState({
      validateRemote: false,
    });
    if (
      localState.state === "valid" &&
      localState.session &&
      isSameStoredAuthSession(localState.session, validatedSessionCache.session)
    ) {
      return validatedSessionCache.session;
    }
    validatedSessionCache = null;
  }

  const state = await getAuthSessionState({
    validateRemote: true,
  });

  switch (state.state) {
    case "valid": {
      if (!state.session) {
        throw new Error("auth session unavailable");
      }
      validatedSessionCache = {
        session: state.session,
        validatedAtMs: now,
      };
      return state.session;
    }
    case "missing":
      validatedSessionCache = null;
      throw createAuthenticationError({
        reason: "required",
      });
    case "expired":
    case "invalid":
    case "revoked":
      validatedSessionCache = null;
      throw createAuthenticationError({
        reason: resolveAuthenticationReasonFromState(state.state) ?? "required",
      });
    default:
      validatedSessionCache = null;
      throw createAuthenticationError({
        reason: "required",
      });
  }
}

function resolveOpenMeldProfilesApiTimeoutMs(endpoint: string): number {
  const url = parseUrlOrNull(endpoint);
  if (url && isLoopbackHostname(url.hostname)) {
    return LOOPBACK_OPENMELD_PROFILES_API_TIMEOUT_MS;
  }
  return DEFAULT_OPENMELD_PROFILES_API_TIMEOUT_MS;
}

function parseUrlOrNull(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isSameStoredAuthSession(
  a: StoredAuthSession,
  b: StoredAuthSession
): boolean {
  return (
    a.authBaseUrl === b.authBaseUrl &&
    a.clientId === b.clientId &&
    a.tokenType === b.tokenType &&
    a.accessToken === b.accessToken &&
    (a.expiresAt ?? null) === (b.expiresAt ?? null)
  );
}

async function emitRouteCatalogSync(reason: string): Promise<void> {
  await touchDaemonCatalogSyncSignal({ reason }).catch(() => undefined);
}

function parseOpenMeldProfileItem(value: unknown): OpenMeldProfile {
  const record = isRecord(value) ? value : {};

  const openMeldProfileId = readOptionalStringField(
    record,
    "openMeldProfileId"
  );
  if (!openMeldProfileId) {
    throw new Error("invalid profile payload: missing openMeldProfileId");
  }

  const profileName = readRequiredStringField(record, "profileName");
  const profileHandle = readRequiredStringField(record, "profileHandle");
  const profileKind = readProfileKind(record, "profileKind");
  const isDefault = readOptionalBooleanField(record, "isDefault") ?? false;
  const status = readProfileStatus(record, "status");
  const ownerUserId = readRequiredStringField(record, "ownerUserId");
  const ownerName = readOptionalStringField(record, "ownerName") ?? undefined;
  const source = readRequiredStringField(record, "source");
  const managedRole = readOptionalManagedRoleField(record, "managedRole");
  const createdByUserId =
    readOptionalStringField(record, "createdByUserId") ?? null;
  const defaultProjectId = readOptionalStringField(record, "defaultProjectId");
  const creationActorProfileId =
    readOptionalStringField(record, "creationActorProfileId") ?? null;
  const creatorProfileId =
    readOptionalStringField(record, "creatorProfileId") ?? null;
  const lastUsedAt = readOptionalStringField(record, "lastUsedAt");
  const createdAt = readRequiredStringField(record, "createdAt");
  const updatedAt = readRequiredStringField(record, "updatedAt");

  return {
    openMeldProfileId,
    profileName,
    profileHandle,
    profileKind,
    isDefault,
    status,
    ownerUserId,
    ...(ownerName ? { ownerName } : {}),
    source,
    managedRole,
    createdByUserId,
    defaultProjectId,
    creationActorProfileId,
    creatorProfileId,
    lastUsedAt,
    createdAt,
    updatedAt,
  };
}

function readProfileKind(
  input: Record<string, unknown>,
  field: string
): OpenMeldProfileKind {
  const value = readRequiredStringField(input, field);
  if (value === "human" || value === "agent" || value === "system") {
    return value;
  }
  throw new Error(`invalid profile payload: unsupported ${field}`);
}

function readProfileStatus(
  input: Record<string, unknown>,
  field: string
): OpenMeldProfileStatus {
  const value = readRequiredStringField(input, field);
  if (value === "active" || value === "disabled") {
    return value;
  }
  throw new Error(`invalid profile payload: unsupported ${field}`);
}

function readOptionalManagedRoleField(
  input: Record<string, unknown>,
  field: string
): OpenMeldProfileManagedRole | null {
  const value = readOptionalStringField(input, field);
  if (!value) {
    return null;
  }
  const parsed = authProfileManagedRoleSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(`invalid profile payload: unsupported ${field}`);
}

function readRecordField(
  input: Record<string, unknown>,
  field: string
): Record<string, unknown> {
  const value = input[field];
  if (isRecord(value)) {
    return value;
  }
  throw new Error(`invalid api payload: missing ${field}`);
}

function readArrayField(
  input: Record<string, unknown>,
  field: string
): Record<string, unknown>[] {
  const value = input[field];
  if (!Array.isArray(value)) {
    throw new Error(`invalid api payload: missing ${field}`);
  }

  return value.filter(isRecord);
}

function readRequiredStringField(
  input: Record<string, unknown>,
  field: string
): string {
  const value = normalizeOptionalString(input[field]);
  if (!value) {
    throw new Error(`invalid profile payload: missing ${field}`);
  }
  return value;
}

function readOptionalStringField(
  input: Record<string, unknown>,
  field: string
): string | null {
  return normalizeOptionalString(input[field]);
}

function readBooleanField(
  input: Record<string, unknown>,
  field: string
): boolean {
  return input[field] === true;
}

function readOptionalBooleanField(
  input: Record<string, unknown>,
  field: string
): boolean | null {
  const value = input[field];
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTokenType(tokenType: string): string {
  const normalized = tokenType.trim();
  return normalized.length > 0 ? normalized : "Bearer";
}

function toAuthEndpoint(baseUrl: string, pathname: string): string {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
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

function extractApiErrorMessage(payload: unknown, status: number): string {
  const record = isRecord(payload) ? payload : {};
  const message =
    normalizeOptionalString(record.message) ??
    normalizeOptionalString(record.error_description) ??
    normalizeOptionalString(record.error);

  if (message) {
    return message;
  }

  return `request failed with status ${status}`;
}

function resolveProfilesApiErrorMessage(input: {
  payload: unknown;
  status: number;
  code: string | null;
  endpoint: string;
}): string {
  const message = extractApiErrorMessage(input.payload, input.status);
  if (
    input.status === 500 &&
    input.code === "profile.internal_error" &&
    isLoopbackProfileEndpoint(input.endpoint)
  ) {
    return (
      "internal error from local auth service; if profile schema changed, run " +
      "`pnpm db:migrate:dev` and retry."
    );
  }
  if (
    input.status === 500 &&
    input.code === "profile.internal_error" &&
    isHostedProfilesEndpoint(input.endpoint)
  ) {
    return (
      "internal error from OpenMeld auth service while handling profile state. " +
      "If this works in `openmeld-dev` but fails in `openmeld`, the hosted auth deployment " +
      "is likely out of sync with the latest profile flow. Retry after the " +
      "production auth deploy/migration is updated."
    );
  }

  return message;
}

function normalizeProfileLookupKey(value: string): string {
  return value.trim().replace(PROFILE_HANDLE_PREFIX_RE, "").toLowerCase();
}

async function findOpenMeldProfileByNameOrHandle(input: {
  profileIdentifier: string;
  profileKind?: OpenMeldProfileKind;
}): Promise<
  | { status: "found"; profile: OpenMeldProfile }
  | { status: "ambiguous" }
  | { status: "not_found" }
> {
  const lookupKey = normalizeProfileLookupKey(input.profileIdentifier);
  const matches = (await listOpenMeldProfiles()).filter((profile) => {
    if (input.profileKind && profile.profileKind !== input.profileKind) {
      return false;
    }
    return (
      normalizeProfileLookupKey(profile.profileName) === lookupKey ||
      normalizeProfileLookupKey(profile.profileHandle) === lookupKey
    );
  });

  if (matches.length === 1) {
    const profile = matches[0];
    if (profile) {
      return { status: "found", profile };
    }
  }
  if (matches.length > 1) {
    return { status: "ambiguous" };
  }
  return { status: "not_found" };
}

function isLoopbackProfileEndpoint(endpoint: string): boolean {
  const url = parseUrlOrNull(endpoint);
  return Boolean(
    url &&
      isLoopbackHostname(url.hostname) &&
      url.pathname.startsWith("/v1/profiles")
  );
}

function isHostedProfilesEndpoint(endpoint: string): boolean {
  const url = parseUrlOrNull(endpoint);
  return Boolean(
    url &&
      !isLoopbackHostname(url.hostname) &&
      url.pathname.startsWith("/v1/profiles")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** A sensitive operation's refusal is not a sign-in problem. */
function isSensitiveOperationRefusalCode(code: string | null): boolean {
  return Boolean(
    code &&
      (code.startsWith("credential_confirmation.") ||
        code.startsWith("task_credential.") ||
        code.startsWith("sensitive_operation."))
  );
}
