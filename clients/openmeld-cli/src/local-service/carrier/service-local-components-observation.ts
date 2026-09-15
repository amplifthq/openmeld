import type { LocalComponentsStatus } from "@openmeld/schemas/types";
import { resolveLocalComponentsStatus } from "../../local-components/manifest";

// One observation and at most one inspection for the Service lifetime, including
// reconnects. This carries no component readiness or maintenance authority.
export function createServiceLocalComponentsObservation(input: {
  inspect?: () => Promise<LocalComponentsStatus | null>;
  onError: (error: unknown) => void;
}) {
  let observation: {
    value: LocalComponentsStatus | null;
    observedAtMs: number;
  } | null = null;
  let pending: Promise<void> | null = null;
  let onRefresh: (() => void) | undefined;
  let disposed = false;
  return {
    read(notify: () => void): LocalComponentsStatus | null {
      if (disposed) {
        return null;
      }
      onRefresh = notify;
      if (observation && Date.now() - observation.observedAtMs < 30_000) {
        return observation.value;
      }
      if (!pending) {
        pending = (input.inspect ?? resolveLocalComponentsStatus)()
          .then((value) => {
            observation = { value, observedAtMs: Date.now() };
            if (!disposed) {
              onRefresh?.();
            }
          })
          .catch((error) => {
            observation = { value: null, observedAtMs: Date.now() };
            if (!disposed) {
              input.onError(error);
            }
          })
          .finally(() => {
            pending = null;
          });
      }
      return null;
    },
    dispose() {
      disposed = true;
      onRefresh = undefined;
    },
  };
}

export type ServiceLocalComponentsObservation = ReturnType<
  typeof createServiceLocalComponentsObservation
>;
