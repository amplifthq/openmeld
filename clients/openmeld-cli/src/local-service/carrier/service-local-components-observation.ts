import type { LocalComponentsStatus } from "@openmeld/schemas/types";
import { resolveLocalComponentsStatus } from "../../local-components/manifest";

type MissingObservation = {
  reason:
    | "first_inspection"
    | "observation_expired"
    | "inspection_pending"
    | "inspection_failed"
    | "empty_result";
  observationAgeMs: number | null;
  inspectionAgeMs: number | null;
};

// One observation and at most one inspection for the Service lifetime, including
// reconnects. This carries no component readiness or maintenance authority.
export function createServiceLocalComponentsObservation(input: {
  inspect?: () => Promise<LocalComponentsStatus | null>;
  onError: (error: unknown) => void;
}) {
  let observation: {
    value: LocalComponentsStatus | null;
    observedAtMs: number;
    failed: boolean;
  } | null = null;
  let inspectionStartedAtMs: number | null = null;
  let onRefresh: (() => void) | undefined;
  let disposed = false;
  async function refresh(): Promise<void> {
    try {
      const value = await (input.inspect ?? resolveLocalComponentsStatus)();
      observation = { value, observedAtMs: Date.now(), failed: false };
      if (!disposed) {
        onRefresh?.();
      }
    } catch (error) {
      observation = { value: null, observedAtMs: Date.now(), failed: true };
      if (!disposed) {
        input.onError(error);
      }
    } finally {
      inspectionStartedAtMs = null;
    }
  }
  return {
    read(
      notify: () => void,
      onMissing?: (detail: MissingObservation) => void
    ): LocalComponentsStatus | null {
      if (disposed) {
        return null;
      }
      onRefresh = notify;
      const now = Date.now();
      const observationAgeMs = observation
        ? now - observation.observedAtMs
        : null;
      if (
        observation &&
        observationAgeMs !== null &&
        observationAgeMs < 30_000
      ) {
        if (!observation.value) {
          onMissing?.({
            reason: observation.failed ? "inspection_failed" : "empty_result",
            observationAgeMs,
            inspectionAgeMs: null,
          });
        }
        return observation.value;
      }
      if (inspectionStartedAtMs !== null) {
        onMissing?.({
          reason: "inspection_pending",
          observationAgeMs,
          inspectionAgeMs: now - inspectionStartedAtMs,
        });
      } else {
        onMissing?.({
          reason: observation ? "observation_expired" : "first_inspection",
          observationAgeMs,
          inspectionAgeMs: null,
        });
        inspectionStartedAtMs = now;
        refresh();
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
