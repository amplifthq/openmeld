import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_REMOTE_SESSION_TIMEOUT_MS,
  LOOPBACK_REMOTE_SESSION_TIMEOUT_MS,
} from "../strategy-constants";
import {
  CURRENT_PROCESS_START_IDENTITY,
  isProcessIdentityAlive,
} from "../system/process-identity";
import { resolveAuthSessionExpiryEligibility } from "./auth-session-expiry";
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

type AuthSessionTransitionJournalV1 = {
  v: 1;
  id: string;
  state: "pending" | "recovery_required" | "committed";
  ownerPid: number;
  ownerProcessStartedAt: string;
  previousPayload: AuthSessionV1 | null;
  candidatePayload: AuthSessionV1;
  candidateServiceProcess?: ProcessIdentity;
  computerHandoff?: {
    gatewayUrl: string;
    serviceReconciledAt?: string;
    remoteSessionRevokedAt?: string;
    lastRecoveryFailure?: {
      at: string;
      message: string;
      phase: "service" | "remote_session" | "local_cleanup";
      endpoint?: string;
      status?: number | null;
    };
  };
};

type ProcessIdentity = {
  ownerPid: number;
  ownerProcessStartedAt: string;
};

class AuthSessionStorageError extends Error {
  readonly reason: "corrupt" | "unreadable";

  constructor(input: {
    message: string;
    reason: "corrupt" | "unreadable";
    cause?: unknown;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause }
    );
    this.name = "AuthSessionStorageError";
    this.reason = input.reason;
  }
}

export class AuthSessionRecoveryInProgressError extends Error {
  constructor() {
    super(
      "OpenMeld is still finishing an interrupted Computer sign-in recovery. The current sign-in was not changed; retry after the recovery cleanup succeeds."
    );
    this.name = "AuthSessionRecoveryInProgressError";
  }
}

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

export type AuthSessionInput = {
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
};

export type AuthSessionTransition = {
  previousSession: StoredAuthSession | null;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
};

export type AuthSessionTransitionContext = {
  computerHandoff?: {
    gatewayUrl: string;
  };
};

export type InterruptedComputerAuthSessionRecovery = {
  candidateSession: StoredAuthSession & {
    user: NonNullable<StoredAuthSession["user"]> & { id: string };
  };
  gatewayUrl: string;
  id: string;
  previousSession: StoredAuthSession | null;
  remoteSessionRevoked: boolean;
  serviceReconciled: boolean;
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
  | "session_expiry_invalid"
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
  // Keep normal requests local-first, but let the server recover a stale local
  // expiry before callers stop attaching an otherwise usable credential.
  refreshExpired?: boolean;
  // Ask the server to validate even a locally current session.
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
type RemoteAuthSessionValidation =
  | {
      accessToken?: string;
      expiresAt?: string;
      state: "valid";
    }
  | {
      state: Exclude<RemoteAuthSessionState, "valid">;
    };
const TRAILING_SLASHES_RE = /\/+$/u;

type CachedAuthSession = {
  payloadKey: string;
  session: StoredAuthSession;
};

let cachedAuthSession: CachedAuthSession | null = null;
const activeAuthSessionTransitionIds = new Set<string>();

export async function getAuthSessionState(
  options: GetAuthSessionStateOptions = {}
): Promise<AuthSessionStateResult> {
  const localState = await getLocalAuthSessionState();
  const localPayloadKey = cachedAuthSession?.payloadKey ?? null;
  const shouldValidateRemote =
    options.validateRemote === true ||
    (options.refreshExpired === true && localState.state === "expired");
  switch (localState.state) {
    case "missing":
    case "invalid":
      return localState;
    case "expired":
      if (!shouldValidateRemote) {
        return localState;
      }
      break;
    case "valid":
      break;
    default:
      return localState;
  }
  if (!shouldValidateRemote) {
    return localState;
  }

  const remoteValidation = await getRemoteAuthSessionState(localState.session);
  if (remoteValidation.state === "valid") {
    if (!remoteValidation.expiresAt) {
      return localState;
    }
    if (isExpired(remoteValidation.expiresAt)) {
      return localState;
    }
    const refreshedSession = await persistRemoteSessionRefresh({
      accessToken:
        remoteValidation.accessToken ?? localState.session.accessToken,
      expectedPayloadKey: localPayloadKey,
      expiresAt: remoteValidation.expiresAt,
      previousAccessToken: localState.session.accessToken,
    });
    if (refreshedSession) {
      return {
        state: "valid",
        session: refreshedSession,
      };
    }
    return await getLocalAuthSessionState();
  }
  if (remoteValidation.state === "unknown") {
    if (localState.state === "expired" && options.refreshExpired === true) {
      // A stale local timestamp is not authorization truth. Preserve the
      // session so the shared request-attachment owner can reject the known
      // expiry without discarding credentials that a later refresh may renew.
      return {
        state: "valid",
        session: localState.session,
      };
    }
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

export async function setAuthSession(input: AuthSessionInput): Promise<void> {
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

  await assertAuthSessionMutationAvailable();
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
  await ensureAuthSessionDirectory();

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

export async function beginAuthSessionTransition(
  input: AuthSessionInput,
  context: AuthSessionTransitionContext = {}
): Promise<AuthSessionTransition> {
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
  await ensureAuthSessionDirectory();
  const previousPayload = await readSessionPayload();
  const previousState = await getLocalAuthSessionState();
  const previousSession =
    previousState.state === "valid" || previousState.state === "expired"
      ? previousState.session
      : null;
  const tokenRef = await storeAccessToken({
    accessToken,
    authBaseUrl,
    clientId,
    unique: true,
  });
  const nextPayload: AuthSessionV1 = {
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
  const journal: AuthSessionTransitionJournalV1 = {
    v: 1,
    id: randomUUID(),
    state: "pending",
    ownerPid: process.pid,
    ownerProcessStartedAt: CURRENT_PROCESS_START_IDENTITY,
    previousPayload:
      previousPayload?.v === 1 ? (previousPayload as AuthSessionV1) : null,
    candidatePayload: nextPayload,
    ...(context.computerHandoff
      ? {
          computerHandoff: {
            gatewayUrl: context.computerHandoff.gatewayUrl,
          },
        }
      : {}),
  };
  try {
    await assertStoredAccessTokenReloads({ accessToken, tokenRef });
    await writeAuthSessionTransitionJournal(journal);
    activeAuthSessionTransitionIds.add(journal.id);
    await writeSessionPayloadAtomically(authSessionPath(), nextPayload);
  } catch (error) {
    activeAuthSessionTransitionIds.delete(journal.id);
    await restoreTransitionPreviousPayload(journal).catch(() => undefined);
    await removeAuthSessionTransitionJournal().catch(() => undefined);
    await deleteAccessTokenOrRetainForCleanup(tokenRef);
    throw error;
  }
  cacheAuthSession({
    payload: nextPayload,
    session: buildStoredAuthSession({ accessToken, payload: nextPayload }),
  });

  let settled = false;
  const assertTransitionCurrent = async () => {
    if (settled) {
      throw new Error("auth session transition is already settled");
    }
    const currentPayload = await readSessionPayload();
    if (
      currentPayload?.v !== 1 ||
      buildAuthSessionPayloadKey(currentPayload) !==
        buildAuthSessionPayloadKey(nextPayload)
    ) {
      throw new Error(
        "auth session changed before the setup transition completed"
      );
    }
  };

  return {
    previousSession,
    commit: async () => {
      await assertTransitionCurrent();
      const currentJournal = await readCurrentPendingAuthSessionTransition(
        journal.id
      );
      const committedJournal: AuthSessionTransitionJournalV1 = {
        ...currentJournal,
        state: "committed",
      };
      await writeAuthSessionTransitionJournal(committedJournal);
      settled = true;
      activeAuthSessionTransitionIds.delete(journal.id);
      await finalizeCommittedAuthSessionTransition(committedJournal).catch(
        (error: unknown) => {
          logDeferredAuthSessionTransitionCleanup({
            error,
            transitionId: journal.id,
          });
        }
      );
    },
    rollback: async () => {
      await assertTransitionCurrent();
      const currentJournal = await readCurrentPendingAuthSessionTransition(
        journal.id
      );
      await restoreTransitionPreviousPayload(currentJournal, previousSession);
      settled = true;
      activeAuthSessionTransitionIds.delete(journal.id);
      stopRegisteredCandidateService(currentJournal);
      if (currentJournal.computerHandoff) {
        await writeAuthSessionTransitionJournal({
          ...currentJournal,
          state: "recovery_required",
        });
        return;
      }
      await deleteAccessTokenOrRetainForCleanup(tokenRef);
      await removeAuthSessionTransitionJournal();
    },
  };
}

async function readCurrentPendingAuthSessionTransition(
  id: string
): Promise<AuthSessionTransitionJournalV1> {
  const currentJournal = await readAuthSessionTransitionJournal();
  if (currentJournal?.id !== id || currentJournal.state !== "pending") {
    throw new Error("auth session transition is no longer pending");
  }
  return currentJournal;
}

export async function getInterruptedComputerAuthSessionRecovery(): Promise<InterruptedComputerAuthSessionRecovery | null> {
  await recoverInterruptedAuthSessionTransition();
  const journal = await readAuthSessionTransitionJournal();
  if (!(journal?.state === "recovery_required" && journal.computerHandoff)) {
    return null;
  }

  const candidateSession = await readStoredAuthSessionFromPayloadIfPresent(
    journal.candidatePayload
  );
  if (!candidateSession) {
    if (
      journal.computerHandoff.serviceReconciledAt &&
      journal.computerHandoff.remoteSessionRevokedAt
    ) {
      await removeAuthSessionTransitionJournal();
      return null;
    }
    throw new AuthSessionStorageError({
      message: "auth session recovery token is missing",
      reason: "corrupt",
    });
  }
  const candidateOwnerUserId = normalizeOptionalString(
    candidateSession.user?.id
  );
  if (!candidateOwnerUserId) {
    throw new AuthSessionStorageError({
      message: "computer auth recovery candidate is missing its owner user id",
      reason: "corrupt",
    });
  }

  return {
    candidateSession: {
      ...candidateSession,
      user: { ...candidateSession.user, id: candidateOwnerUserId },
    },
    gatewayUrl: journal.computerHandoff.gatewayUrl,
    id: journal.id,
    previousSession: journal.previousPayload
      ? await readStoredAuthSessionFromPayload(journal.previousPayload)
      : null,
    remoteSessionRevoked: Boolean(
      journal.computerHandoff.remoteSessionRevokedAt
    ),
    serviceReconciled: Boolean(journal.computerHandoff.serviceReconciledAt),
  };
}

export async function markInterruptedComputerAuthSessionRecovery(input: {
  id: string;
  phase: "service" | "remote_session";
}): Promise<void> {
  const journal = await readRequiredComputerAuthRecoveryJournal(input.id);
  await writeAuthSessionTransitionJournal({
    ...journal,
    computerHandoff: {
      ...journal.computerHandoff,
      ...(input.phase === "service"
        ? { serviceReconciledAt: new Date().toISOString() }
        : { remoteSessionRevokedAt: new Date().toISOString() }),
      lastRecoveryFailure: undefined,
    },
  });
}

export async function recordInterruptedComputerAuthSessionRecoveryFailure(input: {
  endpoint?: string;
  id: string;
  message: string;
  phase: "service" | "remote_session" | "local_cleanup";
  status?: number | null;
}): Promise<void> {
  const journal = await readRequiredComputerAuthRecoveryJournal(input.id);
  await writeAuthSessionTransitionJournal({
    ...journal,
    computerHandoff: {
      ...journal.computerHandoff,
      lastRecoveryFailure: {
        at: new Date().toISOString(),
        message: input.message,
        phase: input.phase,
        ...(input.endpoint ? { endpoint: input.endpoint } : {}),
        ...(input.status === undefined ? {} : { status: input.status }),
      },
    },
  });
}

export async function completeInterruptedComputerAuthSessionRecovery(
  id: string
): Promise<boolean> {
  const journal = await readRequiredComputerAuthRecoveryJournal(id);
  if (
    !(
      journal.computerHandoff.serviceReconciledAt &&
      journal.computerHandoff.remoteSessionRevokedAt
    )
  ) {
    throw new Error(
      "computer auth recovery cannot complete before service and remote-session cleanup"
    );
  }
  try {
    await deleteAccessTokenOrRetainForCleanup(
      journal.candidatePayload.tokenRef
    );
    await removeAuthSessionTransitionJournal();
    return true;
  } catch (error) {
    await recordInterruptedComputerAuthSessionRecoveryFailure({
      id,
      message: toErrorMessage(error),
      phase: "local_cleanup",
    }).catch(() => undefined);
    logDeferredAuthSessionTransitionCleanup({ error, transitionId: id });
    return false;
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
  await assertAuthSessionMutationAvailable();
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

export async function assertAuthSessionMutationAvailable(): Promise<void> {
  await recoverInterruptedAuthSessionTransition();
  if (await readAuthSessionTransitionJournal()) {
    throw new AuthSessionRecoveryInProgressError();
  }
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
  let payload: Partial<AuthSessionV1> | null;
  try {
    payload = await readSessionPayload();
  } catch (error) {
    if (error instanceof AuthSessionStorageError) {
      return {
        errorMessage: error.message,
        reasonCode: "session_metadata_invalid",
        state: "invalid",
        session: null,
      };
    }
    throw error;
  }
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

  const expiryEligibility = resolveAuthSessionExpiryEligibility(
    session.expiresAt
  );
  if (expiryEligibility.status === "invalid") {
    return {
      reasonCode: "session_expiry_invalid",
      state: "invalid",
      session: null,
    };
  }
  if (expiryEligibility.status === "expired") {
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

async function persistRemoteSessionRefresh(input: {
  accessToken: string;
  expectedPayloadKey: string | null;
  expiresAt: string;
  previousAccessToken: string;
}): Promise<StoredAuthSession | null> {
  const payload = await readSessionPayload();
  if (
    payload?.v !== 1 ||
    input.expectedPayloadKey === null ||
    buildAuthSessionPayloadKey(payload) !== input.expectedPayloadKey
  ) {
    return null;
  }

  const tokenRef = normalizeTokenRef(payload.tokenRef);
  const tokenType = normalizeOptionalString(payload.tokenType);
  const authBaseUrl = normalizeOptionalString(payload.authBaseUrl);
  const clientId = normalizeOptionalString(payload.clientId);
  const createdAt = normalizeOptionalString(payload.createdAt);
  if (!(tokenRef && tokenType && authBaseUrl && clientId && createdAt)) {
    return null;
  }

  const nextAccessToken = normalizeOptionalString(input.accessToken);
  if (!nextAccessToken) {
    return null;
  }
  const nextTokenRef =
    nextAccessToken === input.previousAccessToken
      ? tokenRef
      : await storeAccessToken({
          accessToken: nextAccessToken,
          authBaseUrl,
          clientId,
        });
  const nextPayload: AuthSessionV1 = {
    v: 1,
    tokenRef: nextTokenRef,
    tokenType,
    authBaseUrl,
    clientId,
    createdAt,
    expiresAt: input.expiresAt,
    ...(typeof payload.scope === "string" && payload.scope.trim()
      ? { scope: payload.scope.trim() }
      : {}),
    ...buildAuthUserPayload(payload.user),
    ...buildActiveOrganizationPayload(payload.activeOrganization),
  };
  const nextSession = buildStoredAuthSession({
    accessToken: nextAccessToken,
    payload: nextPayload,
  });

  try {
    await assertStoredAccessTokenReloads({
      accessToken: nextAccessToken,
      tokenRef: nextTokenRef,
    });
    await writeSessionPayloadAtomically(authSessionPath(), nextPayload);
  } catch (error) {
    if (!areStoredTokenRefsEqual(tokenRef, nextTokenRef)) {
      await deleteAccessTokenOrRetainForCleanup(nextTokenRef);
    }
    throw error;
  }

  cacheAuthSession({ payload: nextPayload, session: nextSession });
  if (!areStoredTokenRefsEqual(tokenRef, nextTokenRef)) {
    await deleteAccessTokenOrRetainForCleanup(tokenRef);
  }
  return nextSession;
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
    return {
      state: "valid",
      ...readRemoteAccessToken(response),
      ...readRemoteSessionExpiration(payload),
    };
  } catch {
    return { state: "unknown" };
  }
}

function readRemoteAccessToken(response: Response): {
  accessToken?: string;
} {
  const accessToken = normalizeOptionalString(
    response.headers.get("set-auth-token")
  );
  return accessToken ? { accessToken } : {};
}

function readRemoteSessionExpiration(payload: unknown): {
  expiresAt?: string;
} {
  if (!isRecord(payload)) {
    return {};
  }
  const session = payload.session;
  if (!isRecord(session)) {
    return {};
  }
  const expiresAt = normalizeOptionalString(session.expiresAt);
  if (!expiresAt) {
    return {};
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return {};
  }
  return { expiresAt: new Date(expiresAtMs).toISOString() };
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
  return resolveAuthSessionExpiryEligibility(expiresAt).status === "expired";
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
  await recoverInterruptedAuthSessionTransition();
  return await readSessionPayloadFile();
}

async function readSessionPayloadFile(): Promise<Partial<AuthSessionV1> | null> {
  const path = authSessionPath();
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw new AuthSessionStorageError({
      message: `current auth session metadata could not be read at ${path}: ${toErrorMessage(error)}`,
      reason: "unreadable",
      cause: error,
    });
  });
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as Partial<AuthSessionV1>;
  } catch (error) {
    throw new AuthSessionStorageError({
      message: `current auth session metadata is corrupt at ${path}`,
      reason: "corrupt",
      cause: error,
    });
  }
}

async function recoverInterruptedAuthSessionTransition(): Promise<void> {
  let journal = await readAuthSessionTransitionJournal();
  if (!journal) {
    return;
  }
  if (activeAuthSessionTransitionIds.has(journal.id)) {
    return;
  }
  if (
    journal.state === "pending" &&
    isProcessIdentityAlive({
      ownerPid: journal.ownerPid,
      ownerProcessStartedAt: journal.ownerProcessStartedAt,
    })
  ) {
    journal = await registerCurrentCandidateServiceProcess(journal);
    return;
  }

  if (journal.state === "pending") {
    await restoreTransitionPreviousPayload(journal);
    stopRegisteredCandidateService(journal);
    if (journal.computerHandoff) {
      await writeAuthSessionTransitionJournal({
        ...journal,
        state: "recovery_required",
      });
      return;
    }
    await deleteAccessTokenOrRetainForCleanup(
      journal.candidatePayload.tokenRef
    );
    await removeAuthSessionTransitionJournal();
    return;
  }
  if (journal.state === "recovery_required") {
    stopRegisteredCandidateService(journal);
    return;
  }

  if (journal.state === "committed") {
    const currentPayload = await readSessionPayloadFile();
    if (
      currentPayload?.v !== 1 ||
      buildAuthSessionPayloadKey(currentPayload) !==
        buildAuthSessionPayloadKey(journal.candidatePayload)
    ) {
      throw new AuthSessionStorageError({
        message:
          "committed auth session transition does not match current session metadata",
        reason: "corrupt",
      });
    }
    await finalizeCommittedAuthSessionTransition(journal).catch(
      (error: unknown) => {
        logDeferredAuthSessionTransitionCleanup({
          error,
          transitionId: journal.id,
        });
      }
    );
  }
}

async function finalizeCommittedAuthSessionTransition(
  journal: AuthSessionTransitionJournalV1
): Promise<void> {
  const previousTokenRef = normalizeTokenRef(journal.previousPayload?.tokenRef);
  if (
    previousTokenRef &&
    !areStoredTokenRefsEqual(
      previousTokenRef,
      journal.candidatePayload.tokenRef
    )
  ) {
    await deleteAccessTokenOrRetainForCleanup(previousTokenRef);
  }
  await removeAuthSessionTransitionJournal();
}

async function registerCurrentCandidateServiceProcess(
  journal: AuthSessionTransitionJournalV1
): Promise<AuthSessionTransitionJournalV1> {
  if (!isCurrentProcessCandidateService()) {
    return journal;
  }
  const currentProcess: ProcessIdentity = {
    ownerPid: process.pid,
    ownerProcessStartedAt: CURRENT_PROCESS_START_IDENTITY,
  };
  if (
    journal.candidateServiceProcess?.ownerPid === currentProcess.ownerPid &&
    journal.candidateServiceProcess.ownerProcessStartedAt ===
      currentProcess.ownerProcessStartedAt
  ) {
    return journal;
  }
  const currentJournal = await readAuthSessionTransitionJournal();
  if (currentJournal?.id !== journal.id || currentJournal.state !== "pending") {
    return currentJournal ?? journal;
  }
  const updatedJournal = {
    ...currentJournal,
    candidateServiceProcess: currentProcess,
  };
  await writeAuthSessionTransitionJournal(updatedJournal);
  return updatedJournal;
}

function stopRegisteredCandidateService(
  journal: AuthSessionTransitionJournalV1
): void {
  const candidateServiceProcess = journal.candidateServiceProcess;
  if (
    !(
      candidateServiceProcess && isProcessIdentityAlive(candidateServiceProcess)
    )
  ) {
    return;
  }
  try {
    process.kill(candidateServiceProcess.ownerPid, "SIGTERM");
  } catch (error) {
    if (!isFileNotFoundErrorCode(error, "ESRCH")) {
      throw new AuthSessionStorageError({
        message: `candidate OpenMeld Service process ${String(candidateServiceProcess.ownerPid)} could not be stopped: ${toErrorMessage(error)}`,
        reason: "unreadable",
        cause: error,
      });
    }
  }
}

function isCurrentProcessCandidateService(): boolean {
  const runtimeMode = String(
    process.env.OPENMELD_DAEMON_RUNTIME_MODE ?? ""
  ).trim();
  return runtimeMode === "background" || runtimeMode === "foreground";
}

async function readStoredAuthSessionFromPayload(
  payload: AuthSessionV1
): Promise<StoredAuthSession> {
  const session = await readStoredAuthSessionFromPayloadIfPresent(payload);
  if (!session) {
    throw new AuthSessionStorageError({
      message: "auth session recovery token is missing",
      reason: "corrupt",
    });
  }
  return session;
}

async function readStoredAuthSessionFromPayloadIfPresent(
  payload: AuthSessionV1
): Promise<StoredAuthSession | null> {
  const accessToken = await readAccessToken(payload.tokenRef);
  if (accessToken.status === "missing") {
    return null;
  }
  if (accessToken.status === "unavailable") {
    throw new AuthSessionStorageError({
      message: accessToken.errorMessage,
      reason: "unreadable",
    });
  }
  return buildStoredAuthSession({
    accessToken: accessToken.accessToken,
    payload,
  });
}

async function readRequiredComputerAuthRecoveryJournal(id: string): Promise<
  AuthSessionTransitionJournalV1 & {
    computerHandoff: NonNullable<
      AuthSessionTransitionJournalV1["computerHandoff"]
    >;
  }
> {
  const journal = await readAuthSessionTransitionJournal();
  if (
    journal?.id !== id ||
    journal.state !== "recovery_required" ||
    !journal.computerHandoff
  ) {
    throw new Error("computer auth recovery is no longer current");
  }
  return journal as AuthSessionTransitionJournalV1 & {
    computerHandoff: NonNullable<
      AuthSessionTransitionJournalV1["computerHandoff"]
    >;
  };
}

function logDeferredAuthSessionTransitionCleanup(input: {
  error: unknown;
  transitionId: string;
}): void {
  console.warn("[openmeld.auth.session_transition_cleanup_deferred]", {
    error: toErrorMessage(input.error),
    transitionId: input.transitionId,
  });
}

async function restoreTransitionPreviousPayload(
  journal: AuthSessionTransitionJournalV1,
  previousSession?: StoredAuthSession | null
): Promise<void> {
  cachedAuthSession = null;
  if (!journal.previousPayload) {
    await removeSessionFile();
    return;
  }
  await writeSessionPayloadAtomically(
    authSessionPath(),
    journal.previousPayload
  );
  if (previousSession) {
    cacheAuthSession({
      payload: journal.previousPayload,
      session: previousSession,
    });
  }
}

async function readAuthSessionTransitionJournal(): Promise<AuthSessionTransitionJournalV1 | null> {
  const path = authSessionTransitionPath();
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw new AuthSessionStorageError({
      message: `auth session transition state could not be read at ${path}: ${toErrorMessage(error)}`,
      reason: "unreadable",
      cause: error,
    });
  });
  if (raw === null) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new AuthSessionStorageError({
      message: `auth session transition state is corrupt at ${path}`,
      reason: "corrupt",
      cause: error,
    });
  }
  if (!isAuthSessionTransitionJournal(value)) {
    throw new AuthSessionStorageError({
      message: `auth session transition state is corrupt at ${path}`,
      reason: "corrupt",
    });
  }
  return value;
}

function isAuthSessionTransitionJournal(
  value: unknown
): value is AuthSessionTransitionJournalV1 {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.v === 1 &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (value.state === "pending" ||
      value.state === "recovery_required" ||
      value.state === "committed") &&
    Number.isSafeInteger(value.ownerPid) &&
    Number(value.ownerPid) > 0 &&
    typeof value.ownerProcessStartedAt === "string" &&
    value.ownerProcessStartedAt.length > 0 &&
    (value.previousPayload === null ||
      isAuthSessionPayload(value.previousPayload)) &&
    isAuthSessionPayload(value.candidatePayload) &&
    isOptionalProcessIdentity(value.candidateServiceProcess) &&
    isOptionalComputerHandoffRecovery(value.computerHandoff)
  );
}

function isOptionalProcessIdentity(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      Number.isSafeInteger(value.ownerPid) &&
      Number(value.ownerPid) > 0 &&
      typeof value.ownerProcessStartedAt === "string" &&
      value.ownerProcessStartedAt.length > 0)
  );
}

function isOptionalComputerHandoffRecovery(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!(isRecord(value) && typeof value.gatewayUrl === "string")) {
    return false;
  }
  return (
    (value.serviceReconciledAt === undefined ||
      typeof value.serviceReconciledAt === "string") &&
    (value.remoteSessionRevokedAt === undefined ||
      typeof value.remoteSessionRevokedAt === "string") &&
    (value.lastRecoveryFailure === undefined ||
      isComputerHandoffRecoveryFailure(value.lastRecoveryFailure))
  );
}

function isComputerHandoffRecoveryFailure(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.at === "string" &&
    typeof value.message === "string" &&
    (value.phase === "service" ||
      value.phase === "remote_session" ||
      value.phase === "local_cleanup") &&
    (value.endpoint === undefined || typeof value.endpoint === "string") &&
    (value.status === undefined ||
      value.status === null ||
      typeof value.status === "number")
  );
}

function isAuthSessionPayload(value: unknown): value is AuthSessionV1 {
  return isRecord(value) && value.v === 1 && isStoredTokenRef(value.tokenRef);
}

async function writeAuthSessionTransitionJournal(
  journal: AuthSessionTransitionJournalV1
): Promise<void> {
  await writeJsonAtomically(authSessionTransitionPath(), journal);
}

async function removeAuthSessionTransitionJournal(): Promise<void> {
  await rm(authSessionTransitionPath(), { force: true });
}

function authSessionTransitionPath(): string {
  return join(openMeldRootDir(), "auth", "session-transition.json");
}

function authSessionPath(): string {
  return join(openMeldRootDir(), "auth", "session.json");
}

async function ensureAuthSessionDirectory(): Promise<void> {
  await mkdir(join(openMeldRootDir(), "auth"), { recursive: true });
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

function isFileNotFoundErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === code
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error ?? "unknown error");
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
