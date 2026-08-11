import {
  planRuntimeCoordinatorPreExecutionHandoffAlarmWork,
  type RuntimeCoordinatorPreExecutionHandoffRecord,
} from "./runtime-coordinator-authority";

export type RuntimeCoordinatorPreExecutionHandoffAlarmPorts = {
  deleteRecord: (dispatchId: string) => Promise<void>;
  markLegacyEvidenceOnly: (input: {
    nowMs: number;
    record: RuntimeCoordinatorPreExecutionHandoffRecord;
  }) => Promise<RuntimeCoordinatorPreExecutionHandoffRecord>;
  readRecords: () => Promise<RuntimeCoordinatorPreExecutionHandoffRecord[]>;
  reserveWorkUnit: () => boolean;
};

export const processRuntimeCoordinatorPreExecutionHandoffAlarm = async (input: {
  nowMs: number;
  ports: RuntimeCoordinatorPreExecutionHandoffAlarmPorts;
}): Promise<void> => {
  const records = await input.ports.readRecords();
  const workItems = planRuntimeCoordinatorPreExecutionHandoffAlarmWork({
    nowMs: input.nowMs,
    records,
  });
  for (const workItem of workItems) {
    if (!input.ports.reserveWorkUnit()) {
      break;
    }
    if (workItem.action === "delete_recovered") {
      await input.ports.deleteRecord(workItem.record.dispatchId);
      continue;
    }
    await input.ports.markLegacyEvidenceOnly({
      nowMs: input.nowMs,
      record: workItem.record,
    });
  }
};
