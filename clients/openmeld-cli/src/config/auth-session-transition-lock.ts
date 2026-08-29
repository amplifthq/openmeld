import { setTimeout as delay } from "node:timers/promises";
import { acquireLock, isOpenMeldLockError, runWithHeldLock } from "./lock";

const AUTH_SESSION_LOCK_KEY = "session-transition-mutation";
const AUTH_SESSION_LOCK_PROFILE = "auth-session";
const AUTH_SESSION_LOCK_RETRY_DELAY_MS = 20;
const AUTH_SESSION_LOCK_WAIT_MS = 10_000;

export async function withAuthSessionTransitionMutationLock<T>(
  operation: () => Promise<T>
): Promise<T> {
  const lock = await acquireAuthSessionTransitionMutationLock();
  return await runWithHeldLock({
    lock,
    run: operation,
    releaseContext: {
      component: "auth_session_transition",
      lockKey: AUTH_SESSION_LOCK_KEY,
    },
  });
}

async function acquireAuthSessionTransitionMutationLock() {
  const deadline = Date.now() + AUTH_SESSION_LOCK_WAIT_MS;
  while (true) {
    try {
      return await acquireLock({
        key: AUTH_SESSION_LOCK_KEY,
        meta: { component: "auth_session_transition" },
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
