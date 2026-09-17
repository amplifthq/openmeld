export type StopAwareDelayResult = "elapsed" | "interrupted";

export type StopAwareDelay = {
  interrupt: () => void;
  wake: () => void;
  wait: (delayMs: number) => Promise<StopAwareDelayResult>;
};

// The daemon run loop parks in reconnect backoff waits that can reach the
// 15-minute auth_rejected tier. A stop request (SIGTERM / lifecycle repair)
// only flips a flag, so the wait itself must wake immediately or the process
// outlives every lifecycle stop window (2026-07-03 production incident: stale
// tokens put every daemon into the 15-minute tier and setup repair could not
// stop them). `interrupt()` resolves all pending and future waits right away;
// without an interrupt each wait runs its full duration unchanged.
export function createStopAwareDelay(): StopAwareDelay {
  let interrupted = false;
  let wakePending = false;
  const pendingInterruptNotifiers = new Set<() => void>();
  return {
    wake: () => {
      wakePending = pendingInterruptNotifiers.size === 0;
      for (const notify of pendingInterruptNotifiers) {
        notify();
      }
      pendingInterruptNotifiers.clear();
    },
    interrupt: () => {
      if (interrupted) {
        return;
      }
      interrupted = true;
      for (const notifyInterrupted of pendingInterruptNotifiers) {
        notifyInterrupted();
      }
      pendingInterruptNotifiers.clear();
    },
    wait: (delayMs) => {
      if (interrupted) {
        return Promise.resolve("interrupted");
      }
      if (wakePending) {
        wakePending = false;
        return Promise.resolve("interrupted");
      }
      return new Promise((resolve) => {
        let timer: NodeJS.Timeout | null = null;
        const notifyInterrupted = () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          resolve("interrupted");
        };
        pendingInterruptNotifiers.add(notifyInterrupted);
        timer = setTimeout(() => {
          pendingInterruptNotifiers.delete(notifyInterrupted);
          resolve("elapsed");
        }, delayMs);
      });
    },
  };
}
