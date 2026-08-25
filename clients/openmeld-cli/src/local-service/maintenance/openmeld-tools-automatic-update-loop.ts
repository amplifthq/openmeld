import type { OpenMeldToolsUpdateCoordinator } from "./openmeld-tools-update-coordinator";

const INITIAL_AUTOMATIC_UPDATE_DELAY_MS = 2 * 60 * 1000;
const AUTOMATIC_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startOpenMeldToolsAutomaticUpdateLoop(input: {
  coordinator: OpenMeldToolsUpdateCoordinator;
  initialDelayMs?: number;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const intervalMs = input.intervalMs ?? AUTOMATIC_UPDATE_CHECK_INTERVAL_MS;

  const schedule = (delayMs: number): void => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      tick().catch((error) => {
        input.onError?.(error);
      });
    }, delayMs);
    timer.unref?.();
  };
  const tick = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      const resumed = await input.coordinator.resumePendingUpdate();
      if (!resumed) {
        await input.coordinator.requestUpdate({ requestSource: "automatic" });
      }
    } catch (error) {
      input.onError?.(error);
    } finally {
      schedule(intervalMs);
    }
  };

  input.coordinator.resumePendingUpdate().catch((error) => {
    input.onError?.(error);
  });
  schedule(input.initialDelayMs ?? INITIAL_AUTOMATIC_UPDATE_DELAY_MS);
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
