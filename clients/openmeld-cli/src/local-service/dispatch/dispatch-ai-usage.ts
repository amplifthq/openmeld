import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas/types";

type Telemetry = NonNullable<OpenMeldDaemonTaskResultPayload["telemetry"]>;
type Observation = NonNullable<Telemetry["aiUsage"]>[number];

// A CLI reply proposal can precede the native result, and repair can use more
// than one native turn. Preserve all receipts in the existing result outbox.
export function createDispatchAiUsageCollector() {
  const observations = new Map<string, Observation>();
  let latestTelemetry: Telemetry | undefined;
  return {
    observe(telemetry: Telemetry | undefined) {
      if (!telemetry) {
        return;
      }
      latestTelemetry = telemetry;
      for (const observation of telemetry.aiUsage ?? []) {
        observations.set(observation.eventId, observation);
      }
    },
    apply(
      payload: OpenMeldDaemonTaskResultPayload
    ): OpenMeldDaemonTaskResultPayload {
      if (!latestTelemetry || observations.size === 0) {
        return payload;
      }
      return {
        ...payload,
        telemetry: {
          ...(payload.telemetry ?? latestTelemetry),
          aiUsage: [...observations.values()],
        },
      };
    },
  };
}
