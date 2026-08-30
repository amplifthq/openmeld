import { setTimeout as delay } from "node:timers/promises";
import { acquireLock, isOpenMeldLockError, runWithHeldLock } from "./lock";

const AUTH_SESSION_LOCK_KEY = "session-transition-mutation";
const AUTH_SESSION_CANDIDATE_REFRESH_LOCK_KEY = "candidate-session-refresh";
const AUTH_SESSION_LOCK_PROFILE = "auth-session";
const AUTH_SESSION_LOCK_RETRY_DELAY_MS = 20;
const AUTH_SESSION_LOCK_WAIT_MS = 10_000;

export async function withAuthSessionTransitionMutationLock<T>(
  operation: () => Promise<T>
): Promise<T> {
  return await withAuthSessionLock({
    component: "auth_session_transition",
    key: AUTH_SESSION_LOCK_KEY,
    operation,
  });
}

export async function withAuthSessionCandidateRefreshLock<T>(
  operation: () => Promise<T>
): Promise<T> {
  return await withAuthSessionLock({
    component: "auth_session_candidate_refresh",
    key: AUTH_SESSION_CANDIDATE_REFRESH_LOCK_KEY,
    operation,
  });
}

async function withAuthSessionLock<T>(input: {
  component: string;
  key: string;
  operation: () => Promise<T>;
}): Promise<T> {
  const lock = await acquireAuthSessionLock(input);
  return await runWithHeldLock({
    lock,
    run: input.operation,
    releaseContext: {
      component: input.component,
      lockKey: input.key,
    },
  });
}

async function acquireAuthSessionLock(input: {
  component: string;
  key: string;
}) {
  const deadline = Date.now() + AUTH_SESSION_LOCK_WAIT_MS;
  while (true) {
    try {
      return await acquireLock({
        key: input.key,
        meta: { component: input.component },
        openMeldProfileId: AUTH_SESSION_LOCK_PROFILE,
      });
    } catch (error) {
      if (!(isOpenMeldLockError(error) && Date.now() < deadline)) {
        throw error;
      }
      await delay(AUTH_SESSION_LOCK_RETRY_DELAY_MS);
    }
  }
}
