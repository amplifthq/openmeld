import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { prepareSessionContinuationSchema } from "@openmeld/schemas";
import type { PrepareSessionContinuation } from "@openmeld/schemas/types";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import {
  DEFAULT_REMOTE_SESSION_TIMEOUT_MS,
  LOOPBACK_REMOTE_SESSION_TIMEOUT_MS,
} from "../strategy-constants";
import {
  CURRENT_PROCESS_START_IDENTITY,
  isProcessIdentityAlive,
} from "../system/process-identity";
import { resolveAuthSessionExpiryEligibility } from "./auth-session-expiry";
import {
  withAuthSessionCandidateRefreshLock,
  withAuthSessionTransitionMutationLock,
} from "./auth-session-transition-lock";
import { normalizeGatewayBaseUrlOrNull } from "./base-url";
import { isLoopbackHostname } from "./loopback-hostname";
import { openMeldRootDir } from "./paths";
import {
  assertServiceAccountAdmissionMutationAvailable,
  ServiceAccountAdmissionError,
} from "./service-account-admission";
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
  candidateCredentialRefreshVersion?: 1;
  candidateTokenRefs?: StoredTokenRef[];
  candidateServiceProcesses?: ProcessIdentity[];
  /** @deprecated Read and write until in-flight v1 journals from older builds expire. */
  candidateServiceProcess?: ProcessIdentity;
  computerHandoff?: {
    gatewayUrl: string;
    prepareContinuation?: PrepareSessionContinuation;
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

const MAX_CANDIDATE_SERVICE_PROCESSES = 16;
const MAX_CANDIDATE_TOKEN_REFS = 64;

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
  // `recoveryRequired` marks an interrupted handoff that a sign-in can finish.
  // Otherwise another setup still owns the transition, and sending the user
  // to sign in would repeat a command that cannot finish it.
  constructor(input: { recoveryRequired?: boolean } = {}) {
    super(
      input.recoveryRequired
        ? `OpenMeld is still finishing an interrupted Computer sign-in recovery. The current sign-in was not changed. Run ${formatOpenMeldCliCommand("openmeld login")} to finish the recovery and sign in, or get a new setup command from OpenMeld Web.`
        : "OpenMeld is still finishing a Computer sign-in change on this computer. The current sign-in was not changed. Wait for that setup to finish, then try again."
    );
    this.name = "AuthSessionRecoveryInProgressError";
  }
}

export class AuthSessionChangedBeforeTransitionError extends Error {
  readonly reason = "previous_session_changed" as const;

  constructor() {
    super(
      "The current Computer sign-in changed while OpenMeld was waiting to start this account switch. Run the setup command again to review the current account before switching. No local sign-in state was changed."
    );
    this.name = "AuthSessionChangedBeforeTransitionError";
  }
}

export class AuthSessionTransitionConflictError extends Error {
  readonly previousOwnerRestored: boolean;
  readonly reason:
    | "journal_missing"
    | "journal_not_pending"
    | "journal_replaced";

  constructor(input: {
    previousOwnerRestored: boolean;
    reason: "journal_missing" | "journal_not_pending" | "journal_replaced";
  }) {
    const conflict = {
      journal_missing: "missing",
      journal_not_pending: "no longer pending",
      journal_replaced: "owned by another sign-in",
    }[input.reason];
    const outcome = input.previousOwnerRestored
      ? "The previous sign-in was restored."
      : "No local sign-in state was changed.";
    super(`The auth session transition journal is ${conflict}. ${outcome}`);
    this.name = "AuthSessionTransitionConflictError";
    this.reason = input.reason;
    this.previousOwnerRestored = input.previousOwnerRestored;
  }
}

export type ClearAuthSessionResult = {
  hadLocalSession: boolean;
  preservedSessionPath?: string;
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
    prepareContinuation?: PrepareSessionContinuation;
  };
  expectedPreviousSession?: AuthSessionMetadata | null;
};

export type InterruptedComputerAuthSessionRecovery = {
  gatewayUrl: string;
  id: string;
  previousSession: StoredAuthSession | null;
  serviceReconciled: boolean;
} & (
  | { remoteSessionRevoked: true; candidateSession: null }
  | {
      remoteSessionRevoked: false;
      candidateSession: StoredAuthSession & {
        user: NonNullable<StoredAuthSession["user"]> & { id: string };
      };
    }
);

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
  retryAfterMs?: number;
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
      retryAfterMs?: number;
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
      payloadKey: string;
      session: StoredAuthSession;
    }
  | {
      state: "valid";
      payloadKey: string;
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
  credentialKey: string;
  session: StoredAuthSession;
};

let cachedAuthSession: CachedAuthSession | null = null;
const pendingCredentialReads = new Map<
  string,
  ReturnType<typeof readAccessToken>
>();
const credentialAvailabilityListeners = new Set<{
  path: string;
  notify: () => void;
}>();

export function onAuthSessionCredentialAvailable(
  notify: () => void
): () => void {
  const listener = { path: authSessionPath(), notify };
  credentialAvailabilityListeners.add(listener);
  return () => {
    credentialAvailabilityListeners.delete(listener);
  };
}
const activeAuthSessionTransitionIds = new Set<string>();

const admittedServiceSession = new AsyncLocalStorage<StoredAuthSession>();
const boundSessionPayloadKeys = new WeakMap<StoredAuthSession, string | null>();

export function withAdmittedServiceSession<T>(
  session: StoredAuthSession,
  run: () => Promise<T>
): Promise<T> {
  return admittedServiceSession.run(structuredClone(session), run);
}

// Admission validates remotely before acquiring the mutex, then rechecks this
// local snapshot under it. It never refreshes credentials or recovers a journal
// while recursively holding the auth lock.
export async function readServiceAdmissionSessionWithOwnership(): Promise<StoredAuthSession> {
  if (await readAuthSessionTransitionJournal()) {
    throw new AuthSessionRecoveryInProgressError();
  }
  return requireValidOwnedLocalAuthSession(
    await getLocalAuthSessionState({ recover: false })
  );
}

// Called under the auth mutation lock. Computer Prepare can use its own
// pending candidate; ordinary account controls cannot. The existing journal
// id fences replacement across enrollment I/O without refresh or recovery.
export async function readComputerSetupSessionWithOwnership(input: {
  gatewayUrl: string;
  expectedTransitionId?: string | null;
}): Promise<{ session: StoredAuthSession; transitionId: string | null }> {
  const journal = await readAuthSessionTransitionJournal();
  const transitionId = journal?.id ?? null;
  if (
    input.expectedTransitionId !== undefined &&
    transitionId !== input.expectedTransitionId
  ) {
    throw new AuthSessionRecoveryInProgressError();
  }
  if (!journal) {
    return {
      session: await readServiceAdmissionSessionWithOwnership(),
      transitionId,
    };
  }
  if (
    journal.state !== "pending" ||
    !activeAuthSessionTransitionIds.has(journal.id) ||
    !isSameProcessIdentity(journal, {
      ownerPid: process.pid,
      ownerProcessStartedAt: CURRENT_PROCESS_START_IDENTITY,
    }) ||
    !journal.computerHandoff ||
    normalizeGatewayBaseUrlOrNull(journal.computerHandoff.gatewayUrl) !==
      normalizeGatewayBaseUrlOrNull(input.gatewayUrl)
  ) {
    throw new AuthSessionRecoveryInProgressError();
  }
  const session = await readStoredAuthSessionFromPayload(
    journal.candidatePayload
  );
  return {
    session: requireValidOwnedLocalAuthSession(
      resolveLocalStoredSessionState(
        session,
        buildAuthSessionPayloadKey(journal.candidatePayload)
      )
    ),
    transitionId,
  };
}

function requireValidOwnedLocalAuthSession(
  state: LocalAuthSessionState
): StoredAuthSession {
  if (state.state !== "valid" || !state.session?.user?.id) {
    throw new Error(
      "Service control requires a valid CLI sign-in. Sign in with the matching account and try again."
    );
  }
  return state.session;
}

type CredentialObservation =
  | "context_changed"
  | "credential_changed"
  | "account_changed"
  | "metadata_unavailable"
  | "credential_available";
const credentialObservationListeners = new Set<{
  path: string;
  notify: (reason: CredentialObservation) => void;
}>();

export function onAuthSessionCredentialObservation(
  notify: (reason: CredentialObservation) => void
): () => void {
  const listener = { path: authSessionPath(), notify };
  credentialObservationListeners.add(listener);
  return () => {
    credentialObservationListeners.delete(listener);
  };
}

function observeCredential(reason: CredentialObservation): void {
  const path = authSessionPath();
  for (const listener of credentialObservationListeners) {
    if (listener.path === path) {
      try {
        listener.notify(reason);
      } catch {
        /* Observations never control authentication. */
      }
    }
  }
}

export async function getAuthSessionState(
  options: GetAuthSessionStateOptions = {}
): Promise<AuthSessionStateResult> {
  const bound = admittedServiceSession.getStore();
  if (bound) {
    return await getBoundServiceSessionState(bound, options);
  }
  const result = await getAuthSessionStateWithCandidateRefreshFence(
    options,
    false
  );
  // Exact-payload fences are private to the auth owner, not diagnostic payloads.
  if (result.reasonCode === "session_metadata_invalid") {
    observeCredential("metadata_unavailable");
  }
  return {
    state: result.state,
    session: result.session,
    ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    ...(result.retryAfterMs !== undefined
      ? { retryAfterMs: result.retryAfterMs }
      : {}),
  };
}

async function syncBoundServiceCredentials(
  bound: StoredAuthSession
): Promise<string | null> {
  const local = await getLocalAuthSessionState({
    recover: false,
    boundSessionIdentity: buildStoredAuthSessionIdentity(bound),
  });
  const samePrincipal = isSameAuthPrincipal(local.session, bound);
  const localPayloadKey =
    samePrincipal && "payloadKey" in local ? local.payloadKey : null;
  if (
    samePrincipal &&
    local.session &&
    boundSessionPayloadKeys.get(bound) !== localPayloadKey
  ) {
    Object.assign(bound, local.session, {
      activeOrganization: local.session.activeOrganization,
    });
    boundSessionPayloadKeys.set(bound, localPayloadKey);
  }
  if (
    samePrincipal &&
    local.session &&
    bound.expiresAt &&
    (bound.accessToken !== local.session.accessToken ||
      bound.expiresAt !== local.session.expiresAt)
  ) {
    await persistBoundServiceRefresh(
      bound,
      {
        state: "valid",
        accessToken: bound.accessToken,
        expiresAt: bound.expiresAt,
      },
      localPayloadKey,
      local.session.accessToken
    );
  }
  return samePrincipal ? (boundSessionPayloadKeys.get(bound) ?? null) : null;
}

async function getBoundServiceSessionState(
  bound: StoredAuthSession,
  options: GetAuthSessionStateOptions
): Promise<AuthSessionStateResult> {
  const localPayloadKey = await syncBoundServiceCredentials(bound);
  if (
    options.validateRemote ||
    (options.refreshExpired && isExpired(bound.expiresAt))
  ) {
    const remote = await getRemoteAuthSessionState(bound);
    if (remote.state === "revoked" || remote.state === "invalid") {
      return {
        state: remote.state,
        session: null,
        reasonCode: resolveRemoteAuthSessionReasonCode(remote.state),
      };
    }
    if (remote.state === "valid") {
      await persistBoundServiceRefresh(bound, remote, localPayloadKey);
      if (remote.accessToken) {
        bound.accessToken = remote.accessToken;
      }
      if (remote.expiresAt) {
        bound.expiresAt = remote.expiresAt;
      }
    }
  }
  const expiry = resolveAuthSessionExpiryEligibility(bound.expiresAt);
  if (expiry.status === "expired") {
    return {
      session: bound,
      state: "expired",
      reasonCode: "session_expired",
    };
  }
  if (expiry.status === "invalid") {
    return {
      session: null,
      state: "invalid",
      reasonCode: "session_expiry_invalid",
    };
  }
  return { session: bound, state: "valid" };
}

async function persistBoundServiceRefresh(
  bound: StoredAuthSession,
  remote: Extract<RemoteAuthSessionValidation, { state: "valid" }>,
  localPayloadKey: string | null,
  previousAccessToken = bound.accessToken
): Promise<void> {
  if (!(localPayloadKey && remote.expiresAt) || isExpired(remote.expiresAt)) {
    return;
  }
  try {
    const persisted = await persistRemoteSessionRefresh({
      accessToken: remote.accessToken ?? bound.accessToken,
      previousAccessToken,
      expectedPayloadKey: localPayloadKey,
      expiresAt: remote.expiresAt,
    });
    if (persisted) {
      const current = await getLocalAuthSessionState({
        recover: false,
        boundSessionIdentity: buildStoredAuthSessionIdentity(bound),
      });
      boundSessionPayloadKeys.set(
        bound,
        isSameAuthPrincipal(current.session, bound) && "payloadKey" in current
          ? current.payloadKey
          : null
      );
    }
  } catch (error) {
    if (
      !(
        error instanceof ServiceAccountAdmissionError &&
        error.code === "service.account_admission.busy"
      )
    ) {
      throw error;
    }
    // Keep the remotely validated A session in memory during admission; the
    // canonical writer remains deferred until that short reservation settles.
  }
}

function isSameAuthPrincipal(
  current: Pick<
    Partial<StoredAuthSession>,
    "user" | "authBaseUrl" | "clientId"
  > | null,
  expected: StoredAuthSession
): boolean {
  return Boolean(
    expected.user?.id &&
      current?.user?.id === expected.user.id &&
      current.authBaseUrl === expected.authBaseUrl &&
      current.clientId === expected.clientId
  );
}

async function getAuthSessionStateWithCandidateRefreshFence(
  options: GetAuthSessionStateOptions,
  candidateRefreshFenceHeld: boolean
): Promise<AuthSessionStateResult> {
  const localState = await getLocalAuthSessionState();
  const localPayloadKey =
    "payloadKey" in localState ? localState.payloadKey : null;
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
  if (
    !candidateRefreshFenceHeld &&
    (await shouldFencePendingCandidateRemoteValidation())
  ) {
    return await withAuthSessionCandidateRefreshLock(
      async () =>
        await getAuthSessionStateWithCandidateRefreshFence(options, true)
    );
  }

  const remoteValidation = await getRemoteAuthSessionState(localState.session);
  if (remoteValidation.state === "valid") {
    return await resolveRemotelyValidatedAuthSession({
      localPayloadKey,
      localState,
      remoteValidation,
    });
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

async function shouldFencePendingCandidateRemoteValidation(): Promise<boolean> {
  const journal = await readAuthSessionTransitionJournal();
  return Boolean(
    journal?.state === "pending" &&
      journal.candidateCredentialRefreshVersion === 1 &&
      isAuthSessionTransitionCandidateVisibleToCurrentProcess(journal)
  );
}

async function resolveRemotelyValidatedAuthSession(input: {
  localPayloadKey: string | null;
  localState: Extract<LocalAuthSessionState, { state: "expired" | "valid" }>;
  remoteValidation: Extract<RemoteAuthSessionValidation, { state: "valid" }>;
}): Promise<AuthSessionStateResult> {
  if (
    !input.remoteValidation.expiresAt ||
    isExpired(input.remoteValidation.expiresAt)
  ) {
    return input.localState;
  }

  let refreshedSession: StoredAuthSession | null;
  try {
    refreshedSession = await persistRemoteSessionRefresh({
      accessToken:
        input.remoteValidation.accessToken ??
        input.localState.session.accessToken,
      expectedPayloadKey: input.localPayloadKey,
      expiresAt: input.remoteValidation.expiresAt,
      previousAccessToken: input.localState.session.accessToken,
    });
  } catch (error) {
    if (!(error instanceof AuthSessionRecoveryInProgressError)) {
      throw error;
    }
    // Remote validation already proved this exact in-memory session is valid.
    // Another process may still own the Computer handoff transaction, so this
    // reader cannot persist the refreshed token or expiry yet. Keep using the
    // validated session in memory instead of falling back to the committed
    // session file, which is intentionally absent on a fresh Computer.
    return {
      state: "valid",
      session: {
        ...input.localState.session,
        accessToken:
          input.remoteValidation.accessToken ??
          input.localState.session.accessToken,
        expiresAt: input.remoteValidation.expiresAt,
      },
    };
  }

  if (!refreshedSession) {
    return await getLocalAuthSessionState();
  }
  return {
    state: "valid",
    session: refreshedSession,
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

  await withAuthSessionTransitionMutationLock(async () => {
    await assertAuthSessionMutationAvailableWithOwnership();
    await retryPendingTokenCleanup();

    const previousPayload = await readSessionPayloadFile();
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
  });
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
  const continuation = context.computerHandoff?.prepareContinuation;
  const prepareContinuation = continuation
    ? prepareSessionContinuationSchema.parse(continuation)
    : undefined;
  return await withAuthSessionTransitionMutationLock(async () => {
    await assertAuthSessionMutationAvailableWithOwnership();
    await retryPendingTokenCleanup();
    await ensureAuthSessionDirectory();
    const previousPayload = await readSessionPayloadFile();
    const previousState = await getLocalAuthSessionState({ recover: false });
    const previousSession =
      previousState.state === "valid" || previousState.state === "expired"
        ? previousState.session
        : null;
    assertExpectedPreviousSession({
      current: buildAuthSessionMetadata(previousPayload),
      expected: context.expectedPreviousSession,
    });
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
      candidateCredentialRefreshVersion: 1,
      candidateTokenRefs: [tokenRef],
      ...(context.computerHandoff
        ? {
            computerHandoff: {
              gatewayUrl: context.computerHandoff.gatewayUrl,
              prepareContinuation,
            },
          }
        : {}),
    };
    let journalClaimed = false;
    try {
      await assertStoredAccessTokenReloads({ accessToken, tokenRef });
      await claimAuthSessionTransitionJournal(journal);
      journalClaimed = true;
      activeAuthSessionTransitionIds.add(journal.id);
    } catch (error) {
      activeAuthSessionTransitionIds.delete(journal.id);
      if (journalClaimed) {
        await restoreTransitionPreviousPayload(journal).catch(() => undefined);
        await removeAuthSessionTransitionJournalIfOwned(journal).catch(
          () => undefined
        );
      }
      await deleteAccessTokenOrRetainForCleanup(tokenRef);
      throw error;
    }
    cacheAuthSession({
      payload: nextPayload,
      session: buildStoredAuthSession({ accessToken, payload: nextPayload }),
    });

    let settlement: "committed" | "pending" | "rolled_back" = "pending";
    const assertTransitionPending = () => {
      if (settlement !== "pending") {
        throw new Error("auth session transition is already settled");
      }
    };
    const isPreviousSessionCurrent = (
      currentPayload: Partial<AuthSessionV1> | null
    ) => {
      if (!journal.previousPayload) {
        return currentPayload === null;
      }
      return (
        currentPayload?.v === 1 &&
        buildAuthSessionPayloadKey(currentPayload) ===
          buildAuthSessionPayloadKey(journal.previousPayload)
      );
    };
    const isCandidateSessionCurrent = (
      currentPayload: Partial<AuthSessionV1> | null,
      candidatePayload: Partial<AuthSessionV1> = nextPayload
    ) =>
      currentPayload?.v === 1 &&
      buildAuthSessionPayloadKey(currentPayload) ===
        buildAuthSessionPayloadKey(candidatePayload);
    const assertTransitionSessionCurrent = async (
      candidatePayload: Partial<AuthSessionV1> = nextPayload
    ) => {
      const currentPayload = await readSessionPayloadFile();
      if (
        !(
          isPreviousSessionCurrent(currentPayload) ||
          isCandidateSessionCurrent(currentPayload, candidatePayload)
        )
      ) {
        throw new Error(
          "auth session changed before the setup transition completed"
        );
      }
    };
    const restoreMissingJournalTransition = async () => {
      const currentPayload = await readSessionPayloadFile();
      if (
        !(
          isPreviousSessionCurrent(currentPayload) ||
          isCandidateSessionCurrent(currentPayload)
        )
      ) {
        try {
          await cleanupTransitionTokensNotReferencedByCurrentSession({
            currentPayload,
            journal,
          });
        } finally {
          activeAuthSessionTransitionIds.delete(journal.id);
        }
        throw new AuthSessionTransitionConflictError({
          previousOwnerRestored: false,
          reason: "journal_missing",
        });
      }

      await claimAuthSessionTransitionJournal(journal);
      try {
        await restoreTransitionPreviousPayload(journal, previousSession);
        settlement = "rolled_back";
        await deleteAccessTokenOrRetainForCleanup(tokenRef).catch(
          (error: unknown) => {
            logDeferredAuthSessionTransitionCleanup({
              error,
              transitionId: journal.id,
            });
          }
        );
      } finally {
        activeAuthSessionTransitionIds.delete(journal.id);
        await removeAuthSessionTransitionJournalIfOwned(journal);
      }
    };

    return {
      previousSession,
      commit: async () =>
        await withAuthSessionTransitionMutationLock(async () => {
          assertTransitionPending();
          const currentJournal =
            await readOwnedPendingAuthSessionTransition(journal);
          if (currentJournal.status === "missing") {
            await restoreMissingJournalTransition();
            throw new AuthSessionTransitionConflictError({
              previousOwnerRestored: true,
              reason: "journal_missing",
            });
          }
          if (currentJournal.status !== "current") {
            activeAuthSessionTransitionIds.delete(journal.id);
            throw new AuthSessionTransitionConflictError({
              previousOwnerRestored: false,
              reason: currentJournal.status,
            });
          }
          await commitAuthSessionTransitionJournal(currentJournal.journal);
          settlement = "committed";
        }),
      rollback: async () =>
        await withAuthSessionTransitionMutationLock(async () => {
          if (settlement === "rolled_back") {
            return;
          }
          assertTransitionPending();
          const currentJournal =
            await readOwnedPendingAuthSessionTransition(journal);
          if (currentJournal.status === "missing") {
            await restoreMissingJournalTransition();
            return;
          }
          if (currentJournal.status !== "current") {
            activeAuthSessionTransitionIds.delete(journal.id);
            throw new AuthSessionTransitionConflictError({
              previousOwnerRestored: false,
              reason: currentJournal.status,
            });
          }
          await assertTransitionSessionCurrent(
            currentJournal.journal.candidatePayload
          );
          await restoreTransitionPreviousPayload(
            currentJournal.journal,
            previousSession
          );
          settlement = "rolled_back";
          activeAuthSessionTransitionIds.delete(journal.id);
          stopRegisteredCandidateService(currentJournal.journal);
          if (currentJournal.journal.computerHandoff) {
            await writeAuthSessionTransitionJournalIfOwned(
              currentJournal.journal,
              {
                ...currentJournal.journal,
                state: "recovery_required",
                computerHandoff: {
                  ...currentJournal.journal.computerHandoff,
                  prepareContinuation: undefined,
                },
              }
            );
            return;
          }
          await cleanupCandidateTokenRefs(currentJournal.journal);
          await removeAuthSessionTransitionJournalIfOwned(
            currentJournal.journal
          );
        }),
    };
  });
}

async function commitAuthSessionTransitionJournal(
  journal: AuthSessionTransitionJournalV1
): Promise<void> {
  const currentPayload = await readSessionPayloadFile();
  const previousIsCurrent = journal.previousPayload
    ? currentPayload?.v === 1 &&
      buildAuthSessionPayloadKey(currentPayload) ===
        buildAuthSessionPayloadKey(journal.previousPayload)
    : currentPayload === null;
  const candidateIsCurrent =
    currentPayload?.v === 1 &&
    buildAuthSessionPayloadKey(currentPayload) ===
      buildAuthSessionPayloadKey(journal.candidatePayload);
  if (!(previousIsCurrent || candidateIsCurrent)) {
    throw new Error(
      "auth session changed before the setup transition completed"
    );
  }
  const payload = journal.candidatePayload;
  const session = await readStoredAuthSessionFromPayload(payload);
  await writeSessionPayloadAtomically(authSessionPath(), payload);
  cacheAuthSession({ payload, session });
  const committed: AuthSessionTransitionJournalV1 = {
    ...journal,
    state: "committed",
  };
  await writeAuthSessionTransitionJournalIfOwned(journal, committed);
  activeAuthSessionTransitionIds.delete(journal.id);
  await finalizeCommittedAuthSessionTransition(committed).catch(
    (error: unknown) => {
      logDeferredAuthSessionTransitionCleanup({
        error,
        transitionId: journal.id,
      });
    }
  );
}

// Read-only: explicit account commands use this to decide whether they must
// finish an interrupted Computer handoff before changing the sign-in.
export async function hasInterruptedComputerAuthSessionTransition(): Promise<boolean> {
  const journal = await readAuthSessionTransitionJournal();
  return Boolean(journal?.computerHandoff && journal.state !== "committed");
}

export async function hasPendingComputerSetupContinuation(): Promise<boolean> {
  const journal = await readAuthSessionTransitionJournal();
  return (
    (journal?.state === "pending" || journal?.state === "recovery_required") &&
    Boolean(journal.computerHandoff?.prepareContinuation)
  );
}

// The OS worker may adopt the existing journal only after its exact owner
// process exits. Its id, account and Prepare session remain unchanged.
export async function resumeInterruptedComputerSetup(
  run: (
    input: PrepareSessionContinuation & { gatewayUrl: string }
  ) => Promise<"completed" | "not_completed">
): Promise<boolean> {
  const claimed = await withAuthSessionTransitionMutationLock(async () => {
    const journal = await readAuthSessionTransitionJournal();
    if (
      !(
        (journal?.state === "pending" ||
          journal?.state === "recovery_required") &&
        journal.computerHandoff?.prepareContinuation
      ) ||
      isProcessIdentityAlive({
        ownerPid: journal.ownerPid,
        ownerProcessStartedAt: journal.ownerProcessStartedAt,
      })
    ) {
      return null;
    }
    const next = {
      ...journal,
      // Older auth readers roll a dead Terminal back without understanding its
      // continuation. Keep that original intent until Core confirms completion
      // or cancellation; current cancellation writers explicitly remove it.
      state: "pending" as const,
      ownerPid: process.pid,
      ownerProcessStartedAt: CURRENT_PROCESS_START_IDENTITY,
    };
    // Ownership transfer is performed only here, under the existing mutation
    // lock, after proving the old owner is dead. Ordinary writes remain fenced.
    await writeJsonAtomically(authSessionTransitionPath(), next);
    activeAuthSessionTransitionIds.add(next.id);
    return {
      journal: next,
      continuation: journal.computerHandoff.prepareContinuation,
      gatewayUrl: journal.computerHandoff.gatewayUrl,
    };
  });
  if (!claimed) {
    return false;
  }
  try {
    const outcome = await run({
      ...claimed.continuation,
      gatewayUrl: claimed.gatewayUrl,
    });
    await withAuthSessionTransitionMutationLock(async () => {
      const current = await readOwnedPendingAuthSessionTransition(
        claimed.journal
      );
      if (current.status !== "current") {
        throw new AuthSessionTransitionConflictError({
          previousOwnerRestored: false,
          reason:
            current.status === "missing" ? "journal_missing" : current.status,
        });
      }
      if (outcome === "completed") {
        await commitAuthSessionTransitionJournal(current.journal);
      } else {
        await restoreTransitionPreviousPayload(current.journal);
        stopRegisteredCandidateService(current.journal);
        await writeAuthSessionTransitionJournalIfOwned(current.journal, {
          ...current.journal,
          state: "recovery_required",
          computerHandoff: {
            ...current.journal.computerHandoff,
            gatewayUrl: claimed.gatewayUrl,
            prepareContinuation: undefined,
          },
        });
      }
    });
    return true;
  } finally {
    activeAuthSessionTransitionIds.delete(claimed.journal.id);
    cachedAuthSession = null;
  }
}

type OwnedPendingAuthSessionTransition =
  | { status: "current"; journal: AuthSessionTransitionJournalV1 }
  | { status: "missing" }
  | { status: "journal_not_pending"; journal: AuthSessionTransitionJournalV1 }
  | { status: "journal_replaced"; journal: AuthSessionTransitionJournalV1 };

async function readOwnedPendingAuthSessionTransition(
  expected: AuthSessionTransitionJournalV1
): Promise<OwnedPendingAuthSessionTransition> {
  const currentJournal = await readAuthSessionTransitionJournal();
  if (!currentJournal) {
    return { status: "missing" };
  }
  if (!hasSameAuthSessionTransitionIdentity(expected, currentJournal)) {
    return { status: "journal_replaced", journal: currentJournal };
  }
  if (currentJournal.state !== "pending") {
    return { status: "journal_not_pending", journal: currentJournal };
  }
  return { status: "current", journal: currentJournal };
}

export async function getInterruptedComputerAuthSessionRecovery(): Promise<InterruptedComputerAuthSessionRecovery | null> {
  return await withAuthSessionTransitionMutationLock(async () => {
    await recoverInterruptedAuthSessionTransitionWithOwnership();
    let journal = await readAuthSessionTransitionJournal();
    // Explicit handoff recovery runs only after joining outstanding updates.
    // A Terminal may have exited before publishing any durable update, or an
    // explicit Service stop may have removed its executor. Do not let that
    // abandoned intent permanently prevent the next user-initiated setup.
    if (
      (journal?.state === "pending" ||
        journal?.state === "recovery_required") &&
      journal.computerHandoff?.prepareContinuation &&
      !isProcessIdentityAlive({
        ownerPid: journal.ownerPid,
        ownerProcessStartedAt: journal.ownerProcessStartedAt,
      })
    ) {
      await restoreTransitionPreviousPayload(journal);
      stopRegisteredCandidateService(journal);
      const recovery = {
        ...journal,
        state: "recovery_required" as const,
        computerHandoff: {
          ...journal.computerHandoff,
          prepareContinuation: undefined,
        },
      };
      await writeAuthSessionTransitionJournalIfOwned(journal, recovery);
      journal = recovery;
    }
    if (!(journal?.state === "recovery_required" && journal.computerHandoff)) {
      return null;
    }

    // Revocation is durable. Finishing local cleanup must not require reading
    // a credential that has already been revoked (and may already be deleted).
    if (journal.computerHandoff.remoteSessionRevokedAt) {
      if (journal.computerHandoff.serviceReconciledAt) {
        await cleanupCandidateTokenRefs(journal);
        await releaseReplacedPreviousTokenRef(journal);
        await removeAuthSessionTransitionJournalIfOwned(journal);
        return null;
      }
      return {
        candidateSession: null,
        gatewayUrl: journal.computerHandoff.gatewayUrl,
        id: journal.id,
        previousSession: await readRecoverablePreviousSession(
          journal.previousPayload
        ),
        remoteSessionRevoked: true,
        serviceReconciled: Boolean(journal.computerHandoff.serviceReconciledAt),
      };
    }

    const candidateSession = await readStoredAuthSessionFromPayloadIfPresent(
      journal.candidatePayload
    );
    if (!candidateSession) {
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
        message:
          "computer auth recovery candidate is missing its owner user id",
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
      previousSession: await readRecoverablePreviousSession(
        journal.previousPayload
      ),
      remoteSessionRevoked: false,
      serviceReconciled: Boolean(journal.computerHandoff.serviceReconciledAt),
    };
  });
}

export async function markInterruptedComputerAuthSessionRecovery(input: {
  id: string;
  phase: "service" | "remote_session";
}): Promise<void> {
  await withAuthSessionTransitionMutationLock(async () => {
    const journal = await readRequiredComputerAuthRecoveryJournal(input.id);
    await writeAuthSessionTransitionJournalIfOwned(journal, {
      ...journal,
      computerHandoff: {
        ...journal.computerHandoff,
        ...(input.phase === "service"
          ? { serviceReconciledAt: new Date().toISOString() }
          : { remoteSessionRevokedAt: new Date().toISOString() }),
        lastRecoveryFailure: undefined,
      },
    });
  });
}

export async function recordInterruptedComputerAuthSessionRecoveryFailure(input: {
  endpoint?: string;
  id: string;
  message: string;
  phase: "service" | "remote_session" | "local_cleanup";
  status?: number | null;
}): Promise<void> {
  await withAuthSessionTransitionMutationLock(async () => {
    await recordInterruptedComputerAuthSessionRecoveryFailureWithOwnership(
      input
    );
  });
}

async function recordInterruptedComputerAuthSessionRecoveryFailureWithOwnership(input: {
  endpoint?: string;
  id: string;
  message: string;
  phase: "service" | "remote_session" | "local_cleanup";
  status?: number | null;
}): Promise<void> {
  const journal = await readRequiredComputerAuthRecoveryJournal(input.id);
  await writeAuthSessionTransitionJournalIfOwned(journal, {
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
  return await withAuthSessionTransitionMutationLock(async () => {
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
      await cleanupCandidateTokenRefs(journal);
      await releaseReplacedPreviousTokenRef(journal);
      await removeAuthSessionTransitionJournalIfOwned(journal);
      return true;
    } catch (error) {
      await recordInterruptedComputerAuthSessionRecoveryFailureWithOwnership({
        id,
        message: toErrorMessage(error),
        phase: "local_cleanup",
      }).catch(() => undefined);
      logDeferredAuthSessionTransitionCleanup({ error, transitionId: id });
      return false;
    }
  });
}

export async function getAuthSession(): Promise<StoredAuthSession | null> {
  const bound = admittedServiceSession.getStore();
  if (bound) {
    return (await getBoundServiceSessionState(bound, {})).session;
  }
  const localState = await getLocalAuthSessionState();
  if (localState.state === "missing" || localState.state === "invalid") {
    return null;
  }
  return localState.session;
}

export async function getAuthSessionMetadata(): Promise<AuthSessionMetadata | null> {
  const bound = admittedServiceSession.getStore();
  if (bound) {
    await getBoundServiceSessionState(bound, {});
    return buildAuthSessionMetadata(bound);
  }
  const payload = await readSessionPayload();
  return buildAuthSessionMetadata(payload);
}

function buildAuthSessionMetadata(
  payload: Partial<AuthSessionV1> | null
): AuthSessionMetadata | null {
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
  await withAuthSessionTransitionMutationLock(async () => {
    await assertAuthSessionMutationAvailableWithOwnership();
    const payload = await readSessionPayloadFile();
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
  });
}

export async function clearAuthSession(
  expectedSession?: AuthSessionMetadata
): Promise<ClearAuthSessionResult> {
  return await withAuthSessionTransitionMutationLock(async () => {
    await assertAuthSessionMutationAvailableWithOwnership();
    cachedAuthSession = null;
    await retryPendingTokenCleanup();
    const hadLocalSession = await authSessionFileExists();
    let payload: Partial<AuthSessionV1> | null;
    try {
      payload = await readSessionPayloadFile();
    } catch (error) {
      if (expectedSession) {
        throw error;
      }
      if (
        !(
          error instanceof AuthSessionStorageError && error.reason === "corrupt"
        )
      ) {
        throw error;
      }
      // Explicit logout may recover malformed metadata, but must preserve the
      // original evidence and never guess which Keychain item it referred to.
      const preservedSessionPath = join(
        openMeldRootDir(),
        "auth",
        `session-corrupt-${randomUUID()}.json`
      );
      await rename(authSessionPath(), preservedSessionPath);
      return { hadLocalSession, preservedSessionPath };
    }
    assertExpectedPreviousSession({
      current: buildAuthSessionMetadata(payload),
      expected: expectedSession,
    });
    if (payload?.v === 1 && isStoredTokenRef(payload.tokenRef)) {
      await deleteAccessTokenOrRetainForCleanup(payload.tokenRef);
    }
    await removeSessionFile();
    return { hadLocalSession };
  });
}

export async function assertAuthSessionMutationAvailable(): Promise<void> {
  await withAuthSessionTransitionMutationLock(
    assertAuthSessionMutationAvailableWithOwnership
  );
}

async function assertAuthSessionMutationAvailableWithOwnership(): Promise<void> {
  await assertServiceAccountAdmissionMutationAvailable();
  const bound = admittedServiceSession.getStore();
  if (bound) {
    const current = await readSessionPayloadFile();
    if (
      current?.user?.id !== bound.user?.id ||
      current?.authBaseUrl !== bound.authBaseUrl ||
      current?.clientId !== bound.clientId
    ) {
      throw new AuthSessionChangedBeforeTransitionError();
    }
  }
  await recoverInterruptedAuthSessionTransitionWithOwnership();
  const journal = await readAuthSessionTransitionJournal();
  if (journal) {
    throw new AuthSessionRecoveryInProgressError({
      recoveryRequired: journal.state === "recovery_required",
    });
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

async function retainAccessTokenForCleanup(
  tokenRef: StoredTokenRef
): Promise<void> {
  const pending = await readPendingTokenCleanup();
  if (pending.tokenRefs.some((ref) => areStoredTokenRefsEqual(ref, tokenRef))) {
    return;
  }
  await persistPendingTokenCleanup([...pending.tokenRefs, tokenRef]);
}

// Deletes a token already recorded for cleanup, and drops the record only
// once the deletion succeeded.
async function releaseRetainedAccessToken(
  tokenRef: StoredTokenRef
): Promise<void> {
  try {
    await deleteAccessToken(tokenRef);
  } catch {
    return;
  }
  const pending = await readPendingTokenCleanup();
  await persistPendingTokenCleanup(
    pending.tokenRefs.filter((ref) => !areStoredTokenRefsEqual(ref, tokenRef))
  );
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

async function getLocalAuthSessionState(
  options: {
    recover?: boolean;
    reloadCount?: number;
    boundSessionIdentity?: string;
  } = {}
): Promise<LocalAuthSessionState> {
  let payload: Partial<AuthSessionV1> | null;
  try {
    payload =
      options.recover === false
        ? await readBoundOrCommittedSessionPayload(options.boundSessionIdentity)
        : await readSessionPayload();
  } catch (error) {
    if (error instanceof AuthSessionStorageError) {
      cachedAuthSession = null;
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
    cachedAuthSession = null;
    return {
      reasonCode: "session_missing",
      state: "missing",
      session: null,
    };
  }

  const tokenRef = normalizeTokenRef(payload.tokenRef);
  if (!tokenRef) {
    cachedAuthSession = null;
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
    cachedAuthSession = null;
    return {
      reasonCode: "session_metadata_invalid",
      state: "invalid",
      session: null,
    };
  }

  const session = readCachedAuthSession(payload);
  if (!session) {
    return await loadCurrentSessionCredential(
      {
        ...payload,
        v: 1,
        tokenRef,
        tokenType,
        authBaseUrl,
        clientId,
        createdAt,
      },
      options
    );
  }
  return resolveLocalStoredSessionState(
    session,
    buildAuthSessionPayloadKey(payload)
  );
}

function resolveLocalStoredSessionState(
  session: StoredAuthSession,
  payloadKey: string
): LocalAuthSessionState {
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
      payloadKey,
      session,
    };
  }

  return {
    state: "valid",
    payloadKey,
    session,
  };
}

async function loadCurrentSessionCredential(
  payload: AuthSessionV1,
  options: { recover?: boolean; reloadCount?: number }
): Promise<LocalAuthSessionState> {
  const credentialKey = buildAuthSessionCredentialCacheKey(payload);
  const accessToken = await readSessionCredential(
    credentialKey,
    payload.tokenRef
  );
  // Secret-store reads can outlive logout. Recheck the owner before accepting a result.
  let currentPayload: Partial<AuthSessionV1> | null;
  try {
    currentPayload =
      options.recover === false
        ? await readSessionPayloadFile()
        : await readSessionPayload();
  } catch (error) {
    if (!(error instanceof AuthSessionStorageError)) {
      throw error;
    }
    cachedAuthSession = null;
    return {
      state: "invalid",
      session: null,
      reasonCode: "session_metadata_invalid",
      errorMessage: error.message,
    };
  }
  if (
    !currentPayload ||
    buildAuthSessionCredentialCacheKey(currentPayload) !== credentialKey
  ) {
    if ((options.reloadCount ?? 0) >= 2) {
      cachedAuthSession = null;
      return {
        state: "invalid",
        session: null,
        reasonCode: "session_metadata_invalid",
        errorMessage:
          "The local login changed while reading its credentials. Try again.",
      };
    }
    return await getLocalAuthSessionState({
      ...options,
      reloadCount: (options.reloadCount ?? 0) + 1,
    });
  }
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
      retryAfterMs: accessToken.retryAfterMs,
      reasonCode: "session_token_unavailable",
      state: "invalid",
      session: null,
    };
  }
  // Credential-key equality preserves all required fields validated by the caller.
  const session = buildStoredAuthSession({
    accessToken: accessToken.accessToken,
    payload: currentPayload as AuthSessionV1,
  });
  cacheAuthSession({ payload: currentPayload, session });
  return resolveLocalStoredSessionState(
    session,
    buildAuthSessionPayloadKey(currentPayload)
  );
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

function assertExpectedPreviousSession(input: {
  current: AuthSessionMetadata | null;
  expected: AuthSessionMetadata | null | undefined;
}): void {
  if (input.expected === undefined) {
    return;
  }
  if (
    buildStoredAuthSessionIdentity(input.current) !==
    buildStoredAuthSessionIdentity(input.expected)
  ) {
    throw new AuthSessionChangedBeforeTransitionError();
  }
}

export function buildStoredAuthSessionIdentity(
  session: AuthSessionMetadata | null
): string {
  if (!session) {
    return "missing";
  }
  // Token rotation, expiry refresh, display metadata, and Organization
  // selection do not change the signed-in Computer session the user reviewed.
  // createdAt changes on every committed login, while user.id catches a real
  // cross-account replacement even if two sessions are created together.
  const identitySource = JSON.stringify([
    session.authBaseUrl,
    session.clientId,
    session.createdAt,
    session.user?.id ?? null,
  ]);
  return createHash("sha256").update(identitySource).digest("base64url");
}

async function cleanupTransitionTokensNotReferencedByCurrentSession(input: {
  currentPayload: Partial<AuthSessionV1> | null;
  journal: AuthSessionTransitionJournalV1;
}): Promise<void> {
  const currentTokenRef = normalizeTokenRef(input.currentPayload?.tokenRef);
  const previousTokenRef = normalizeTokenRef(
    input.journal.previousPayload?.tokenRef
  );
  const transitionTokenRefs = [
    ...(previousTokenRef ? [previousTokenRef] : []),
    ...getCandidateTokenRefs(input.journal),
  ];

  for (const [index, tokenRef] of transitionTokenRefs.entries()) {
    const alreadyHandled = transitionTokenRefs
      .slice(0, index)
      .some((previousRef) => areStoredTokenRefsEqual(previousRef, tokenRef));
    if (
      alreadyHandled ||
      (currentTokenRef && areStoredTokenRefsEqual(currentTokenRef, tokenRef))
    ) {
      continue;
    }
    await deleteAccessTokenOrRetainForCleanup(tokenRef);
  }
}

function cacheAuthSession(input: {
  payload: Partial<AuthSessionV1>;
  session: StoredAuthSession;
}): void {
  const credentialKey = buildAuthSessionCredentialCacheKey(input.payload);
  const becameAvailable = cachedAuthSession?.credentialKey !== credentialKey;
  const previous = cachedAuthSession;
  cachedAuthSession = {
    credentialKey,
    session: input.session,
  };
  if (!previous) {
    observeCredential("credential_available");
  } else if (previous.session.user?.id !== input.session.user?.id) {
    observeCredential("account_changed");
  } else if (becameAvailable) {
    observeCredential("credential_changed");
  } else if (
    JSON.stringify([
      previous.session.activeOrganization,
      previous.session.user,
    ]) !==
    JSON.stringify([input.session.activeOrganization, input.session.user])
  ) {
    observeCredential("context_changed");
  }
  if (becameAvailable) {
    const path = authSessionPath();
    for (const listener of credentialAvailabilityListeners) {
      if (listener.path === path) {
        listener.notify();
      }
    }
  }
}

function readCachedAuthSession(
  payload: Partial<AuthSessionV1>
): StoredAuthSession | null {
  if (
    cachedAuthSession?.credentialKey !==
    buildAuthSessionCredentialCacheKey(payload)
  ) {
    return null;
  }
  const session = buildStoredAuthSession({
    accessToken: cachedAuthSession.session.accessToken,
    payload: payload as AuthSessionV1,
  });
  // Context is freshly read; the exact payload still fences remote refreshes.
  cacheAuthSession({ payload, session });
  return session;
}

function buildAuthSessionCredentialCacheKey(
  payload: Partial<AuthSessionV1>
): string {
  return `${authSessionPath()}\n${JSON.stringify({
    v: payload.v,
    tokenRef: payload.tokenRef,
    tokenType: payload.tokenType,
    authBaseUrl: payload.authBaseUrl,
    clientId: payload.clientId,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
    scope: payload.scope,
    ownerUserId: payload.user?.id,
  })}`;
}

async function readSessionCredential(
  key: string,
  ref: StoredTokenRef
): ReturnType<typeof readAccessToken> {
  const pending = pendingCredentialReads.get(key);
  if (pending) {
    return await pending;
  }
  const read = readAccessToken(ref).finally(() => {
    if (pendingCredentialReads.get(key) === read) {
      pendingCredentialReads.delete(key);
    }
  });
  pendingCredentialReads.set(key, read);
  return await read;
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

function getUniqueTokenRefs(tokenRefs: StoredTokenRef[]): StoredTokenRef[] {
  const uniqueTokenRefs: StoredTokenRef[] = [];
  for (const tokenRef of tokenRefs) {
    if (
      !uniqueTokenRefs.some((existing) =>
        areStoredTokenRefsEqual(existing, tokenRef)
      )
    ) {
      uniqueTokenRefs.push(tokenRef);
    }
  }
  return uniqueTokenRefs;
}

function getCandidateTokenRefs(
  journal: AuthSessionTransitionJournalV1
): StoredTokenRef[] {
  return getUniqueTokenRefs([
    ...(journal.candidateTokenRefs ?? []),
    journal.candidatePayload.tokenRef,
  ]);
}

async function cleanupCandidateTokenRefs(
  journal: AuthSessionTransitionJournalV1,
  keepTokenRef?: StoredTokenRef
): Promise<void> {
  for (const tokenRef of getCandidateTokenRefs(journal)) {
    if (keepTokenRef && areStoredTokenRefsEqual(keepTokenRef, tokenRef)) {
      continue;
    }
    await deleteAccessTokenOrRetainForCleanup(tokenRef);
  }
}

// A renewal of the restored previous sign-in can commit a new token before
// the journal's restore point moves to it. Once recovery no longer needs that
// restore point, release its token unless the committed session still uses it.
async function releaseReplacedPreviousTokenRef(
  journal: AuthSessionTransitionJournalV1
): Promise<void> {
  const previousTokenRef = normalizeTokenRef(journal.previousPayload?.tokenRef);
  if (!previousTokenRef) {
    return;
  }
  let committedPayload: Partial<AuthSessionV1> | null;
  try {
    committedPayload = await readSessionPayloadFile();
  } catch (error) {
    if (error instanceof AuthSessionStorageError) {
      // Unreadable metadata cannot prove the token is unused. Keep it, and
      // let explicit sign-out preserve the damaged record as it already does.
      return;
    }
    throw error;
  }
  const committedTokenRef = normalizeTokenRef(committedPayload?.tokenRef);
  if (
    committedTokenRef &&
    areStoredTokenRefsEqual(committedTokenRef, previousTokenRef)
  ) {
    return;
  }
  await deleteAccessTokenOrRetainForCleanup(previousTokenRef);
}

async function persistRemoteSessionRefresh(input: {
  accessToken: string;
  expectedPayloadKey: string | null;
  expiresAt: string;
  previousAccessToken: string;
}): Promise<StoredAuthSession | null> {
  return await withAuthSessionTransitionMutationLock(async () => {
    const bound = admittedServiceSession.getStore();
    if (bound) {
      const current = await getLocalAuthSessionState({
        recover: false,
        boundSessionIdentity: buildStoredAuthSessionIdentity(bound),
      });
      if (!isSameAuthPrincipal(current.session, bound)) {
        return null;
      }
    }
    await assertServiceAccountAdmissionMutationAvailable();
    await recoverInterruptedAuthSessionTransitionWithOwnership();
    const transitionJournal = await readAuthSessionTransitionJournal();
    if (transitionJournal) {
      if (
        transitionJournal.state === "pending" &&
        transitionJournal.candidateCredentialRefreshVersion === 1 &&
        isAuthSessionTransitionCandidateVisibleToCurrentProcess(
          transitionJournal
        ) &&
        input.expectedPayloadKey !== null &&
        buildAuthSessionPayloadKey(transitionJournal.candidatePayload) ===
          input.expectedPayloadKey
      ) {
        return await persistPendingCandidateRemoteSessionRefresh({
          ...input,
          journal: transitionJournal,
        });
      }
      if (isRestoredPreviousSessionRefresh(transitionJournal, input)) {
        return await persistRestoredPreviousSessionRefresh({
          ...input,
          journal: transitionJournal,
        });
      }
      throw new AuthSessionRecoveryInProgressError();
    }
    return await persistCommittedRemoteSessionRefresh(input);
  });
}

// After rollback, a recovery_required journal's committed session is the
// previous account's restored sign-in. Recovery must be able to persist a
// server-confirmed renewal of that same sign-in, or the restored Service
// rereads the stale local expiry and the recovery can never finish.
function isRestoredPreviousSessionRefresh(
  journal: AuthSessionTransitionJournalV1,
  input: { expectedPayloadKey: string | null }
): journal is AuthSessionTransitionJournalV1 & {
  previousPayload: AuthSessionV1;
} {
  return Boolean(
    journal.state === "recovery_required" &&
      journal.computerHandoff &&
      !journal.computerHandoff.prepareContinuation &&
      journal.previousPayload &&
      input.expectedPayloadKey !== null &&
      buildAuthSessionPayloadKey(journal.previousPayload) ===
        input.expectedPayloadKey
  );
}

async function persistRestoredPreviousSessionRefresh(input: {
  accessToken: string;
  expectedPayloadKey: string | null;
  expiresAt: string;
  journal: AuthSessionTransitionJournalV1 & { previousPayload: AuthSessionV1 };
  previousAccessToken: string;
}): Promise<StoredAuthSession | null> {
  const { journal, ...refresh } = input;
  return await persistCommittedRemoteSessionRefresh({
    ...refresh,
    // Record the replaced token for cleanup before the journal stops
    // referencing it, then move the restore point, then delete it. A crash at
    // any step leaves the old token reachable by a durable record. Pending
    // cleanup runs only once no transition journal exists.
    releaseReplacedToken: async (payload, replacedTokenRef) => {
      if (replacedTokenRef) {
        await retainAccessTokenForCleanup(replacedTokenRef);
      }
      await writeAuthSessionTransitionJournalIfOwned(journal, {
        ...journal,
        previousPayload: payload,
      });
      if (replacedTokenRef) {
        await releaseRetainedAccessToken(replacedTokenRef);
      }
    },
  });
}

async function persistCommittedRemoteSessionRefresh(input: {
  accessToken: string;
  expectedPayloadKey: string | null;
  expiresAt: string;
  previousAccessToken: string;
  // Takes over releasing the replaced token (null when the token did not
  // rotate) after the new payload is committed, so another durable reference
  // can move first. Without it, the replaced token is deleted directly.
  releaseReplacedToken?: (
    payload: AuthSessionV1,
    replacedTokenRef: StoredTokenRef | null
  ) => Promise<void>;
}): Promise<StoredAuthSession | null> {
  const payload = await readSessionPayloadFile();
  if (
    payload?.v !== 1 ||
    input.expectedPayloadKey === null ||
    buildAuthSessionPayloadKey(payload) !== input.expectedPayloadKey
  ) {
    return null;
  }
  const refresh = await prepareRemoteSessionRefresh({
    ...input,
    payload,
    uniqueTokenRef: true,
  });
  if (!refresh) {
    return null;
  }

  try {
    // An expiry-only renewal retains the credential already verified by this
    // process and Auth. Only a newly stored credential needs read-back proof.
    if (
      !areStoredTokenRefsEqual(refresh.currentTokenRef, refresh.nextTokenRef)
    ) {
      await assertStoredAccessTokenReloads({
        accessToken: refresh.nextSession.accessToken,
        tokenRef: refresh.nextTokenRef,
      });
    }
    await writeSessionPayloadAtomically(authSessionPath(), refresh.nextPayload);
  } catch (error) {
    await cleanupFailedRemoteSessionRefresh(refresh);
    throw error;
  }

  cacheAuthSession({
    payload: refresh.nextPayload,
    session: refresh.nextSession,
  });
  const replacedTokenRef = areStoredTokenRefsEqual(
    refresh.currentTokenRef,
    refresh.nextTokenRef
  )
    ? null
    : refresh.currentTokenRef;
  if (input.releaseReplacedToken) {
    await input.releaseReplacedToken(refresh.nextPayload, replacedTokenRef);
  } else if (replacedTokenRef) {
    await deleteAccessTokenOrRetainForCleanup(replacedTokenRef);
  }
  return refresh.nextSession;
}

async function persistPendingCandidateRemoteSessionRefresh(input: {
  accessToken: string;
  expiresAt: string;
  journal: AuthSessionTransitionJournalV1;
  previousAccessToken: string;
}): Promise<StoredAuthSession | null> {
  const refresh = await prepareRemoteSessionRefresh({
    ...input,
    payload: input.journal.candidatePayload,
    uniqueTokenRef: true,
  });
  if (!refresh) {
    return null;
  }
  const candidateTokenRefs = getUniqueTokenRefs([
    ...getCandidateTokenRefs(input.journal),
    refresh.nextTokenRef,
  ]);
  if (candidateTokenRefs.length > MAX_CANDIDATE_TOKEN_REFS) {
    await cleanupFailedRemoteSessionRefresh(refresh);
    throw new AuthSessionStorageError({
      message: `auth session transition has more than ${String(MAX_CANDIDATE_TOKEN_REFS)} candidate token rotations`,
      reason: "unreadable",
    });
  }
  const nextJournal: AuthSessionTransitionJournalV1 = {
    ...input.journal,
    candidatePayload: refresh.nextPayload,
    candidateTokenRefs,
  };

  try {
    if (
      !areStoredTokenRefsEqual(refresh.currentTokenRef, refresh.nextTokenRef)
    ) {
      await assertStoredAccessTokenReloads({
        accessToken: refresh.nextSession.accessToken,
        tokenRef: refresh.nextTokenRef,
      });
    }
    await writeAuthSessionTransitionJournalIfOwned(input.journal, nextJournal);
  } catch (error) {
    await cleanupFailedRemoteSessionRefresh(refresh);
    throw error;
  }

  cacheAuthSession({
    payload: refresh.nextPayload,
    session: refresh.nextSession,
  });
  return refresh.nextSession;
}

type PreparedRemoteSessionRefresh = {
  currentTokenRef: StoredTokenRef;
  nextPayload: AuthSessionV1;
  nextSession: StoredAuthSession;
  nextTokenRef: StoredTokenRef;
};

async function prepareRemoteSessionRefresh(input: {
  accessToken: string;
  expiresAt: string;
  payload: Partial<AuthSessionV1>;
  previousAccessToken: string;
  uniqueTokenRef: boolean;
}): Promise<PreparedRemoteSessionRefresh | null> {
  const currentTokenRef = normalizeTokenRef(input.payload.tokenRef);
  const tokenType = normalizeOptionalString(input.payload.tokenType);
  const authBaseUrl = normalizeOptionalString(input.payload.authBaseUrl);
  const clientId = normalizeOptionalString(input.payload.clientId);
  const createdAt = normalizeOptionalString(input.payload.createdAt);
  const nextAccessToken = normalizeOptionalString(input.accessToken);
  if (
    !(
      currentTokenRef &&
      tokenType &&
      authBaseUrl &&
      clientId &&
      createdAt &&
      nextAccessToken
    )
  ) {
    return null;
  }

  const nextTokenRef =
    nextAccessToken === input.previousAccessToken
      ? currentTokenRef
      : await storeAccessToken({
          accessToken: nextAccessToken,
          authBaseUrl,
          clientId,
          unique: input.uniqueTokenRef,
        });
  const nextPayload: AuthSessionV1 = {
    v: 1,
    tokenRef: nextTokenRef,
    tokenType,
    authBaseUrl,
    clientId,
    createdAt,
    expiresAt: input.expiresAt,
    ...(typeof input.payload.scope === "string" && input.payload.scope.trim()
      ? { scope: input.payload.scope.trim() }
      : {}),
    ...buildAuthUserPayload(input.payload.user),
    ...buildActiveOrganizationPayload(input.payload.activeOrganization),
  };
  return {
    currentTokenRef,
    nextPayload,
    nextSession: buildStoredAuthSession({
      accessToken: nextAccessToken,
      payload: nextPayload,
    }),
    nextTokenRef,
  };
}

async function cleanupFailedRemoteSessionRefresh(
  refresh: PreparedRemoteSessionRefresh
): Promise<void> {
  if (!areStoredTokenRefsEqual(refresh.currentTokenRef, refresh.nextTokenRef)) {
    await deleteAccessTokenOrRetainForCleanup(refresh.nextTokenRef);
  }
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
  const journal = await readAuthSessionTransitionJournal();
  if (journal?.state === "pending") {
    const candidateVisible =
      isAuthSessionTransitionCandidateVisibleToCurrentProcess(journal);
    if (candidateVisible) {
      return journal.candidatePayload;
    }
  }
  return await readSessionPayloadFile();
}

function isAuthSessionTransitionCandidateVisibleToCurrentProcess(
  journal: AuthSessionTransitionJournalV1
): boolean {
  if (activeAuthSessionTransitionIds.has(journal.id)) {
    return true;
  }
  return getRegisteredCandidateServiceProcesses(journal).some(
    (candidateServiceProcess) =>
      isSameProcessIdentity(candidateServiceProcess, {
        ownerPid: process.pid,
        ownerProcessStartedAt: CURRENT_PROCESS_START_IDENTITY,
      })
  );
}

async function readBoundOrCommittedSessionPayload(
  boundSessionIdentity: string | undefined
): Promise<Partial<AuthSessionV1> | null> {
  if (boundSessionIdentity) {
    const journal = await readAuthSessionTransitionJournal();
    if (
      journal?.state === "pending" &&
      isAuthSessionTransitionCandidateVisibleToCurrentProcess(journal) &&
      buildStoredAuthSessionIdentity(journal.candidatePayload) ===
        boundSessionIdentity
    ) {
      // Reconnect can stage a new login for the same principal. Its admitted
      // Service must follow that candidate's credential writer, not adopt the
      // previous committed login while the Host verifies the new identity.
      return journal.candidatePayload;
    }
  }
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
  // Committed session reads do not mutate state. Only enter the recovery
  // critical section when a durable transition actually needs inspection.
  // The locked operation rereads the journal before making any changes.
  if (!(await readAuthSessionTransitionJournal())) {
    return;
  }
  await withAuthSessionTransitionMutationLock(
    recoverInterruptedAuthSessionTransitionWithOwnership
  );
}

async function recoverInterruptedAuthSessionTransitionWithOwnership(): Promise<void> {
  let journal = await readAuthSessionTransitionJournal();
  if (!journal) {
    return;
  }
  await assertServiceAccountAdmissionMutationAvailable();
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
    // A durable setup is still intended after its Terminal exits. The existing
    // maintenance worker resumes this Prepare session; reads must not roll back
    // its account or kill the Service that is completing the update.
    if (journal.computerHandoff?.prepareContinuation) {
      await registerCurrentCandidateServiceProcess(journal);
      return;
    }
    await restoreTransitionPreviousPayload(journal);
    stopRegisteredCandidateService(journal);
    if (journal.computerHandoff) {
      await writeAuthSessionTransitionJournalIfOwned(journal, {
        ...journal,
        state: "recovery_required",
      });
      return;
    }
    await cleanupCandidateTokenRefs(journal);
    await removeAuthSessionTransitionJournalIfOwned(journal);
    return;
  }
  if (journal.state === "recovery_required") {
    if (journal.computerHandoff?.prepareContinuation) {
      return;
    }
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
  await cleanupCandidateTokenRefs(journal, journal.candidatePayload.tokenRef);
  await removeAuthSessionTransitionJournalIfOwned(journal);
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
    getRegisteredCandidateServiceProcesses(journal).some(
      (candidateServiceProcess) =>
        isSameProcessIdentity(candidateServiceProcess, currentProcess)
    )
  ) {
    return journal;
  }
  const currentJournal = await readAuthSessionTransitionJournal();
  if (currentJournal?.id !== journal.id || currentJournal.state !== "pending") {
    return currentJournal ?? journal;
  }
  const candidateServiceProcesses = getRegisteredCandidateServiceProcesses(
    currentJournal
  ).filter((candidate) => isProcessIdentityAlive(candidate));
  candidateServiceProcesses.push(currentProcess);
  if (candidateServiceProcesses.length > MAX_CANDIDATE_SERVICE_PROCESSES) {
    throw new Error(
      `auth session transition has more than ${String(MAX_CANDIDATE_SERVICE_PROCESSES)} live candidate OpenMeld Service processes`
    );
  }
  const updatedJournal = {
    ...currentJournal,
    candidateServiceProcesses,
    candidateServiceProcess: currentProcess,
  };
  await writeAuthSessionTransitionJournalIfOwned(
    currentJournal,
    updatedJournal
  );
  return updatedJournal;
}

function stopRegisteredCandidateService(
  journal: AuthSessionTransitionJournalV1
): void {
  for (const candidateServiceProcess of getRegisteredCandidateServiceProcesses(
    journal
  )) {
    if (!isProcessIdentityAlive(candidateServiceProcess)) {
      continue;
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
}

function getRegisteredCandidateServiceProcesses(
  journal: AuthSessionTransitionJournalV1
): ProcessIdentity[] {
  const candidates = [
    ...(journal.candidateServiceProcesses ?? []),
    ...(journal.candidateServiceProcess
      ? [journal.candidateServiceProcess]
      : []),
  ];
  const uniqueCandidates: ProcessIdentity[] = [];
  for (const candidate of candidates) {
    if (
      !uniqueCandidates.some((existing) =>
        isSameProcessIdentity(existing, candidate)
      )
    ) {
      uniqueCandidates.push(candidate);
    }
  }
  return uniqueCandidates;
}

function isSameProcessIdentity(
  left: ProcessIdentity,
  right: ProcessIdentity
): boolean {
  return (
    left.ownerPid === right.ownerPid &&
    left.ownerProcessStartedAt === right.ownerProcessStartedAt
  );
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

async function readRecoverablePreviousSession(
  payload: AuthSessionV1 | null
): Promise<StoredAuthSession | null> {
  if (!payload) {
    return null;
  }
  const token = await readAccessToken(payload.tokenRef);
  // The rollback has already restored the original payload. An unreadable
  // credential cannot restart a Service, but must not prevent cleanup of the
  // failed candidate or permanently block a fresh authorization attempt.
  return token.status === "found"
    ? buildStoredAuthSession({ accessToken: token.accessToken, payload })
    : null;
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
    (value.candidateCredentialRefreshVersion === undefined ||
      value.candidateCredentialRefreshVersion === 1) &&
    isOptionalStoredTokenRefList(value.candidateTokenRefs) &&
    isOptionalProcessIdentityList(value.candidateServiceProcesses) &&
    isOptionalProcessIdentity(value.candidateServiceProcess) &&
    isOptionalComputerHandoffRecovery(value.computerHandoff)
  );
}

function isOptionalStoredTokenRefList(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= MAX_CANDIDATE_TOKEN_REFS &&
      value.every((tokenRef) => isStoredTokenRef(tokenRef)))
  );
}

function isOptionalProcessIdentityList(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= MAX_CANDIDATE_SERVICE_PROCESSES &&
      value.every((candidate) => isProcessIdentity(candidate)))
  );
}

function isOptionalProcessIdentity(value: unknown): boolean {
  return value === undefined || isProcessIdentity(value);
}

function isProcessIdentity(value: unknown): value is ProcessIdentity {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.ownerPid) &&
    Number(value.ownerPid) > 0 &&
    typeof value.ownerProcessStartedAt === "string" &&
    value.ownerProcessStartedAt.length > 0
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
    (value.prepareContinuation === undefined ||
      prepareSessionContinuationSchema.safeParse(value.prepareContinuation)
        .success) &&
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

async function writeAuthSessionTransitionJournalIfOwned(
  expected: AuthSessionTransitionJournalV1,
  next: AuthSessionTransitionJournalV1
): Promise<void> {
  if (!hasSameAuthSessionTransitionIdentity(expected, next)) {
    throw new Error("auth session transition identity cannot change");
  }
  const current = await readAuthSessionTransitionJournal();
  if (!current) {
    throw new AuthSessionTransitionConflictError({
      previousOwnerRestored: false,
      reason: "journal_missing",
    });
  }
  if (!hasSameAuthSessionTransitionIdentity(expected, current)) {
    throw new AuthSessionTransitionConflictError({
      previousOwnerRestored: false,
      reason: "journal_replaced",
    });
  }
  await writeJsonAtomically(authSessionTransitionPath(), next);
}

async function claimAuthSessionTransitionJournal(
  journal: AuthSessionTransitionJournalV1
): Promise<void> {
  const path = authSessionTransitionPath();
  const claimPath = `${path}.claim-${process.pid}-${Date.now()}-${randomUUID()}`;
  const file = await open(claimPath, "wx", 0o600);
  let failure: unknown;
  try {
    await file.writeFile(`${JSON.stringify(journal, null, 2)}\n`, "utf8");
    await file.sync();
  } catch (error) {
    failure = error;
  }
  try {
    await file.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) {
    await rm(claimPath, { force: true }).catch(() => undefined);
    throw failure;
  }

  try {
    await link(claimPath, path);
  } catch (error) {
    if (isFileNotFoundErrorCode(error, "EEXIST")) {
      throw new AuthSessionRecoveryInProgressError();
    }
    throw error;
  } finally {
    await rm(claimPath, { force: true }).catch(() => undefined);
  }
}

async function removeAuthSessionTransitionJournalIfOwned(
  expected: AuthSessionTransitionJournalV1
): Promise<void> {
  const currentJournal = await readAuthSessionTransitionJournal();
  if (!currentJournal) {
    return;
  }
  if (!hasSameAuthSessionTransitionIdentity(expected, currentJournal)) {
    throw new AuthSessionTransitionConflictError({
      previousOwnerRestored: false,
      reason: "journal_replaced",
    });
  }
  await rm(authSessionTransitionPath(), { force: true });
}

function hasSameAuthSessionTransitionIdentity(
  left: AuthSessionTransitionJournalV1,
  right: AuthSessionTransitionJournalV1
): boolean {
  return (
    left.id === right.id &&
    left.ownerPid === right.ownerPid &&
    left.ownerProcessStartedAt === right.ownerProcessStartedAt
  );
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
