import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";

type RuntimeTransportGateStage =
  | "gate"
  | "release_refresh"
  | "reasoning_preference_read"
  | "runtime_records_restore"
  | "update_retries_restore"
  | "connection_incidents_observe"
  | "connection_generation_read"
  | "runtime_records_persist"
  | "housekeeping_alarm_sync";

export type RuntimeTransportGateStageRunner = <T>(
  stage: RuntimeTransportGateStage,
  operation: () => Promise<T>
) => Promise<T>;

export async function observeRuntimeTransportGate<T>(
  context: {
    bootId: string;
    durableObjectId: string;
    gateKind: "constructor" | "register";
  },
  operation: (runStage: RuntimeTransportGateStageRunner) => Promise<T>
): Promise<T> {
  const gateId = crypto.randomUUID();
  const gateStartedAtMs = performance.now();
  const runStage: RuntimeTransportGateStageRunner = async (stage, run) => {
    const stageStartedAtMs = performance.now();
    const emit = (status: "started" | "completed" | "failed"): void => {
      const nowMs = performance.now();
      const entry = {
        event: CORE_LOG_EVENTS.runtimeTransportGatePhase,
        ...context,
        gateId,
        stage,
        status,
        elapsedMs: Math.max(0, nowMs - gateStartedAtMs),
        durationMs: Math.max(0, nowMs - stageStartedAtMs),
      };
      if (status === "failed") {
        console.warn("[core.runtime_transport.gate_phase]", entry);
      } else {
        console.info("[core.runtime_transport.gate_phase]", entry);
      }
    };

    // A platform reset can prevent completion/finally from running. Record
    // the pending stage before starting its I/O, without logging its payload.
    emit("started");
    try {
      const result = await run();
      emit("completed");
      return result;
    } catch (error) {
      emit("failed");
      throw error;
    }
  };
  return await runStage("gate", () => operation(runStage));
}
