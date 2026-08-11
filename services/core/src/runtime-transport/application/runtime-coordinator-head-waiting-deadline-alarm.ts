import {
  planRuntimeCoordinatorHeadWaitingAlarmWork,
  type RuntimeCoordinatorHeadLifecycleRecord,
  type RuntimeCoordinatorHeadWaitingAlarmWorkItem,
} from "./runtime-coordinator-authority";

export type RuntimeCoordinatorHeadWaitingDeadlineAlarmPorts = {
  escalateHeadWaitingDeadline: (input: {
    nowMs: number;
    record: RuntimeCoordinatorHeadWaitingAlarmWorkItem;
  }) => Promise<void>;
  readRecords: () => Promise<RuntimeCoordinatorHeadLifecycleRecord[]>;
  reserveWorkUnit: () => boolean;
};

export const processRuntimeCoordinatorHeadWaitingDeadlineAlarm = async (input: {
  nowMs: number;
  ports: RuntimeCoordinatorHeadWaitingDeadlineAlarmPorts;
}): Promise<void> => {
  const records = await input.ports.readRecords();
  const workItems = planRuntimeCoordinatorHeadWaitingAlarmWork({
    nowMs: input.nowMs,
    records,
  });
  for (const record of workItems) {
    if (!input.ports.reserveWorkUnit()) {
      break;
    }
    await input.ports.escalateHeadWaitingDeadline({
      nowMs: input.nowMs,
      record,
    });
  }
};
