import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_REMOTE_SESSION_TIMEOUT_MS,
  LOOPBACK_REMOTE_SESSION_TIMEOUT_MS,
} from "../strategy-constants";
import { openMeldRootDir } from "./paths";
import {
  deleteAccessToken,
  isStoredTokenRef,
  readAccessToken,
  type StoredTokenRef,
  storeAccessToken,
} from "./token-store";

type AuthSessionV1 = {
  v: 1;
  tokenRef: StoredTokenRef;
  tokenType: string;
  authBaseUrl: string;
  clientId: string;
  createdAt: string;
  expiresAt?: string;
  scope?: string;
  user?: {
    id?: string;
    email?: string;
    name?: string;
  };
  activeOrganization?: StoredActiveOrganization;
};

type PendingTokenCleanupV1 = {
  v: 1;
  tokenRefs: StoredTokenRef[];
};

export type ClearAuthSessionResult = {
  hadLocalSession: boolean;
};

export type StoredActiveOrganization = {
  id: string;
  slug: string;
  name: string;
  role?: string;
  personal?: boolean;
};

export type StoredAuthSession = {
  v: 1;
  accessToken: string;
  tokenType: string;
  authBaseUrl: string;
  clientId: string;
  createdAt: string;
  expiresAt?: string;
  scope?: string;
  user?: {
    id?: string;
    email?: string;
    name?: string;
  };
  activeOrganization?: StoredActiveOrganization;
};

export type AuthSessionState =
  | "missing"
  | "valid"
  | "expired"
  | "invalid"
  | "revoked";

export type AuthSessionStateReasonCode =
  | "remote_session_invalid"
  | "remote_session_revoked"
  | "session_expired"
  | "session_metadata_invalid"
  | "session_missing"
  | "session_token_missing"
  | "session_token_ref_invalid"
  | "session_token_unavailable";

export type AuthSessionStateResult = {
  errorMessage?: string;
  reasonCode?: AuthSessionStateReasonCode;
  state: AuthSessionState;
  session: StoredAuthSession | null;
};

export type AuthSessionMetadata = {
  authBaseUrl: string;
  clientId: string;
  createdAt: string;
  expiresAt?: string;
  scope?: string;
  user?: {
    id?: string;
    email?: string;
    name?: string;
  };
  activeOrganization?: StoredActiveOrganization;
};

type GetAuthSessionStateOptions = {
  validateRemote?: boolean;
};

type LocalAuthSessionState =
  | {
      errorMessage?: string;
      reasonCode: Exclude<
        AuthSessionStateReasonCode,
        "remote_session_invalid" | "remote_session_revoked" | "session_expired"
      >;
      state: "missing" | "invalid";
      session: null;
    }
  | {
      reasonCode: "session_expired";
      state: "expired";
      session: StoredAuthSession;
    }
  | {
      state: "valid";
      session: StoredAuthSession;
    };

type RemoteAuthSessionState = "valid" | "invalid" | "revoked" | "unknown";
type RemoteAuthSessionValidation = {
  state: RemoteAuthSessionState;
};
const TRAILING_SLASHES_RE = /\/+$/u;

type CachedAuthSession = {
  payloadKey: string;
  session: StoredAuthSession;
};

let cachedAuthSession: CachedAuthSession | null = null;

export async function getAuthSessionState(
  options: GetAuthSessionStateOptions = {}
): Promise<AuthSessionStateResult> {
  const localState = await getLocalAuthSessionState();
  switch (localState.state) {
    case "missing":
    case "invalid":
    case "expired":
      return localState;
    case "valid":
      break;
    default:
      return localState;
  }
  if (!options.validateRemote) {
    return localState;
  }

  const remoteValidation = await getRemoteAuthSessionState(localState.session);
  if (remoteValidation.state === "valid") {
    return localState;
  }
  if (remoteValidation.state === "unknown") {
    return localState;
  }

  return {
    reasonCode: resolveRemoteAuthSessionReasonCode(remoteValidation.state),
    state: remoteValidation.state,
    session: null,
  };
}

// The signed-in owner user id from the local session, or null when signed
// out. Callers use this as the expected owner for service account-alignment
// checks; it never validates remotely.
export async function getCurrentAuthOwnerUserId(): Promise<string | null> {
  const authState = await getAuthSessionState({
    validateRemote: false,
  }).catch(() => null);
  const ownerUserId = authState?.session?.user?.id?.trim() ?? "";
  return ownerUserId.length > 0 ? ownerUserId : null;
}

export async function setAuthSession(input: {
  accessToken: string;
  tokenType?: string;
  authBaseUrl: string;
  clientId: string;
  expiresAt?: string;
  scope?: string;
  user?: {
    id?: string;
    email?: string;
    name?: string;
  };
  activeOrganization?: StoredActiveOrganization | null;
}): Promise<void> {
  const accessToken = String(input.accessToken ?? "").trim();
  if (!accessToken) {
    throw new Error("access token is required");
  }

  const authBaseUrl = String(input.authBaseUrl ?? "").trim();
  if (!authBaseUrl) {
    throw new Error("auth base URL is required");
  }

  const clientId = String(input.clientId ?? "").trim();
  if (!clientId) {
    throw new Error("client_id is required");
  }

  await retryPendingTokenCleanup();

  const previousPayload = await readSessionPayload();
  const previousTokenRef = normalizeTokenRef(previousPayload?.tokenRef);
  const tokenRef = await storeAccessToken({
    accessToken,
    authBaseUrl,
    clientId,
  });

  const payload: AuthSessionV1 = {
    v: 1,
    tokenRef,
    tokenType: String(input.tokenType ?? "Bearer").trim() || "Bearer",
    authBaseUrl,
    clientId,
    createdAt: new Date().toISOString(),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    ...buildAuthUserPayload(input.user),
    ...buildActiveOrganizationPayload(input.activeOrganization),
  };

  const path = authSessionPath();
  await mkdir(join(openMeldRootDir(), "auth"), { recursive: true });

  try {
    await assertStoredAccessTokenReloads({ accessToken, tokenRef });
    await writeSessionPayloadAtomically(path, payload);
  } catch (error) {
    await deleteAccessTokenOrRetainForCleanup(tokenRef);
    throw error;
  }

  cacheAuthSession({
    payload,
    session: buildStoredAuthSession({ accessToken, payload }),
  });
  if (
    previousTokenRef &&
    !areStoredTokenRefsEqual(previousTokenRef, tokenRef)
  ) {
    await deleteAccessTokenOrRetainForCleanup(previousTokenRef);
  }
}

export async function getAuthSession(): Promise<StoredAuthSession | null> {
  const localState = await getLocalAuthSessionState();
  if (localState.state === "missing" || localState.state === "invalid") {
    return null;
  }
  return localState.session;
}

export async function getAuthSessionMetadata(): Promise<AuthSessionMetadata | null> {
  const payload = await readSessionPayload();
  if (payload?.v !== 1) {
    return null;
  }

  const authBaseUrl = normalizeOptionalString(payload.authBaseUrl);
  const clientId = normalizeOptionalString(payload.clientId);
  const createdAt = normalizeOptionalString(payload.createdAt);
  if (!(authBaseUrl && clientId && createdAt)) {
    return null;
  }

  return {
    authBaseUrl,
    clientId,
    createdAt,
    ...(typeof payload.expiresAt === "string" && payload.expiresAt.trim()
      ? { expiresAt: payload.expiresAt.trim() }
      : {}),
    ...(typeof payload.scope === "string" && payload.scope.trim()
      ? { scope: payload.scope.trim() }
      : {}),
    ...buildAuthUserPayload(payload.user),
    ...buildActiveOrganizationPayload(payload.activeOrganization),
  };
}

export async function updateAuthSessionActiveOrganization(
  activeOrganization: StoredActiveOrganization | null
): Promise<void> {
  const payload = await readSessionPayload();
  if (payload?.v !== 1) {
    throw new Error("cannot update active organization without auth session");
  }

  const tokenRef = normalizeTokenRef(payload.tokenRef);
  const tokenType = normalizeOptionalString(payload.tokenType);
  const authBaseUrl = normalizeOptionalString(payload.authBaseUrl);
  const clientId = normalizeOptionalString(payload.clientId);
  const createdAt = normalizeOptionalString(payload.createdAt);
  if (!(tokenRef && tokenType && authBaseUrl && clientId && createdAt)) {
    throw new Error(
      "cannot update active organization for invalid auth session"
    );
  }

  const nextPayload: AuthSessionV1 = {
    v: 1,
    tokenRef,
    tokenType,
    authBaseUrl,
    clientId,
    createdAt,
    ...(typeof payload.expiresAt === "string" && payload.expiresAt.trim()
      ? { expiresAt: payload.expiresAt.trim() }
      : {}),
    ...(typeof payload.scope === "string" && payload.scope.trim()
      ? { scope: payload.scope.trim() }
      : {}),
    ...buildAuthUserPayload(payload.user),
    ...buildActiveOrganizationPayload(activeOrganization),
  };

  await writeSessionPayloadAtomically(authSessionPath(), nextPayload);
  const currentCachedSession = readCachedAuthSession(payload);
  if (currentCachedSession) {
    cacheAuthSession({
      payload: nextPayload,
      session: buildStoredAuthSession({
        accessToken: currentCachedSession.accessToken,
        payload: nextPayload,
      }),
    });
  }
}

export async function clearAuthSession(): Promise<ClearAuthSessionResult> {
  cachedAuthSession = null;
  await retryPendingTokenCleanup();
  const hadLocalSession = await authSessionFileExists();
  const payload = await readSessionPayload();
  if (payload?.v === 1 && isStoredTokenRef(payload.tokenRef)) {
    await deleteAccessTokenOrRetainForCleanup(payload.tokenRef);
  }
  await removeSessionFile();
  return { hadLocalSession };
}

async function retryPendingTokenCleanup(): Promise<void> {
  const pending = await readPendingTokenCleanup();
  if (pending.tokenRefs.length === 0) {
    return;
  }

  const remaining: StoredTokenRef[] = [];
  for (const tokenRef of pending.tokenRefs) {
    try {
      await deleteAccessToken(tokenRef);
    } catch {
      remaining.push(tokenRef);
    }
  }
  await persistPendingTokenCleanup(remaining);
}

async function deleteAccessTokenOrRetainForCleanup(
  tokenRef: StoredTokenRef
): Promise<void> {
  try {
    await deleteAccessToken(tokenRef);
  } catch {
    const pending = await readPendingTokenCleanup();
    if (
      pending.tokenRefs.some((ref) => areStoredTokenRefsEqual(ref, tokenRef))
    ) {
      return;
    }
    await persistPendingTokenCleanup([...pending.tokenRefs, tokenRef]);
  }
}

async function readPendingTokenCleanup(): Promise<PendingTokenCleanupV1> {
  const raw = await readFile(pendingTokenCleanupPath(), "utf8").catch(
    (error) => {
      if (isFileNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  );
  if (raw === null) {
    return { v: 1, tokenRefs: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("pending access-token cleanup state is invalid");
  }
  if (
    !(isRecord(parsed) && parsed.v === 1 && Array.isArray(parsed.tokenRefs))
  ) {
    throw new Error("pending access-token cleanup state is invalid");
  }
  const tokenRefs = parsed.tokenRefs.filter(isStoredTokenRef);
  if (tokenRefs.length !== parsed.tokenRefs.length) {
    throw new Error("pending access-token cleanup state is invalid");
  }
  return { v: 1, tokenRefs };
}

async function persistPendingTokenCleanup(
  tokenRefs: StoredTokenRef[]
): Promise<void> {
  const path = pendingTokenCleanupPath();
  if (tokenRefs.length === 0) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(join(openMeldRootDir(), "auth"), { recursive: true });
  await writeJsonAtomically(path, { v: 1, tokenRefs });
}

function pendingTokenCleanupPath(): string {
  return join(openMeldRootDir(), "auth", "pending-token-cleanup.json");
}

async function authSessionFileExists(): Promise<boolean> {
  try {
    await readFile(authSessionPath(), "utf8");
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function getLocalAuthSessionState(): Promise<LocalAuthSessionState> {
  const payload = await readSessionPayload();
  if (payload?.v !== 1) {
    return {
      reasonCode: "session_missing",
      state: "missing",
      session: null,
    };
  }

  const tokenRef = normalizeTokenRef(payload.tokenRef);
  if (!tokenRef) {
    return {
      reasonCode: "session_token_ref_invalid",
      state: "invalid",
      session: null,
    };
  }

  const tokenType = normalizeOptionalString(payload.tokenType);
  const authBaseUrl = normalizeOptionalString(payload.authBaseUrl);
  const clientId = normalizeOptionalString(payload.clientId);
  const createdAt = normalizeOptionalString(payload.createdAt);
  if (!(tokenType && authBaseUrl && clientId && createdAt)) {
    return {
      reasonCode: "session_metadata_invalid",
      state: "invalid",
      session: null,
    };
  }

  let session = readCachedAuthSession(payload);
  if (!session) {
    const accessToken = await readAccessToken(tokenRef);
    if (accessToken.status === "missing") {
      return {
        reasonCode: "session_token_missing",
        state: "invalid",
        session: null,
      };
    }
    if (accessToken.status === "unavailable") {
      return {
        errorMessage: accessToken.errorMessage,
        reasonCode: "session_token_unavailable",
        state: "invalid",
        session: null,
      };
    }
    session = buildStoredAuthSession({
      accessToken: accessToken.accessToken,
      payload: {
        ...payload,
        v: 1,
        tokenRef,
        tokenType,
        authBaseUrl,
        clientId,
        createdAt,
      },
    });
    cacheAuthSession({ payload, session });
  }

  if (isExpired(session.expiresAt)) {
    return {
      reasonCode: "session_expired",
      state: "expired",
      session,
    };
  }

  return {
    state: "valid",
    session,
  };
}

async function assertStoredAccessTokenReloads(input: {
  accessToken: string;
  tokenRef: StoredTokenRef;
}): Promise<void> {
  const reloaded = await readAccessToken(input.tokenRef);
  if (
    reloaded.status === "found" &&
    reloaded.accessToken === input.accessToken
  ) {
    return;
  }
  if (reloaded.status === "unavailable") {
    throw new Error(
      `stored access token could not be reloaded: ${reloaded.errorMessage}`
    );
  }
  throw new Error("stored access token could not be reloaded");
}

function buildStoredAuthSession(input: {
  accessToken: string;
  payload: AuthSessionV1;
}): StoredAuthSession {
  return {
    v: 1,
    accessToken: input.accessToken,
    tokenType: input.payload.tokenType,
    authBaseUrl: input.payload.authBaseUrl,
    clientId: input.payload.clientId,
    createdAt: input.payload.createdAt,
    ...(typeof input.payload.expiresAt === "string" &&
    input.payload.expiresAt.trim()
      ? { expiresAt: input.payload.expiresAt.trim() }
      : {}),
    ...(typeof input.payload.scope === "string" && input.payload.scope.trim()
      ? { scope: input.payload.scope.trim() }
      : {}),
    ...buildAuthUserPayload(input.payload.user),
    ...buildActiveOrganizationPayload(input.payload.activeOrganization),
  };
}

function cacheAuthSession(input: {
  payload: Partial<AuthSessionV1>;
  session: StoredAuthSession;
}): void {
  cachedAuthSession = {
    payloadKey: buildAuthSessionPayloadKey(input.payload),
    session: input.session,
  };
}

function readCachedAuthSession(
  payload: Partial<AuthSessionV1>
): StoredAuthSession | null {
  const payloadKey = buildAuthSessionPayloadKey(payload);
  return cachedAuthSession?.payloadKey === payloadKey
    ? cachedAuthSession.session
    : null;
}

function buildAuthSessionPayloadKey(payload: Partial<AuthSessionV1>): string {
  return `${authSessionPath()}\n${JSON.stringify(payload)}`;
}

function areStoredTokenRefsEqual(
  left: StoredTokenRef,
  right: StoredTokenRef
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeTokenRef(input: unknown): StoredTokenRef | null {
  if (!isStoredTokenRef(input)) {
    return null;
  }
  return input;
}

async function getRemoteAuthSessionState(
  session: StoredAuthSession
): Promise<RemoteAuthSessionValidation> {
  let endpoint = "";
  try {
    endpoint = toAuthEndpoint(session.authBaseUrl, "/api/auth/get-session");
  } catch {
    return { state: "invalid" };
  }
  try {
    const timeoutMs = resolveRemoteSessionTimeoutMs(endpoint);
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `${normalizeTokenType(session.tokenType)} ${session.accessToken}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status === 401 || response.status === 403) {
      return { state: "revoked" };
    }
    if (!response.ok) {
      // Preserve local credentials on upstream/transient failures.
      // Non-auth HTTP errors should be retried instead of treated as revocation.
      return { state: "unknown" };
    }

    const payload = await parseResponseJson(response);
    if (!hasActiveSessionPayload(payload)) {
      return { state: "invalid" };
    }
    return { state: "valid" };
  } catch {
    return { state: "unknown" };
  }
}

function resolveRemoteSessionTimeoutMs(endpoint: string): number {
  const url = parseUrlOrNull(endpoint);
  if (url && isLoopbackHostname(url.hostname)) {
    return LOOPBACK_REMOTE_SESSION_TIMEOUT_MS;
  }
  return DEFAULT_REMOTE_SESSION_TIMEOUT_MS;
}

function parseUrlOrNull(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function hasActiveSessionPayload(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    isRecord((payload as Record<string, unknown>).session) &&
    isRecord((payload as Record<string, unknown>).user)
  );
}

function isExpired(expiresAt: string | undefined): boolean {
  if (!expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }
  return expiresAtMs <= Date.now();
}

function resolveRemoteAuthSessionReasonCode(
  state: Exclude<RemoteAuthSessionState, "valid" | "unknown">
): AuthSessionStateReasonCode {
  switch (state) {
    case "invalid":
      return "remote_session_invalid";
    case "revoked":
      return "remote_session_revoked";
    default: {
      const exhaustiveState: never = state;
      throw new Error(
        `unsupported remote auth session state: ${exhaustiveState}`
      );
    }
  }
}

async function readSessionPayload(): Promise<Partial<AuthSessionV1> | null> {
  const raw = await readFile(authSessionPath(), "utf8").catch(() => null);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as Partial<AuthSessionV1>;
  } catch {
    return null;
  }
}

function authSessionPath(): string {
  return join(openMeldRootDir(), "auth", "session.json");
}

async function writeSessionPayloadAtomically(
  path: string,
  payload: AuthSessionV1
): Promise<void> {
  await writeJsonAtomically(path, payload);
}

async function writeJsonAtomically(
  path: string,
  payload: unknown
): Promise<void> {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    const file = await open(tempPath, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }

    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );
}

function buildAuthUserPayload(value: unknown): {
  user?: {
    id?: string;
    email?: string;
    name?: string;
  };
} {
  if (!(value && typeof value === "object")) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const id = normalizeOptionalString(record.id);
  const email = normalizeOptionalString(record.email);
  const name = normalizeOptionalString(record.name);
  if (!(id || email || name)) {
    return {};
  }
  return {
    user: {
      ...(id ? { id } : {}),
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
    },
  };
}

function buildActiveOrganizationPayload(value: unknown): {
  activeOrganization?: StoredActiveOrganization;
} {
  const activeOrganization = normalizeStoredActiveOrganization(value);
  return activeOrganization ? { activeOrganization } : {};
}

export function normalizeStoredActiveOrganization(
  value: unknown
): StoredActiveOrganization | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeOptionalString(value.id);
  const slug = normalizeOptionalString(value.slug);
  const name = normalizeOptionalString(value.name);
  const role = normalizeOptionalString(value.role);
  const personal = readOrganizationIsPersonal(value);
  if (!(id && slug && name)) {
    return null;
  }
  return {
    id,
    slug,
    name,
    ...(role ? { role } : {}),
    ...(personal ? { personal } : {}),
  };
}

export function readActiveOrganizationIdFromSessionPayload(
  payload: unknown
): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  return (
    (isRecord(payload.session)
      ? normalizeOptionalString(payload.session.activeOrganizationId)
      : null) ?? normalizeOptionalString(payload.activeOrganizationId)
  );
}

function normalizeTokenType(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "Bearer";
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function readOrganizationIsPersonal(value: Record<string, unknown>): boolean {
  if (value.personal === true || value.isPersonal === true) {
    return true;
  }

  const metadata = readOrganizationMetadata(value.metadata);
  return metadata?.personal === true;
}

function readOrganizationMetadata(
  metadata: unknown
): Record<string, unknown> | null {
  if (metadata === null || metadata === undefined) {
    return null;
  }

  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return isRecord(metadata) ? metadata : null;
}

function toAuthEndpoint(baseUrl: string, pathname: string): string {
  const url = new URL(baseUrl);
  const normalizedBasePath = url.pathname.replace(TRAILING_SLASHES_RE, "");
  const normalizedPathname = pathname.startsWith("/")
    ? pathname
    : `/${pathname}`;
  url.pathname = `${normalizedBasePath}${normalizedPathname}` || "/";
  url.search = "";
  url.hash = "";
  return url.toString();
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

async function removeSessionFile(): Promise<void> {
  await rm(authSessionPath(), { force: true });
}
