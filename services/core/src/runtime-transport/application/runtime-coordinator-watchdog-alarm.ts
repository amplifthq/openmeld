import {
  type RuntimeCoordinatorRunCommandState,
  resolveRuntimeCoordinatorRunCommandStateWatchdogAtMs,
} from "./runtime-coordinator-authority";

export type RuntimeCoordinatorWatchdogAlarmPorts = {
  processWatchdogDue: (input: {
    commandState: RuntimeCoordinatorRunCommandState;
    nextCheckAtMs: number;
    nowMs: number;
  }) => Promise<void>;
  readCommandStates: () => Promise<RuntimeCoordinatorRunCommandState[]>;
  reserveWorkUnit: () => boolean;
};

export const processRuntimeCoordinatorWatchdogAlarm = async (input: {
  nowMs: number;
  ports: RuntimeCoordinatorWatchdogAlarmPorts;
}): Promise<void> => {
  const commandStates = await input.ports.readCommandStates();
  for (const commandState of commandStates) {
    const nextCheckAtMs =
      resolveRuntimeCoordinatorRunCommandStateWatchdogAtMs(commandState);
    if (nextCheckAtMs === null || nextCheckAtMs > input.nowMs) {
      continue;
    }
    if (!input.ports.reserveWorkUnit()) {
      break;
    }
    await input.ports.processWatchdogDue({
      commandState,
      nextCheckAtMs,
      nowMs: input.nowMs,
    });
  }
};
