import {
  planRuntimeCoordinatorFinalizationRetryAlarmWork,
  type RuntimeCoordinatorFinalizationRetryEntry,
} from "./runtime-coordinator-authority";

export type RuntimeCoordinatorFinalizationRetryAlarmPorts = {
  processFinalizationRetry: (input: {
    nowMs: number;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }) => Promise<void>;
  readRetryEntries: () => Promise<RuntimeCoordinatorFinalizationRetryEntry[]>;
  reserveWorkUnit: () => boolean;
};

export const processRuntimeCoordinatorFinalizationRetryAlarm = async (input: {
  nowMs: number;
  ports: RuntimeCoordinatorFinalizationRetryAlarmPorts;
}): Promise<void> => {
  const retryEntries = await input.ports.readRetryEntries();
  const workItems = planRuntimeCoordinatorFinalizationRetryAlarmWork({
    nowMs: input.nowMs,
    retryEntries,
  });
  for (const retryEntry of workItems) {
    if (!input.ports.reserveWorkUnit()) {
      break;
    }
    try {
      await input.ports.processFinalizationRetry({
        nowMs: input.nowMs,
        retryEntry,
      });
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_retry_entry_failed]",
        {
          dispatchId: retryEntry.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          finalizationCommandId: retryEntry.finalizationCommandId,
          runtimeCoordinatorExecutionId:
            retryEntry.runtimeCoordinatorExecutionId,
        }
      );
    }
  }
};
