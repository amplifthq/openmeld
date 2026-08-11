import { setTimeout as delay } from "node:timers/promises";
import {
  acquireLock,
  isOpenMeldLockError,
  isOpenMeldOrphanedLockError,
  runWithHeldLock,
} from "../../config/lock";

const OPENCLAW_BOOTSTRAP_LOCK_KEY = "openclaw-bootstrap";
const OPENCLAW_BOOTSTRAP_LOCK_RETRY_DELAY_MS = 100;
const OPENCLAW_BOOTSTRAP_LOCK_TIMEOUT_MS = 5000;

export async function withOpenClawBootstrapLock<T>(input: {
  openMeldProfileId: string;
  run: () => Promise<T>;
}): Promise<T> {
  const startedAtMs = Date.now();

  for (;;) {
    try {
      const lock = await acquireLock({
        openMeldProfileId: input.openMeldProfileId,
        key: OPENCLAW_BOOTSTRAP_LOCK_KEY,
        meta: {
          component: "openclaw.bootstrap",
          openMeldProfileId: input.openMeldProfileId,
        },
      });
      return await runWithHeldLock({
        lock,
        run: input.run,
        releaseContext: {
          component: "openclaw.bootstrap",
          lockKey: OPENCLAW_BOOTSTRAP_LOCK_KEY,
          openMeldProfileId: input.openMeldProfileId,
        },
      });
    } catch (error) {
      if (
        !isOpenMeldLockError(error) ||
        isOpenMeldOrphanedLockError(error) ||
        Date.now() - startedAtMs >= OPENCLAW_BOOTSTRAP_LOCK_TIMEOUT_MS
      ) {
        throw error;
      }
      await delay(OPENCLAW_BOOTSTRAP_LOCK_RETRY_DELAY_MS);
    }
  }
}
