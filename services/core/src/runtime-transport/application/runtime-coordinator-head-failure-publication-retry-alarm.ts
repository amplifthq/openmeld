import {
  planRuntimeCoordinatorHeadFailurePublicationRetryAlarmWork,
  type RuntimeCoordinatorHeadFailurePublicationRetryAlarmWorkItem,
  type RuntimeCoordinatorHeadLifecycleRecord,
} from "./runtime-coordinator-authority";

export type RuntimeCoordinatorHeadFailurePublicationRetryAlarmPorts = {
  publishHeadFailureNotice: (
    record: RuntimeCoordinatorHeadFailurePublicationRetryAlarmWorkItem
  ) => Promise<void>;
  readRecords: () => Promise<RuntimeCoordinatorHeadLifecycleRecord[]>;
  reserveWorkUnit: () => boolean;
};

export const processRuntimeCoordinatorHeadFailurePublicationRetryAlarm =
  async (input: {
    nowMs: number;
    ports: RuntimeCoordinatorHeadFailurePublicationRetryAlarmPorts;
  }): Promise<void> => {
    const records = await input.ports.readRecords();
    const workItems =
      planRuntimeCoordinatorHeadFailurePublicationRetryAlarmWork({
        nowMs: input.nowMs,
        records,
      });
    for (const record of workItems) {
      if (!input.ports.reserveWorkUnit()) {
        break;
      }
      await input.ports.publishHeadFailureNotice(record);
    }
  };
